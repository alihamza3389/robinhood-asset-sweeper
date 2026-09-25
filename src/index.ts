import ora from 'ora';
import { Address, getAddress, isAddress } from 'viem';
import { confirm, input } from '@inquirer/prompts';
import { HELP, loadConfig, parseCli } from './config.js';
import { askBlockscoutKey, envExists, runSetupWizard } from './setup.js';
import { runReset } from './reset.js';
import { createClients } from './chain.js';
import { CONTRACTS, DEAD_ADDRESS, FALLBACK_STOCK_TOKENS } from './constants.js';
import { Asset, ActionResult, OperationMode, TokenAsset } from './types.js';
import { loadCustomTokens, saveCustomToken } from './scan/customTokens.js';
import { fetchRobinhoodStocks } from './scan/registry.js';
import { fetchPrices, PriceBook } from './scan/prices.js';
import { addUniswapRoutes, readTokens, scanWallet, ScanResult } from './scan/wallet.js';
import { BlockscoutKeyError } from './scan/blockscout.js';
import { ActionContext, describeError } from './actions/context.js';
import { sendNative, transferToken } from './actions/transfer.js';
import { sellToken } from './actions/sell.js';
import { formatAmount, usdValue } from './ui/format.js';
import { banner, box, c, emoji, promptTheme, step, sym, tip } from './ui/theme.js';
import { printDonations, printReview, printSummary, printTokenList, printWalletCard, runStep } from './ui/screens.js';
import {
  confirmBurn,
  confirmPlan,
  isTokenAsset,
  promptAmounts,
  promptAssets,
  promptDestination,
  promptManualTokens,
  promptMode,
} from './ui/prompts.js';

const STEPS = 5;

/** Words used while running, when done, and in practice mode. */
const VERBS: Record<OperationMode, [string, string, string]> = {
  TRANSFER: ['Sending', 'Sent', 'Would send'],
  SELL: ['Selling', 'Sold', 'Would sell'],
  SELL_AND_SWEEP: ['Selling', 'Sold', 'Would sell'],
  BURN: ['Burning', 'Burned', 'Would burn'],
};

function withPrice<T extends Asset>(asset: T, prices: PriceBook): T {
  const priceUsd = asset.kind === 'native' ? prices.ethUsd : prices.tokens.get(asset.address.toLowerCase());
  return { ...asset, priceUsd };
}

/** Which assets each mode may act on. */
function eligibleFor(mode: OperationMode, assets: Asset[]): { eligible: Asset[]; excluded: Asset[] } {
  const ok = (a: Asset) => {
    switch (mode) {
      case 'TRANSFER':
        return true;
      case 'BURN':
        return a.kind === 'erc20';
      case 'SELL':
      case 'SELL_AND_SWEEP':
        return a.kind === 'erc20' && a.route !== 'NONE';
    }
  };
  return { eligible: assets.filter(ok), excluded: assets.filter((a) => !ok(a) && a.kind === 'erc20') };
}

/** Used when .env has no key (e.g. it was created by hand). The wizard is the normal path. */
async function promptBlockscoutKey(chainId: number): Promise<string> {
  console.log(
    '\n' +
      box(
        [
          'A free Blockscout API key is needed to find your tokens.',
          `Get one in about 30 seconds at ${c.addr('https://dev.blockscout.com')}`,
          c.dim('Run "npm run setup" afterwards to save it.'),
        ],
        { title: `${emoji('🔑')}One more thing`, color: c.warn }
      )
  );
  return askBlockscoutKey(chainId);
}

