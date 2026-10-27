import { Address, Hex, PublicClient as ViemPublicClient, TransactionSerialized } from 'viem';
import { ACROSS, DEFAULTS } from '../constants.js';
import { ActionResult, NativeAsset } from '../types.js';
import { ActionContext, describeError, waitForSuccess } from './context.js';
import { maxSendable } from './transfer.js';
import { formatEthShort } from '../ui/format.js';
import {
  BridgeError,
  Competitor,
  DepositStatus,
  Limits,
  PlannedTx,
  fetchAcrossQuote,
  fetchCompetitors,
  fetchDepositStatus,
  fetchLimits,
  signedMismatch,
  verifyQuote,
} from '../bridge/across.js';

/** A quote older than this is fetched again rather than signed. */
const MAX_QUOTE_AGE_MS = 90_000;
/** The signed transaction must reach the chain at least this long before Across's own quote expiry. */
const EXPIRY_MARGIN_MS = 30_000;
/** Fee floor and ceiling: pay at most 2x the current base fee, and never less than 0.02 gwei. */
const MIN_MAX_FEE = 20_000_000n;

export type BridgeAmount =
  | { kind: 'max' }
  | { kind: 'eth'; wei: bigint }
  /** Typed in dollars; converted to ETH once, at `usdPrice`, so the amount never moves under the user. */
  | { kind: 'usd'; usd: string; wei: bigint; usdPrice: number };

export interface BridgeQuote {
  amount: bigint;
  recipient: Address;
  /** Across must deliver at least this on Ethereum. */
  guaranteed: bigint;
  expected: bigint;
  gasUsd: number;
  fillSeconds: number;
  limits?: Limits;
  competitors: Competitor[];
  planned: PlannedTx;
  quotedAt: number;
  expiresAt: number;
}

/** The ETH kept back for the bridge's network fee, at the given base fee. Exported for tests. */
export function bridgeFee(baseFeePerGas: bigint): { maxFee: bigint; reserve: bigint } {
  const twice = 2n * baseFeePerGas;
  const maxFee = twice > MIN_MAX_FEE ? twice : MIN_MAX_FEE;
  return { maxFee, reserve: ACROSS.MAX_GAS * maxFee };
}

/**
 * Get a quote from Across (plus comparison quotes), check every field of the deposit and simulate it
 * against the live chain. Throws BridgeError with a plain-English reason if anything is off.
 */
export async function prepareBridge(ctx: ActionContext, amountArg: BridgeAmount, recipient: Address): Promise<BridgeQuote> {
  const { publicClient, owner } = ctx;
  ctx.onStatus?.('Checking your balance…');
  const [chainId, balance, block] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBalance({ address: owner }),
    publicClient.getBlock(),
  ]);
  // The RPC must really be Robinhood Chain: anywhere else the Across contract does not exist.
  if (chainId !== DEFAULTS.chainId) throw new BridgeError(`The RPC is on chain ${chainId}, not Robinhood Chain. Stopping to keep your funds safe.`);
  const { maxFee, reserve } = bridgeFee(block.baseFeePerGas ?? 0n);
  const amount = amountArg.kind === 'max' ? maxSendable(balance, ACROSS.MAX_GAS, maxFee) : amountArg.wei;
  if (amount <= 0n) throw new BridgeError('There is not enough ETH to bridge after keeping back the network fee.');
  if (amount + reserve > balance) throw new BridgeError('Not enough ETH for this amount plus the network fee.');

  ctx.onStatus?.('Getting quotes from Across and other bridges…');
  const [limits, across, competitors] = await Promise.all([
    fetchLimits(),
    // Timed when the quote itself arrives, not when the slower comparison quotes do.
    fetchAcrossQuote(amount, owner, recipient).then(
      (quote) => ({ quote, at: Date.now() }),
      (e: Error) => e // reported after the limit checks, which explain the usual cause more clearly
    ),
    fetchCompetitors(amount, owner),
  ]);
  if (limits && amount < limits.min) throw new BridgeError(`That is below the Across minimum (${formatEthShort(limits.min, 'up')} ETH).`);
  if (limits && amount > limits.max) throw new BridgeError(`That is above the Across maximum right now (${formatEthShort(limits.max)} ETH).`);
  if (across instanceof Error) throw new BridgeError(`Across could not quote this right now (${across.message.slice(0, 120)}).`);
  const { quote: quoted, at: quotedAt } = across;
  const { guaranteed, gasLimit } = verifyQuote(quoted, amount, owner, recipient);

  ctx.onStatus?.('Testing the deposit against the live chain…');
  try {
    await publicClient.call({ account: owner, to: quoted.swapTx.to, data: quoted.swapTx.data, value: amount });
  } catch (err) {
    throw new BridgeError(`The deposit failed in simulation: ${describeError(err)}`);
  }

  return {
    amount,
    recipient,
    guaranteed,
    expected: BigInt(quoted.expectedOutputAmount),
    gasUsd: Number(quoted.fees.originGas.amountUsd),
    fillSeconds: quoted.expectedFillTime,
    limits,
    competitors,
    planned: { to: quoted.swapTx.to, data: quoted.swapTx.data, value: amount, gasLimit, maxFee },
    quotedAt,
    expiresAt: quoted.quoteExpiryTimestamp * 1000,
  };
}

