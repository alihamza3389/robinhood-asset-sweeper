import {
  Address,
  Hex,
  TransactionSerialized,
  decodeFunctionData,
  formatEther,
  isAddressEqual,
  pad,
  parseAbi,
  parseEther,
  parseTransaction,
  recoverTransactionAddress,
} from 'viem';
import { ACROSS, DEFAULTS, UNISWAP_V3 } from '../constants.js';

/**
 * Robinhood Chain ETH -> Ethereum ETH through the Across Swap API (ported from across-bridge, which
 * has done real bridges). ETH -> ETH only: the cheapest route at every size measured, its guaranteed
 * output equals the expected one, and the deposit is one depositNative call that is checked field by
 * field before it goes near the key.
 */

/** A reason the bridge refused. Always thrown before anything is signed. */
export class BridgeError extends Error {}

const fail = (msg: string): never => {
  throw new BridgeError(msg);
};

const NATIVE: Address = '0x0000000000000000000000000000000000000000';
const ORIGIN_CHAIN_ID = DEFAULTS.chainId;
/** Comparison quotes are informational; never let them hold up the real one. */
const COMPETITOR_TIMEOUT_MS = 8_000;
/** Two independent ETH/USD sources must agree this closely before a dollar amount is converted. */
const MAX_PRICE_DISAGREEMENT = 0.01;

export interface AcrossQuote {
  crossSwapType: string;
  approvalTxns?: unknown[] | null;
  expectedOutputAmount: string;
  minOutputAmount: string;
  expectedFillTime: number;
  quoteExpiryTimestamp: number;
  fees: { total: { amountUsd: number | string }; originGas: { amountUsd: number | string } };
  // The API has returned gas both as a number and as a string.
  swapTx: { chainId: number; to: Address; data: Hex; value: string; gas: number | string; simulationSuccess: boolean };
}

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 200)}`);
  return JSON.parse(body) as T;
}

export function fetchAcrossQuote(amount: bigint, from: Address, recipient: Address): Promise<AcrossQuote> {
  const q = new URLSearchParams({
    tradeType: 'exactInput',
    amount: amount.toString(),
    inputToken: NATIVE,
    originChainId: String(ORIGIN_CHAIN_ID),
    outputToken: NATIVE,
    destinationChainId: String(ACROSS.DEST_CHAIN_ID),
    depositor: from,
    recipient,
    // Explicit, so an unfilled deposit always comes back to this wallet on Robinhood Chain (as WETH).
    refundOnOrigin: 'true',
    refundAddress: from,
  });
  return getJson<AcrossQuote>(`${ACROSS.API}/swap/approval?${q}`);
}

export interface Limits {
  min: bigint;
  max: bigint;
  maxInstant: bigint;
}

/** Across's current limits for this route, or undefined if the API does not answer. */
export async function fetchLimits(): Promise<Limits | undefined> {
  const q = new URLSearchParams({
    token: UNISWAP_V3.WETH,
    originChainId: String(ORIGIN_CHAIN_ID),
    destinationChainId: String(ACROSS.DEST_CHAIN_ID),
  });
  try {
    const l = await getJson<{ minDeposit: string; maxDeposit: string; maxDepositInstant: string }>(
      `${ACROSS.API}/limits?${q}`,
      undefined,
      COMPETITOR_TIMEOUT_MS
    );
    return { min: BigInt(l.minDeposit), max: BigInt(l.maxDeposit), maxInstant: BigInt(l.maxDepositInstant) };
  } catch {
    return undefined;
  }
}

export interface Competitor {
  name: string;
  /** Expected ETH arriving on Ethereum for the same ETH in. */
  out: bigint;
}

/** Other bridges' quotes for the same transfer, for comparison only. A failure just drops that row. */
export async function fetchCompetitors(amount: bigint, from: Address): Promise<Competitor[]> {
  const relay = getJson<{ details: { currencyOut: { amount: string } } }>(
    'https://api.relay.link/quote',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: from,
        recipient: from,
        originChainId: ORIGIN_CHAIN_ID,
        destinationChainId: ACROSS.DEST_CHAIN_ID,
        originCurrency: NATIVE,
        destinationCurrency: NATIVE,
        amount: amount.toString(),
        tradeType: 'EXACT_INPUT',
      }),
    },
    COMPETITOR_TIMEOUT_MS
  ).then((d): Competitor => ({ name: 'Relay', out: BigInt(d.details.currencyOut.amount) }));

  // deBridge charges a flat fee on top of the amount; subtract it so every row is "ETH out for this ETH in".
  const debridgeQ = new URLSearchParams({
    srcChainId: String(ORIGIN_CHAIN_ID),
    srcChainTokenIn: NATIVE,
    srcChainTokenInAmount: amount.toString(),
    dstChainId: String(ACROSS.DEST_CHAIN_ID),
    dstChainTokenOut: NATIVE,
    dstChainTokenOutAmount: 'auto',
    dstChainTokenOutRecipient: from,
    srcChainOrderAuthorityAddress: from,
    dstChainOrderAuthorityAddress: from,
    prependOperatingExpenses: 'false',
  });
  const debridge = getJson<{ fixFee?: string; estimation: { dstChainTokenOut: { recommendedAmount: string } } }>(
    `https://dln.debridge.finance/v1.0/dln/order/create-tx?${debridgeQ}`,
    undefined,
    COMPETITOR_TIMEOUT_MS
  ).then((d): Competitor => ({
    name: 'deBridge',
    out: BigInt(d.estimation.dstChainTokenOut.recommendedAmount) - BigInt(d.fixFee ?? '0'),
  }));

  // ChangeNOW is custodial (you send to their address and trust the payout): price comparison only.
  // Their network code for Robinhood Chain ETH is "ethhood".
  const changenow = getJson<{ estimatedAmount: number }>(
    `https://api.changenow.io/v1/exchange-amount/${formatEther(amount)}/ethhood_eth`,
    undefined,
    COMPETITOR_TIMEOUT_MS
  ).then((d): Competitor => ({ name: 'ChangeNOW (custodial)', out: parseEther(d.estimatedAmount.toFixed(18)) }));

  const settled = await Promise.allSettled([relay, debridge, changenow]);
  return settled.flatMap((s) => (s.status === 'fulfilled' && s.value.out > 0n ? [s.value] : []));
}

