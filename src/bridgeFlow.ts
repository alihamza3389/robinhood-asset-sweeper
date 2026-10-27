import ora from 'ora';
import { Address, Hex } from 'viem';
import { DEFAULTS } from './constants.js';
import { ActionResult, Config, NativeAsset } from './types.js';
import { ActionContext } from './actions/context.js';
import {
  BridgeAmount,
  BridgeQuote,
  bridgeFee,
  checkEthereumRecipient,
  isStale,
  prepareBridge,
  sendBridge,
  trackDeposit,
} from './actions/bridge.js';
import { BridgeError, fetchEthUsd, fetchLimits } from './bridge/across.js';
import { createEthereumClient } from './chain.js';
import { formatEthShort, formatUsd, wrap } from './ui/format.js';
import { maxSendable } from './actions/transfer.js';
import { ACROSS } from './constants.js';
import { box, c, emoji, step, sym, tip } from './ui/theme.js';
import { confirmAddressTail, confirmBridge, promptBridgeAmount, promptBridgeDestination } from './ui/prompts.js';
import { printBridgeOutcome, printBridgeQuote } from './ui/bridgeScreens.js';
import { printSummary, runStep } from './ui/screens.js';

type EthereumClient = ReturnType<typeof createEthereumClient>;

const STEPS = 5;

const refused = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.log('\n' + box([...wrap(msg), '', c.dim('Nothing was bridged. Your ETH stays in this wallet.')], { title: `${sym.fail} Bridge stopped`, color: c.danger }));
};

/** Asks where the ETH should arrive on Ethereum and checks it is a normal wallet there. */
export async function chooseBridgeDestination(sender: Address, saved: Address | undefined, l1: EthereumClient): Promise<Address | undefined> {
  tip('Double-check the address. Crypto sent to the wrong address cannot be recovered.');
  const { address, typed } = await promptBridgeDestination(sender, saved);
  if (typed && !(await confirmAddressTail(address))) return undefined;
  const spinner = ora({ text: 'Checking the address on Ethereum…', discardStdin: false }).start();
  try {
    await checkEthereumRecipient(l1, address);
    spinner.stop();
    return address;
  } catch (err) {
    spinner.stop();
    refused(err);
    return undefined;
  }
}

/**
 * Quote, show, and ask. A quote that gets old while the user reads it is replaced with a fresh one
 * and shown again, so an old price is never signed. `ask: false` skips the question (practice runs
 * that were already confirmed).
 */
export async function quoteAndConfirm(opts: {
  ctx: ActionContext;
  amountArg: BridgeAmount;
  recipient: Address;
  ethUsd?: number;
  ask: boolean;
}): Promise<BridgeQuote | undefined> {
  const { ctx, amountArg, recipient, ethUsd, ask } = opts;
  for (;;) {
    const spinner = ora({ text: 'Getting the bridge quote…', discardStdin: false }).start();
    let q: BridgeQuote;
    try {
      q = await prepareBridge({ ...ctx, onStatus: (t) => (spinner.text = t) }, amountArg, recipient);
      spinner.stop();
    } catch (err) {
      spinner.stop();
      if (!(err instanceof BridgeError)) throw err;
      refused(err);
      return undefined;
    }
    printBridgeQuote({ q, amountArg, from: ctx.owner, ethUsd });
    if (!ask) return q;
    const answer = await confirmBridge(ctx.dryRun);
    if (answer === 'no') {
      console.log(c.dim('\nCancelled. Nothing was sent.'));
      return undefined;
    }
    if (answer === 'yes' && !isStale(q)) return q;
    console.log(c.warn(`\n${sym.warn} That quote is more than a minute old, so here is a fresh one. Please check it again.`));
  }
}

