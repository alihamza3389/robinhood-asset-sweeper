import ora from 'ora';
import { Address, Hex, PublicClient as ViemPublicClient, createPublicClient, http } from 'viem';
import { ACROSS, ACROSS_CHAINS, AcrossChain, BRIDGE_ROUTES, BridgeRoute, ETHEREUM_RPC, PUBLICNODE_RPC } from './constants.js';
import { ActionResult, Config, NativeAsset } from './types.js';
import {
  BridgeAmount,
  BridgeContext,
  BridgeQuote,
  checkRecipient,
  currentBridgeFee,
  isStale,
  prepareBridge,
  sendBridge,
  trackDeposit,
} from './actions/bridge.js';
import { maxSendable } from './actions/transfer.js';
import { BridgeError, fetchEthUsd, fetchLimits } from './bridge/across.js';
import { createEthereumClients } from './chain.js';
import { formatEthShort, formatUsd, wrap } from './ui/format.js';
import { box, c, emoji, step, sym, tip } from './ui/theme.js';
import { confirmAddressTail, confirmBridge, promptBridgeAmount, promptBridgeDestination, promptBridgeDirection } from './ui/prompts.js';
import { printBridgeOutcome, printBridgeQuote } from './ui/bridgeScreens.js';
import { printSummary, runStep } from './ui/screens.js';

const STEPS = 5;

const refused = (err: unknown, route: BridgeRoute) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(
    '\n' +
      box([...wrap(msg), '', c.dim(`Nothing was bridged. Your ETH stays in your wallet on ${route.from.name}.`)], {
        title: `${sym.fail} Bridge stopped`,
        color: c.danger,
      })
  );
};

/** Asks where the ETH should arrive and checks it is a normal wallet on the destination chain. */
export async function chooseBridgeDestination(opts: {
  route: BridgeRoute;
  sender: Address;
  saved?: Address;
  dest: Pick<ViemPublicClient, 'getCode'>;
}): Promise<Address | undefined> {
  const { route, sender, saved, dest } = opts;
  tip('Double-check the address. Crypto sent to the wrong address cannot be recovered.');
  const { address, typed } = await promptBridgeDestination(sender, route.to.name, saved);
  if (typed && !(await confirmAddressTail(address))) return undefined;
  const spinner = ora({ text: `Checking the address on ${route.to.name}…`, discardStdin: false }).start();
  try {
    await checkRecipient(dest, route.to.name, address);
    spinner.stop();
    return address;
  } catch (err) {
    spinner.stop();
    refused(err, route);
    return undefined;
  }
}

/**
 * Quote, show, and ask. A quote that gets old while the user reads it is replaced with a fresh one
 * and shown again, so an old price is never signed. `ask: false` skips the question (practice runs
 * that were already confirmed).
 */