async function main() {
  const cli = parseCli();
  if (cli.help) {
    console.log(HELP);
    printDonations();
    return;
  }
  // Start on a clean screen (also hides npm's own startup lines).
  if (process.stdout.isTTY) console.clear();
  banner(cli.dryRun);
  if (cli.reset) {
    await runReset();
    return;
  }
  if (cli.setup || (!envExists() && !process.env.PRIVATE_KEY)) {
    await runSetupWizard();
  }
  const config = await loadConfig(cli);
  if (!config.blockscoutApiKey) {
    config.blockscoutApiKey = await promptBlockscoutKey(config.chainId);
  }

  const { account, publicClient, walletClient } = createClients(config);
  const sender = account.address;
  console.log(`\n${c.dim('Wallet')}  ${c.addr(sender)}  ${c.dim(`on ${config.chainName}`)}`);

  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(`The RPC at ${config.rpcUrl} is on chain ${rpcChainId}, not ${config.chainId}. Stopping to keep your funds safe.`);
  }

  // Step 1: what to do, and where to
  step(1, STEPS, 'Choose what to do', 'Use the arrow keys, then press Enter.');
  const choice = await promptMode();
  if (choice === 'QUIT') {
    console.log(c.dim('\nBye! Nothing was changed.'));
    return;
  }
  const mode: OperationMode = choice;
  let destination: Address | undefined;
  if (mode === 'TRANSFER' || mode === 'SELL_AND_SWEEP') {
    tip('Double-check the address. Crypto sent to the wrong address cannot be recovered.');
    destination = await promptDestination(sender, config.defaultDestination);
    if (destination !== config.defaultDestination) {
      // Guards against clipboard-hijacking malware that swaps a pasted address for a lookalike.
      console.log(`\n  ${c.dim('You entered')}  ${c.warn.bold(destination)}`);
      const tail = await input({ message: 'To confirm, type the LAST 4 characters of that address:', theme: promptTheme });
      if (tail.trim().toLowerCase() !== destination.slice(-4).toLowerCase()) {
        console.log(c.danger(`\n${sym.fail} Those don't match, so I stopped. Nothing was sent. Please start again.`));
        return;
      }
    }
    const code = await publicClient.getCode({ address: destination });
    if (code && code !== '0x') {
      console.log(
        '\n' +
          box(
            [
              'This address is a smart contract, not a normal wallet.',
              'Only continue if you know it can receive these tokens',
              '(for example an exchange deposit address).',
            ],
            { title: `${sym.warn} Heads up`, color: c.warn }
          )
      );
      if (!(await confirm({ message: 'Continue anyway?', default: false, theme: promptTheme }))) return;
    }
  } else if (mode === 'BURN') {
    destination = DEAD_ADDRESS;
  }

  // Step 2: scan. Blockscout lists the tokens, the chain confirms balances.
  step(2, STEPS, 'Looking through your wallet');
  const spinner = ora({ text: 'Finding your tokens and prices…', discardStdin: false }).start();
  let scan: ScanResult;
  let stocks: Set<string>;
  let prices: PriceBook;
  try {
    [stocks, prices] = await Promise.all([
      fetchRobinhoodStocks(config.chainId),
      fetchPrices(publicClient, { chainId: config.chainId, apiKey: config.blockscoutApiKey }),
    ]);
    // Checked on-chain as well as via Blockscout, so an indexing gap can never hide these.
    const knownTokens = [
      ...loadCustomTokens(),
      ...[...stocks, ...FALLBACK_STOCK_TOKENS, ...prices.tokens.keys(), CONTRACTS.BUCKET_TOKEN]
        .filter((a) => isAddress(a, { strict: false }))
        .map((a) => getAddress(a)),
    ];
    scan = await scanWallet({ publicClient, owner: sender, config, apiKey: config.blockscoutApiKey, knownTokens });
  } catch (err) {
    spinner.stopAndPersist({ symbol: c.danger(sym.fail), text: err instanceof BlockscoutKeyError ? err.message : `Could not read the wallet: ${describeError(err)}` });
    return;
  }
  spinner.stop();
  // Blockscout prices fill any gaps in the Bucket feed.
  for (const [addr, usd] of scan.indexerPrices) if (!prices.tokens.has(addr)) prices.tokens.set(addr, usd);
  const label = (t: TokenAsset): TokenAsset => ({
    ...t,
    flags: { ...t.flags, robinhoodStock: stocks.has(t.address.toLowerCase()) },
  });

  let assets: Asset[] = [
    ...(scan.native.balance > 0n ? [withPrice(scan.native, prices)] : []),
    ...scan.tokens.map((t) => withPrice(label(t), prices)),
  ];
  assets = assets.sort((a, b) => (usdValue(b) ?? -1) - (usdValue(a) ?? -1));
  printWalletCard(sender, scan.native, assets, prices.ethUsd);
  for (const w of scan.warnings) console.log(c.warn(`  ${sym.warn} ${w}`));
  printTokenList(assets);

  // Manual additions (saved for next time only if they are real ERC-20s)
  const manual = await promptManualTokens();
  if (manual.length) {
    const found = await addUniswapRoutes(publicClient, await readTokens(publicClient, sender, manual, stocks));
    for (const addr of manual) {
      const token = found.find((t) => t.address.toLowerCase() === addr.toLowerCase());
      if (!token) {
        console.log(c.danger(`  ${sym.fail} ${addr} is not a token contract, so it was not added.`));
        continue;
      }
      saveCustomToken(token.address);
      if (token.balance === 0n) {
        console.log(c.dim(`  ${token.symbol}: you hold none right now. Saved, and it will be checked on future runs.`));
      } else if (!assets.some((a) => a.kind === 'erc20' && a.address === token.address)) {
        assets.push(withPrice(token, prices));
        console.log(c.brand(`  ${sym.ok} Added ${token.symbol} (${formatAmount(token.balance, token.decimals)}). It will be remembered.`));
      }
    }
  }

  assets = assets.sort((a, b) => (usdValue(b) ?? -1) - (usdValue(a) ?? -1));
  const { eligible, excluded } = eligibleFor(mode, assets);
  if (eligible.length === 0) {
    const why =
      mode === 'SELL' || mode === 'SELL_AND_SWEEP'
        ? 'None of your tokens can be sold through the Robinhood Chain routers this tool uses.'
        : mode === 'BURN'
          ? 'There are no tokens in this wallet to burn.'
          : 'This wallet is empty.';
    console.log('\n' + box([why], { title: 'Nothing to do', color: c.warn }));
    return;
  }
  if (scan.native.balance === 0n && !config.dryRun) {
    console.log(
      '\n' +
        box(
          [
            'Every transaction needs a tiny amount of ETH on Robinhood Chain',
            'to pay the network fee, and this wallet has none.',
            '',
            'Send a little ETH (a dollar or two is plenty) to:',
            c.addr.bold(sender),
            'then start the tool again.',
          ],
          { title: `${emoji('⛽')}No ETH for fees`, color: c.danger }
        )
    );
    return;
  }

  // Step 3: pick tokens and amounts
  step(
    3,
    STEPS,
    mode === 'BURN' ? 'Pick the spam tokens' : 'Pick your tokens',
    mode === 'BURN' ? 'Tokens flagged as likely spam are already ticked.' : undefined
  );
  if (excluded.length && (mode === 'SELL' || mode === 'SELL_AND_SWEEP')) {
    tip(`Not listed because they can't be sold here: ${excluded.map((a) => a.symbol).join(', ')}`);
  }
  const selected = await promptAssets(mode, eligible);
  const plan = await promptAmounts(selected);
  // Tokens first; native ETH last so fees for the token transfers are still available.
  plan.sort((a, b) => Number(a.asset.kind === 'native') - Number(b.asset.kind === 'native'));

  // Step 4: review
  step(4, STEPS, 'Review', 'Nothing has been sent yet.');
  printReview(mode, plan, mode === 'SELL' ? undefined : destination, config);
  const proceed = mode === 'BURN' && !config.dryRun ? await confirmBurn(plan.length) : await confirmPlan(config.dryRun);
  if (!proceed) {
    console.log(c.dim('\nCancelled. Nothing was sent.'));
    return;
  }

  // Step 5: go
  step(
    5,
    STEPS,
    config.dryRun ? 'Simulating' : 'Sending',
    config.dryRun ? undefined : 'Please keep this window open until it finishes.'
  );
  const ctx: ActionContext = { publicClient, walletClient, owner: sender, dryRun: config.dryRun };
  const results: ActionResult[] = [];
  const [doing, done, would] = VERBS[mode];
  const n = plan.length + (mode === 'SELL_AND_SWEEP' ? 1 : 0);

  for (const [i, { asset, amount, max }] of plan.entries()) {
    const labels = { doing: `${c.dim(`[${i + 1}/${n}]`)} ${doing} ${asset.symbol}…`, done, would };
    if (mode === 'SELL' || mode === 'SELL_AND_SWEEP') {
      if (!isTokenAsset(asset)) continue;
      results.push(
        await runStep(
          labels,
          (onStatus) =>
            sellToken({ ...ctx, onStatus }, asset, amount, max, {
              slippagePercent: config.slippagePercent,
              maxPriceImpactPercent: config.maxPriceImpactPercent,
              ethPerToken: asset.priceUsd && prices.ethUsd ? asset.priceUsd / prices.ethUsd : undefined,
            }),
          config.explorerUrl
        )
      );
    } else {
      results.push(
        await runStep(
          labels,
          (onStatus) =>
            asset.kind === 'native'
              ? sendNative({ ...ctx, onStatus }, asset, destination!, amount, max)
              : transferToken({ ...ctx, onStatus }, asset, destination!, amount, max),
          config.explorerUrl
        )
      );
    }
  }

  if (mode === 'SELL_AND_SWEEP') {
    if (results.some((r) => r.status === 'failed')) {
      console.log(c.warn(`${sym.warn} The ETH was not sent, because a sale failed. It stays here so you can try again.`));
    } else {
      results.push(
        await runStep(
          { doing: `${c.dim(`[${n}/${n}]`)} Sending all ETH to ${destination!.slice(0, 8)}…`, done: 'Sent', would: 'Would send' },
          (onStatus) => sendNative({ ...ctx, onStatus }, scan.native, destination!, 0n, true),
          config.explorerUrl
        )
      );
    }
  }

  printSummary(results, config, prices.ethUsd);
  printDonations();
}

main().catch((err: unknown) => {
  if (err instanceof Error && err.name === 'ExitPromptError') {
    console.log(c.dim('\n\nClosed. Nothing more was sent.'));
    process.exit(130);
  }
  console.error('\n' + box([describeError(err)], { title: `${sym.fail} Something went wrong`, color: c.danger }));
  console.error(c.dim('Nothing more will be sent. If this keeps happening, please open an issue on GitHub.\n'));
  process.exit(1);
});