/** Sign and send the checked deposit, then follow it until it arrives on Ethereum. */
export async function executeBridge(opts: {
  ctx: ActionContext;
  native: NativeAsset;
  q: BridgeQuote;
  l1: EthereumClient;
  explorerUrl: string;
  ethUsd?: number;
  label: string;
}): Promise<ActionResult> {
  const { ctx, native, q, l1, explorerUrl, ethUsd, label } = opts;
  // Read alongside the send rather than before it, so it never delays the deposit.
  const beforeP = ctx.dryRun ? Promise.resolve(undefined) : l1.getBalance({ address: q.recipient }).catch(() => undefined);
  const result = await runStep(
    { doing: `${label} Bridging ${formatEthShort(q.amount)} ETH to Ethereum…`, done: 'Bridged', would: 'Would bridge' },
    (onStatus) => sendBridge({ ...ctx, onStatus }, native, q),
    explorerUrl
  );
  if (result.status !== 'success' || !result.txHash) {
    if (result.txHash) printBridgeOutcome({ result: { status: 'timeout' }, depositHash: result.txHash, explorerUrl, recipient: q.recipient });
    return result;
  }

  const before = await beforeP;
  const spinner = ora({ text: 'Waiting for Across to deliver it on Ethereum (usually under a minute)…', discardStdin: false }).start();
  const tracked = await trackDeposit(result.txHash, (t) => (spinner.text = `Waiting for Across to deliver it on Ethereum · ${c.dim(t)}`));
  spinner.stop();
  // Public RPCs can lag a block behind the fill: wait briefly until the payout is visible.
  let after: bigint | undefined;
  for (let i = 0; tracked.status === 'filled' && before !== undefined && i < 6; i++) {
    after = await l1.getBalance({ address: q.recipient }).catch(() => undefined);
    if (after !== undefined && after >= before + q.guaranteed) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  printBridgeOutcome({ result: tracked, depositHash: result.txHash, explorerUrl, recipient: q.recipient, before, after, ethUsd });
  return result;
}

/** "Bridge ETH to Ethereum": steps 2 to 5 for plain ETH (no token scan needed). */
export async function runBridgeMode(opts: { config: Config; ctx: ActionContext }) {
  const { config, ctx } = opts;
  const { publicClient, owner } = ctx;
  const l1 = createEthereumClient(config.blockscoutApiKey);
  const recipient = await chooseBridgeDestination(owner, config.defaultDestination, l1);
  if (!recipient) return;

  step(2, STEPS, 'Checking your ETH');
  const spinner = ora({ text: 'Reading your balance and the bridge limits…', discardStdin: false }).start();
  const [balance, block, limits, price] = await Promise.all([
    publicClient.getBalance({ address: owner }),
    publicClient.getBlock(),
    fetchLimits(),
    fetchEthUsd(),
  ]);
  spinner.stop();
  const available = maxSendable(balance, ACROSS.MAX_GAS, bridgeFee(block.baseFeePerGas ?? 0n).maxFee);
  const usd = (wei: bigint) => (price ? c.dim(` (${formatUsd((Number(wei) / 1e18) * price.usd)})`) : '');
  const lines = [
    `${c.dim('ETH')}           ${formatEthShort(balance)} ETH${usd(balance)}`,
    `${c.dim('Can bridge')}    up to ${formatEthShort(available)} ETH ${c.dim('(a little is kept back for the fee)')}`,
  ];
  if (limits) lines.push(`${c.dim('Across limits')} min ${formatEthShort(limits.min, 'up')} ETH${usd(limits.min)}, max ${formatEthShort(limits.max)} ETH`);
  if (!price) lines.push(c.dim('The ETH price is unavailable right now, so amounts are in ETH only.'));
  else if (price.sources === 1) lines.push(c.dim('Only one ETH price source answered; double-check any dollar amount.'));
  console.log('\n' + box(lines, { title: `${emoji('👛')}Your wallet` }));

  if (available <= 0n || (limits && available < limits.min)) {
    const why = available <= 0n ? 'There is no ETH to bridge after keeping back the network fee.' : 'Your ETH is below the Across minimum for a bridge.';
    console.log('\n' + box([why], { title: 'Nothing to do', color: c.warn }));
    return;
  }

  step(3, STEPS, 'Choose the amount');
  const amountArg = await promptBridgeAmount({ available, min: limits?.min, price });

  step(4, STEPS, 'Review', 'Nothing has been sent yet.');
  const ethUsd = price?.usd;
  const q = await quoteAndConfirm({ ctx, amountArg, recipient, ethUsd, ask: true });
  if (!q) return;

  step(5, STEPS, config.dryRun ? 'Simulating' : 'Sending', config.dryRun ? undefined : 'Please keep this window open until it finishes.');
  const native: NativeAsset = { kind: 'native', symbol: config.nativeSymbol, name: 'Ether', decimals: config.nativeDecimals, balance };
  const result = await executeBridge({ ctx, native, q, l1, explorerUrl: config.explorerUrl, ethUsd, label: c.dim('[1/1]') });
  printSummary([result], config, ethUsd);
}

/** `--track <hash>`: check on a deposit that was sent earlier. Needs no key. */
export async function runTrack(hash: Hex) {
  console.log(`\n${c.dim('Deposit')}  ${c.addr(`${DEFAULTS.explorerUrl}/tx/${hash}`)}`);
  const spinner = ora({ text: 'Asking Across where this deposit is…', discardStdin: false }).start();
  const result = await trackDeposit(hash, (t) => (spinner.text = `Asking Across where this deposit is · ${c.dim(t)}`), 60_000);
  spinner.stop();
  printBridgeOutcome({ result, depositHash: hash, explorerUrl: DEFAULTS.explorerUrl, showTime: false });
}