export async function quoteAndConfirm(opts: {
  ctx: BridgeContext;
  route: BridgeRoute;
  amountArg: BridgeAmount;
  recipient: Address;
  ethUsd?: number;
  ask: boolean;
}): Promise<BridgeQuote | undefined> {
  const { ctx, route, amountArg, recipient, ethUsd, ask } = opts;
  for (;;) {
    const spinner = ora({ text: 'Getting the bridge quote…', discardStdin: false }).start();
    let q: BridgeQuote;
    try {
      q = await prepareBridge({ ...ctx, onStatus: (t) => (spinner.text = t) }, route, amountArg, recipient);
      spinner.stop();
    } catch (err) {
      spinner.stop();
      if (!(err instanceof BridgeError)) throw err;
      refused(err, route);
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

/** Sign and send the checked deposit, then follow it until it arrives. */
export async function executeBridge(opts: {
  ctx: BridgeContext;
  native: NativeAsset;
  q: BridgeQuote;
  /** Reads the destination chain, for the before -> after balance. */
  dest: Pick<ViemPublicClient, 'getBalance'>;
  ethUsd?: number;
  label: string;
}): Promise<ActionResult> {
  const { ctx, native, q, dest, ethUsd, label } = opts;
  const { from: origin, to: destChain } = q.route;
  // Read alongside the send rather than before it, so it never delays the deposit.
  const beforeP = ctx.dryRun ? Promise.resolve(undefined) : dest.getBalance({ address: q.recipient }).catch(() => undefined);
  const result = await runStep(
    { doing: `${label} Bridging ${formatEthShort(q.amount)} ETH to ${destChain.name}…`, done: 'Bridged', would: 'Would bridge' },
    (onStatus) => sendBridge({ ...ctx, onStatus }, native, q),
    origin.explorer
  );
  if (result.status !== 'success' || !result.txHash) {
    if (result.txHash) printBridgeOutcome({ result: { status: 'timeout' }, depositHash: result.txHash, origin, dest: destChain, recipient: q.recipient });
    return result;
  }

  const before = await beforeP;
  const waiting = `Waiting for Across to deliver it on ${destChain.name}`;
  const spinner = ora({ text: `${waiting} (usually under a minute)…`, discardStdin: false }).start();
  const tracked = await trackDeposit(result.txHash, (t) => (spinner.text = `${waiting} · ${c.dim(t)}`));
  spinner.stop();
  // Public RPCs can lag a block behind the fill: wait briefly until the payout is visible.
  let after: bigint | undefined;
  for (let i = 0; tracked.status === 'filled' && before !== undefined && i < 6; i++) {
    after = await dest.getBalance({ address: q.recipient }).catch(() => undefined);
    if (after !== undefined && after >= before + q.guaranteed) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  printBridgeOutcome({ result: tracked, depositHash: result.txHash, origin, dest: destChain, recipient: q.recipient, before, after, ethUsd });
  return result;
}

/** "Bridge ETH": pick a direction, then steps 2 to 5 for plain ETH (no token scan needed). */
export async function runBridgeMode(opts: { config: Config; robinhood: BridgeContext }) {
  const { config, robinhood } = opts;
  const owner = robinhood.owner;
  const route = BRIDGE_ROUTES[await promptBridgeDirection()];
  const ethereum = createEthereumClients(config);
  const fromEthereum = route.from.id === ACROSS.ETHEREUM.id;
  const ctx: BridgeContext = fromEthereum ? { ...ethereum, owner, dryRun: config.dryRun } : robinhood;
  const destClient = fromEthereum ? robinhood.publicClient : ethereum.publicClient;

  const recipient = await chooseBridgeDestination({ route, sender: owner, saved: config.defaultDestination, dest: destClient });
  if (!recipient) return;

  step(2, STEPS, `Checking your ETH on ${route.from.name}`);
  const spinner = ora({ text: 'Reading your balance and the bridge limits…', discardStdin: false }).start();
  const [balance, fee, limits, price] = await Promise.all([
    ctx.publicClient.getBalance({ address: owner }),
    currentBridgeFee(route, ctx.publicClient),
    fetchLimits(route),
    fetchEthUsd(),
  ]);
  spinner.stop();
  const available = maxSendable(balance, ACROSS.MAX_GAS, fee.maxFee);
  const usd = (wei: bigint) => (price ? c.dim(` (${formatUsd((Number(wei) / 1e18) * price.usd)})`) : '');
  const lines = [
    `${c.dim('ETH')}           ${formatEthShort(balance)} ETH${usd(balance)} ${c.dim(`on ${route.from.name}`)}`,
    `${c.dim('Can bridge')}    up to ${formatEthShort(available)} ETH ${c.dim('(a little is kept back for the fee)')}`,
  ];
  if (limits) lines.push(`${c.dim('Across limits')} min ${formatEthShort(limits.min, 'up')} ETH${usd(limits.min)}, max ${formatEthShort(limits.max)} ETH`);
  if (!price) lines.push(c.dim('The ETH price is unavailable right now, so amounts are in ETH only.'));
  else if (price.sources === 1) lines.push(c.dim('Only one ETH price source answered; double-check any dollar amount.'));
  console.log('\n' + box(lines, { title: `${emoji('👛')}Your wallet on ${route.from.name}` }));

  if (available <= 0n || (limits && available < limits.min)) {
    const why =
      available <= 0n
        ? `There is no ETH to bridge on ${route.from.name} after keeping back the network fee.`
        : `Your ETH on ${route.from.name} is below the Across minimum for a bridge.`;
    const hint = fromEthereum ? wrap(`Send some ETH to ${owner} on Ethereum first.`) : [];
    console.log('\n' + box([...wrap(why), ...hint], { title: 'Nothing to do', color: c.warn }));
    return;
  }

  step(3, STEPS, 'Choose the amount');
  const amountArg = await promptBridgeAmount({ available, min: limits?.min, price, practice: config.dryRun });

  step(4, STEPS, 'Review', 'Nothing has been sent yet.');
  const ethUsd = price?.usd;
  const q = await quoteAndConfirm({ ctx, route, amountArg, recipient, ethUsd, ask: true });
  if (!q) return;

  step(5, STEPS, config.dryRun ? 'Simulating' : 'Sending', config.dryRun ? undefined : 'Please keep this window open until it finishes.');
  const native: NativeAsset = { kind: 'native', symbol: config.nativeSymbol, name: 'Ether', decimals: config.nativeDecimals, balance };
  const result = await executeBridge({ ctx, native, q, dest: destClient, ethUsd, label: c.dim('[1/1]') });
  printSummary([result], { ...config, explorerUrl: route.from.explorer }, ethUsd);
}

/** Public RPCs used only to find which chain a deposit hash is on (no key needed). */
const LOOKUP_RPC: Record<number, string> = { [ACROSS.ROBINHOOD.id]: PUBLICNODE_RPC, [ACROSS.ETHEREUM.id]: ETHEREUM_RPC };

/** The chain a transaction hash was sent on, or undefined if neither chain knows it. */
async function findDepositChain(hash: Hex): Promise<AcrossChain | undefined> {
  const found = await Promise.all(
    ACROSS_CHAINS.map((ch) =>
      createPublicClient({ transport: http(LOOKUP_RPC[ch.id], { timeout: 15_000 }) })
        .getTransaction({ hash })
        .then(() => ch, () => undefined)
    )
  );
  return found.find((ch) => ch !== undefined);
}

/** `--track <hash>`: check on a deposit that was sent earlier (either direction). Needs no key. */
export async function runTrack(hash: Hex) {
  const spinner = ora({ text: 'Asking Across where this deposit is…', discardStdin: false }).start();
  const [origin, result] = await Promise.all([
    findDepositChain(hash),
    trackDeposit(hash, (t) => (spinner.text = `Asking Across where this deposit is · ${c.dim(t)}`), 60_000),
  ]);
  spinner.stop();
  const dest = origin && ACROSS_CHAINS.find((ch) => ch.id !== origin.id);
  printBridgeOutcome({ result, depositHash: hash, origin, dest, showTime: false });
}
