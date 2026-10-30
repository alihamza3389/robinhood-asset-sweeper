import ora from 'ora';
import { Address, getAddress, isAddress } from 'viem';
import { confirm } from '@inquirer/prompts';
import { HELP, loadConfig, parseCli } from './config.js';
import { askBlockscoutKey, envExists, runSetupWizard } from './setup.js';
import { runReset } from './reset.js';
import { checkForUpdate, fetchReleases, MIN_DOWNLOADS_SHOWN, RESTART_EXIT_CODE } from './update.js';
import { Clients, createClients, createEthereumClients } from './chain.js';
import { chooseBridgeDestination, executeBridge, quoteAndConfirm, runBridgeMode, runTrack } from './bridgeFlow.js';
import { fetchLimits } from './bridge/across.js';
import { BRIDGE_ROUTES, CONTRACTS, DEAD_ADDRESS, DEFAULTS, FALLBACK_STOCK_TOKENS } from './constants.js';
import { Asset, ActionResult, Config, OperationMode, TokenAsset, hasFinalEthStep, sellsTokens } from './types.js';
import { loadCustomTokens, saveCustomToken } from './scan/customTokens.js';
import { fetchRobinhoodStocks } from './scan/registry.js';
import { fetchPrices, PriceBook } from './scan/prices.js';
import { addDexRoutes, readTokens, scanWallet, ScanResult } from './scan/wallet.js';
import { BlockscoutKeyError } from './scan/blockscout.js';
import { ActionContext, describeError } from './actions/context.js';
import { sendNative, transferToken } from './actions/transfer.js';
import { sellToken } from './actions/sell.js';
import { formatAmount, formatEthShort, usdValue } from './ui/format.js';
import { banner, box, c, emoji, printPractice, promptTheme, step, sym, tip } from './ui/theme.js';
import { printDonations, printReview, printSummary, printTokenList, printWalletCard, runStep } from './ui/screens.js';
import {
  confirmAddressTail,
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
  BRIDGE: ['Bridging', 'Bridged', 'Would bridge'],
  SELL_AND_BRIDGE: ['Selling', 'Sold', 'Would sell'],
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
      case 'SELL_AND_BRIDGE':
        return a.kind === 'erc20' && a.route !== 'NONE';
      case 'BRIDGE':
        return false; // has its own flow (runBridgeMode) and never gets here
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
  const releases = await fetchReleases();
  const downloads = releases && releases.downloads >= MIN_DOWNLOADS_SHOWN ? releases.downloads : undefined;
  banner(cli.dryRun, downloads);
  // Before anything else (and before the key is unlocked): offer a newer version if there is one.
  if (!cli.reset && (await checkForUpdate(releases))) {
    process.exit(process.env.SWEEPER_LAUNCHER === '1' ? RESTART_EXIT_CODE : 0);
  }
  if (cli.reset) {
    await runReset();
    return;
  }
  if (cli.track) {
    await runTrack(cli.track);
    return;
  }
  const wizard = cli.setup || (!envExists() && !process.env.PRIVATE_KEY && !cli.look) ? await runSetupWizard() : undefined;
  const config = await loadConfig(cli, { look: wizard?.look });
  if (!config.blockscoutApiKey) {
    config.blockscoutApiKey = await promptBlockscoutKey(config.chainId);
  }

  const { account, publicClient, walletClient } = createClients(config);
  const sender = config.lookAt ?? account.address;
  if (config.lookAt) printPractice(config.lookAt);
  else console.log(`\n${c.dim('Wallet')}  ${c.addr(sender)}  ${c.dim(`on ${config.chainName}`)}`);

  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== config.chainId) {
    throw new Error(`The RPC at ${config.rpcUrl} is on chain ${rpcChainId}, not ${config.chainId}. Stopping to keep your funds safe.`);
  }

  const session: Session = { config, publicClient, walletClient, sender, canBridge: config.chainId === DEFAULTS.chainId };
  // Back to the menu after every action, finished or cancelled, so answering "No" never closes the
  // tool (and the key is not asked for again). Only Exit or Ctrl+C closes it.
  for (let first = true; ; first = false) {
    if (!first) console.log(c.dim(`\n${'─'.repeat(48)}\nBack to the menu. Choose Exit when you are done.`));
    step(
      1,
      STEPS,
      'Choose what to do',
      config.dryRun ? 'Practice mode is ON: everything is simulated, nothing is sent.' : 'Use the arrow keys, then press Enter.'
    );
    const choice = await promptMode(session.canBridge, { on: config.dryRun, locked: config.lookAt !== undefined });
    if (choice === 'QUIT') break;
    if (choice === 'PRACTICE') {
      // The same config object is read by every action, so this takes effect right away.
      config.dryRun = !config.dryRun;
      if (config.dryRun) printPractice();
      else console.log('\n' + box([c.bold('Practice mode is OFF.'), 'Confirmed actions will now be signed and sent for real.'], { color: c.brand }));
      continue;
    }
    try {
      await runAction(choice, session);
    } catch (err) {
      if (err instanceof Error && err.name === 'ExitPromptError') throw err;
      console.error('\n' + box([describeError(err)], { title: `${sym.fail} Something went wrong`, color: c.danger }));
      console.error(c.dim('Nothing more was sent for this step. You can try again from the menu.'));
    }
  }
  console.log(c.dim('\nBye!'));
  printDonations();
}