/** Too old to sign: fetch a fresh quote instead. */
export const isStale = (q: BridgeQuote, now = Date.now()) => now - q.quotedAt > MAX_QUOTE_AGE_MS || now > q.expiresAt - EXPIRY_MARGIN_MS;

/**
 * Sign the checked deposit, prove the signed bytes are exactly that deposit, then send it.
 * In practice mode it stops after the simulation that prepareBridge already ran.
 */
export async function sendBridge(ctx: ActionContext, asset: NativeAsset, q: BridgeQuote): Promise<ActionResult> {
  const { publicClient, walletClient, owner } = ctx;
  if (ctx.dryRun) {
    return { asset, status: 'simulated', amount: q.amount, message: `Across would deliver at least ${formatEthShort(q.guaranteed)} ETH` };
  }
  if (isStale(q)) return { asset, status: 'failed', message: 'The quote went stale, so nothing was sent. Please run it again.' };

  let hash: Hex;
  try {
    const nonce = await publicClient.getTransactionCount({ address: owner, blockTag: 'pending' });
    const signed = (await walletClient.account.signTransaction({
      chainId: DEFAULTS.chainId,
      type: 'eip1559',
      to: q.planned.to,
      data: q.planned.data,
      value: q.planned.value,
      gas: q.planned.gasLimit,
      maxFeePerGas: q.planned.maxFee,
      maxPriorityFeePerGas: 0n,
      nonce,
    })) as TransactionSerialized;
    const mismatch = await signedMismatch(signed, q.planned, owner);
    if (mismatch) return { asset, status: 'failed', message: `The signed deposit differs from the checked one (${mismatch}), so nothing was sent.` };
    ctx.onStatus?.('Sending the deposit…');
    hash = await publicClient.sendRawTransaction({ serializedTransaction: signed });
  } catch (err) {
    return { asset, status: 'failed', message: `${describeError(err)}. Nothing was sent.` };
  }

  // From here on the deposit exists: every message must say so, so it is never sent twice.
  try {
    ctx.onStatus?.(`Waiting for confirmation (${hash.slice(0, 10)}…)`);
    await waitForSuccess(publicClient, hash);
  } catch (err) {
    return { asset, status: 'failed', txHash: hash, message: `${describeError(err)} Do NOT bridge again until you have checked it.` };
  }
  return { asset, status: 'success', amount: q.amount, txHash: hash };
}

export type TrackResult =
  | { status: 'filled'; fillHash: Hex; seconds: number }
  | { status: 'refunded'; refundHash?: Hex }
  | { status: 'timeout' }
  /** Across never saw a deposit with this hash in the whole time. */
  | { status: 'unknown' };

/** Follow a deposit until Across delivers it on Ethereum (or refunds it), for up to `timeoutMs`. */
export async function trackDeposit(
  hash: Hex,
  onStatus: (text: string) => void,
  timeoutMs = 15 * 60_000,
  pollMs = 4_000,
  status: (h: Hex) => Promise<DepositStatus> = fetchDepositStatus
): Promise<TrackResult> {
  const start = Date.now();
  let misses = 0;
  let seen = false;
  while (Date.now() - start < timeoutMs) {
    try {
      const s = await status(hash);
      if (s.status === 'filled') return { status: 'filled', fillHash: s.fillHash, seconds: Math.round((Date.now() - start) / 1000) };
      if (s.status === 'refunded') return s;
      misses = 0;
      if (s.status === 'unknown') {
        onStatus('Waiting for Across to see the deposit…');
      } else {
        seen = true;
        onStatus(`Across status: ${s.detail}`);
      }
    } catch {
      // Right after the deposit Across has not indexed it yet; that is normal for a little while.
      onStatus(++misses >= 6 ? 'Across is not answering right now, still trying…' : 'Waiting for Across to see the deposit…');
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return seen ? { status: 'timeout' } : { status: 'unknown' };
}

/**
 * ETH only arrives as ETH at a normal wallet (or an EIP-7702 one); a contract would get WETH.
 * Throws BridgeError for a contract, or when Ethereum cannot be reached to check.
 */
export async function checkEthereumRecipient(l1: Pick<ViemPublicClient, 'getCode'>, recipient: Address): Promise<void> {
  let code: Hex | undefined;
  try {
    code = await l1.getCode({ address: recipient });
  } catch {
    throw new BridgeError('Could not reach Ethereum to check that address. Please try again in a minute.');
  }
  if (code && code !== '0x' && !code.startsWith('0xef0100')) {
    throw new BridgeError('That address is a smart contract on Ethereum, so it would receive WETH, not ETH. Use a normal wallet address.');
  }
}