export const PERIPHERY_ABI = parseAbi([
  'function depositNative(address spokePool, address depositor, bytes32 recipient, address inputToken, uint256 inputAmount, bytes32 outputToken, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)',
]);

/**
 * Everything that must hold before the transaction may be signed. The calldata itself is decoded,
 * so the JSON around it is never trusted for where the money goes.
 */
export function verifyQuote(
  q: AcrossQuote,
  amount: bigint,
  from: Address,
  recipient: Address,
  now = Date.now()
): { guaranteed: bigint; gasLimit: bigint } {
  const tx = q.swapTx;
  if (tx.chainId !== ORIGIN_CHAIN_ID) fail(`The quote is for chain ${tx.chainId}, not Robinhood Chain.`);
  if (!isAddressEqual(tx.to, ACROSS.PERIPHERY)) fail(`Across wants the ETH sent to ${tx.to}, not its known contract. Refusing.`);
  if (BigInt(tx.value) !== amount) fail('The quote is for a different amount than you chose.');
  if (q.approvalTxns && q.approvalTxns.length) fail('The quote asks for token approvals, which bridging ETH never needs.');
  if (q.crossSwapType !== 'bridgeableToBridgeable') fail(`Unexpected Across route type (${q.crossSwapType}).`);
  // A missing or renamed field must refuse, not silently skip the expiry check (NaN < x is false).
  if (!Number.isFinite(q.quoteExpiryTimestamp)) fail('The quote has no valid expiry time.');
  if (q.quoteExpiryTimestamp * 1000 < now + 60_000) fail('The quote expires within a minute. Please try again.');
  if (!tx.simulationSuccess) fail("Across's own test of this deposit failed.");
  const gasLimit = (BigInt(tx.gas) * 13n) / 10n;
  if (gasLimit > ACROSS.MAX_GAS) fail(`The deposit wants more gas (${tx.gas}) than this tool allows for.`);

  let call;
  try {
    call = decodeFunctionData({ abi: PERIPHERY_ABI, data: tx.data });
  } catch {
    return fail('The transaction is not a plain Across ETH deposit. Refusing.');
  }
  const [spokePool, depositor, toBytes, inputToken, inputAmount, outputToken, outputAmount, destId, , , fillDeadline, , message] =
    call.args;
  if (!isAddressEqual(spokePool, ACROSS.SPOKE_POOL)) fail('The deposit targets an unknown Across contract. Refusing.');
  if (!isAddressEqual(depositor, from)) fail('The deposit is not from this wallet. Refusing.');
  if (toBytes.toLowerCase() !== pad(recipient).toLowerCase()) fail('The deposit pays a different address than the one you chose. Refusing.');
  if (!isAddressEqual(inputToken, UNISWAP_V3.WETH) || inputAmount !== amount) fail('The deposit has the wrong token or amount.');
  if (outputToken.toLowerCase() !== pad(ACROSS.MAINNET_WETH).toLowerCase()) fail('The deposit would not deliver ETH on Ethereum.');
  if (destId !== BigInt(ACROSS.DEST_CHAIN_ID)) fail(`The deposit goes to chain ${destId}, not Ethereum.`);
  if (message !== '0x') fail('The deposit carries extra instructions; a plain ETH bridge never does.');
  // The relayer must deliver at least outputAmount, so this is the real guarantee.
  if (outputAmount !== BigInt(q.minOutputAmount)) fail('The deposit guarantees a different amount than the quote shows.');
  if (outputAmount >= amount) fail('The quote looks wrong (it pays out more than goes in).');
  if (Number(fillDeadline) * 1000 < now + 10 * 60_000) fail('The deposit deadline is too close.');
  return { guaranteed: outputAmount, gasLimit };
}