interface Session {
  config: Config;
  publicClient: Clients['publicClient'];
  walletClient: Clients['walletClient'];
  sender: Address;
  canBridge: boolean;
}

/** One action from the menu. Returning (done, cancelled or nothing to do) goes back to the menu. */
async function runAction(mode: OperationMode, session: Session) {
  const { config, publicClient, walletClient, sender } = session;
  if (mode === 'BRIDGE') {
    await runBridgeMode({ config, robinhood: { publicClient, walletClient, owner: sender, dryRun: config.dryRun } });
    return;
  }
  let destination: Address | undefined;
  let ethereum: ReturnType<typeof createEthereumClients> | undefined;
  if (mode === 'TRANSFER' || mode === 'SELL_AND_SWEEP') {
    tip('Double-check the address. Crypto sent to the wrong address cannot be recovered.');
    destination = await promptDestination(sender, config.defaultDestination);
    if (destination !== config.defaultDestination && !(await confirmAddressTail(destination))) return;
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
  } else if (mode === 'SELL_AND_BRIDGE') {
    ethereum = createEthereumClients(config);
    destination = await chooseBridgeDestination({
      route: BRIDGE_ROUTES.toEthereum,
      sender,
      saved: config.defaultDestination,
      dest: ethereum.publicClient,
    });
    if (!destination) return;
  } else if (mode === 'BURN') {
    destination = DEAD_ADDRESS;
  }

  // Step 2: scan. Blockscout lists the tokens, the chain confirms balances.
  step(2, STEPS, 'Looking through your wallet');
  // Needed only at the review; fetched alongside the scan so it never holds anything up.
  const limitsP = mode === 'SELL_AND_BRIDGE' ? fetchLimits(BRIDGE_ROUTES.toEthereum) : undefined;
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
  // Tokens priced only by their Uniswap v4 pool (e.g. launchpad tokens).
  if (prices.ethUsd) for (const [addr, eth] of scan.poolPrices) if (!prices.tokens.has(addr)) prices.tokens.set(addr, eth * prices.ethUsd);
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

  // Manual additions: each is checked and saved right away (only real tokens are saved),
  // and saved tokens are checked on-chain on every future run.
  await promptManualTokens(async (addr) => {
    const routed = await addDexRoutes(publicClient, await readTokens(publicClient, sender, [addr], stocks), config.chainId, config.blockscoutApiKey);
    for (const [a, eth] of routed.ethPerToken) if (prices.ethUsd && !prices.tokens.has(a)) prices.tokens.set(a, eth * prices.ethUsd);
    const [token] = routed.tokens;
    if (!token) {
      console.log(c.danger(`  ${sym.fail} ${addr} is not a token contract, so it was not added.`));
      return;
    }
    saveCustomToken(token.address);
    if (assets.some((a) => a.kind === 'erc20' && a.address === token.address)) {
      console.log(c.dim(`  ${token.symbol} is already in the list. Saved, so it's always checked from now on.`));
    } else if (token.balance === 0n) {
      console.log(c.dim(`  ${token.symbol}: you hold none right now. Saved, and it will be checked on future runs.`));
    } else {
      assets.push(withPrice(label(token), prices));
      console.log(c.brand(`  ${sym.ok} Added ${token.symbol} (${formatAmount(token.balance, token.decimals)}). It will be remembered.`));
    }
  });

  assets = assets.sort((a, b) => (usdValue(b) ?? -1) - (usdValue(a) ?? -1));
  const { eligible, excluded } = eligibleFor(mode, assets);
  if (eligible.length === 0) {
    const why =
      sellsTokens(mode)
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
            ...(session.canBridge
              ? ['', c.dim('Have ETH on Ethereum? Choose "Bridge ETH", then'), c.dim(`"Ethereum ${sym.arrow} Robinhood Chain" to bring some over.`)]
              : []),
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
  if (excluded.length && sellsTokens(mode)) {
    tip(`Not listed because they can't be sold here: ${excluded.map((a) => a.symbol).join(', ')}`);
  }
  const selected = await promptAssets(mode, eligible);
  const plan = await promptAmounts(selected);
  // Tokens first; native ETH last so fees for the token transfers are still available.
  plan.sort((a, b) => Number(a.asset.kind === 'native') - Number(b.asset.kind === 'native'));

  // Step 4: review
  step(4, STEPS, 'Review', 'Nothing has been sent yet.');
  printReview(mode, plan, mode === 'SELL' ? undefined : destination, config);
  if (mode === 'SELL_AND_BRIDGE') {
    // Rough check before selling anything: will there be enough ETH to bridge afterwards?
    const limits = await limitsP;
    const ethFromSales = prices.ethUsd ? plan.reduce((s, p) => s + (usdValue(p.asset, p.amount) ?? 0), 0) / prices.ethUsd : 0;
    const estimate = Number(scan.native.balance) / 1e18 + ethFromSales;
    if (limits && estimate < Number(limits.min) / 1e18) {
      tip(c.warn(`After the sales you may have less ETH than the Across minimum (${formatEthShort(limits.min, 'up')} ETH). If so, the ETH stays here.`));
    }
  }
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
  const n = plan.length + (hasFinalEthStep(mode) ? 1 : 0);

  for (const [i, { asset, amount, max }] of plan.entries()) {
    const labels = { doing: `${c.dim(`[${i + 1}/${n}]`)} ${doing} ${asset.symbol}…`, done, would };
    if (sellsTokens(mode)) {
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

  if (mode === 'SELL_AND_BRIDGE') {
    if (results.some((r) => r.status === 'failed')) {
      console.log(c.warn(`${sym.warn} The ETH was not bridged, because a sale failed. It stays here so you can try again.`));
    } else {
      console.log(`\n${c.bold('Now the bridge.')} ${c.dim('Here is the quote for all your ETH:')}`);
      if (config.dryRun) tip('Practice run: the sales above were only simulated, so this quote uses the ETH you have now.');
      const route = BRIDGE_ROUTES.toEthereum;
      const q = await quoteAndConfirm({ ctx, route, amountArg: { kind: 'max' }, recipient: destination!, ethUsd: prices.ethUsd, ask: !config.dryRun });
      if (q) {
        results.push(
          await executeBridge({ ctx, native: scan.native, q, dest: ethereum!.publicClient, ethUsd: prices.ethUsd, label: c.dim(`[${n}/${n}]`) })
        );
      }
    }
  }

  printSummary(results, config, prices.ethUsd);
}

// If the output is closed early (e.g. piped into `head`), just stop quietly.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

main().catch((err: unknown) => {
  if (err instanceof Error && err.name === 'ExitPromptError') {
    console.log(c.dim('\n\nClosed. Nothing more was sent.'));
    process.exit(130);
  }
  console.error('\n' + box([describeError(err)], { title: `${sym.fail} Something went wrong`, color: c.danger }));
  console.error(c.dim('Nothing more will be sent. If this keeps happening, please open an issue on GitHub.\n'));
  process.exit(1);
});