export interface EthPrice {
  usd: number;
  /** How many independent sources answered (1 or 2). */
  sources: number;
}

/**
 * ETH/USD from Binance (mid) and CoinGecko. Undefined if neither answers or they disagree by more
 * than 1%, so a dollar amount is never converted at a wrong price.
 */
export async function fetchEthUsd(timeoutMs = 8_000): Promise<EthPrice | undefined> {
  const [binance, gecko] = await Promise.allSettled([
    getJson<{ bidPrice: string; askPrice: string }>('https://api.binance.com/api/v3/ticker/bookTicker?symbol=ETHUSDT', undefined, timeoutMs).then(
      (d) => (Number(d.bidPrice) + Number(d.askPrice)) / 2
    ),
    getJson<{ ethereum: { usd: number } }>('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', undefined, timeoutMs).then(
      (d) => d.ethereum.usd
    ),
  ]);
  const prices = [binance, gecko].flatMap((r) => (r.status === 'fulfilled' && r.value > 0 && Number.isFinite(r.value) ? [r.value] : []));
  return agreedPrice(prices);
}

/** Exported for tests. */
export function agreedPrice(prices: number[]): EthPrice | undefined {
  if (prices.length === 0) return undefined;
  if (prices.length === 2 && Math.abs(prices[0] - prices[1]) / prices[1] > MAX_PRICE_DISAGREEMENT) return undefined;
  return { usd: prices[0], sources: prices.length };
}

/** Dollars -> wei, rounded down, with the price in 1e-8 USD units to stay in integer math. */
export const usdToWei = (usd: string, price: number) => (parseEther(usd) * 100_000_000n) / BigInt(Math.round(price * 1e8));

/** The transaction as checked: the signed bytes must match this exactly. */
export interface PlannedTx {
  to: Address;
  data: Hex;
  value: bigint;
  gasLimit: bigint;
  maxFee: bigint;
}

/** What differs between signed bytes and the checked plan, or undefined if nothing does. */
export async function signedMismatch(signed: TransactionSerialized, p: PlannedTx, from: Address): Promise<string | undefined> {
  const tx = parseTransaction(signed);
  const signer = await recoverTransactionAddress({ serializedTransaction: signed });
  return (
    !isAddressEqual(signer, from) ? `signer ${signer}` :
    tx.chainId !== ORIGIN_CHAIN_ID ? `chain ${tx.chainId}` :
    !tx.to || !isAddressEqual(tx.to, p.to) ? `to ${tx.to}` :
    tx.value !== p.value ? `value ${tx.value}` :
    tx.data?.toLowerCase() !== p.data.toLowerCase() ? 'calldata' :
    tx.gas !== p.gasLimit ? `gas ${tx.gas}` :
    (tx.maxFeePerGas ?? tx.gasPrice) !== p.maxFee ? 'fee' :
    tx.type !== 'eip1559' ? `type ${tx.type}` :
    // viem decodes a zero priority fee as undefined.
    (tx.maxPriorityFeePerGas ?? 0n) !== 0n ? `priority fee ${tx.maxPriorityFeePerGas}` :
    (tx.accessList?.length ?? 0) !== 0 ? 'access list' :
    // An EIP-7702 authorization would let the transaction change what code the wallet runs.
    'authorizationList' in tx && (tx as { authorizationList?: unknown[] }).authorizationList?.length ? 'authorization list' :
    undefined
  );
}

export type DepositStatus =
  | { status: 'filled'; fillHash: Hex }
  | { status: 'refunded'; refundHash?: Hex }
  | { status: 'pending'; detail: string }
  /** Across has no deposit with this hash (yet: a brand-new one takes a few seconds to appear). */
  | { status: 'unknown' };

/** Where a deposit is, according to Across (indexed about every 10 s). */
export async function fetchDepositStatus(depositHash: Hex): Promise<DepositStatus> {
  const res = await fetch(`${ACROSS.API}/deposit/status?depositTxnRef=${depositHash}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return { status: 'unknown' };
  if (!res.ok) throw new Error(`Across answered ${res.status}`);
  const s = (await res.json()) as { status: string; fillTxnRef?: Hex; depositRefundTxnRef?: Hex };
  if (s.status === 'filled' && s.fillTxnRef) return { status: 'filled', fillHash: s.fillTxnRef };
  if (s.status === 'expired' || s.status === 'refunded') return { status: 'refunded', refundHash: s.depositRefundTxnRef };
  return { status: 'pending', detail: s.status };
}
