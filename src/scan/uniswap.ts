import { Address, Hex, encodePacked, zeroAddress } from 'viem';
import { UNISWAP_V3 } from '../constants.js';
import { PublicClient, erc20Abi, uniswapAbi } from '../chain.js';

const { FACTORY, QUOTER, WETH, USDG, FEES, MIN_WETH, MIN_USDG } = UNISWAP_V3;

/** Uniswap v3 path encoding: token, fee, token, fee, token… */
export function encodePath(tokens: Address[], fees: number[]): Hex {
  const types: ('address' | 'uint24')[] = [];
  const values: (Address | number)[] = [];
  tokens.forEach((t, i) => {
    types.push('address');
    values.push(t);
    if (i < fees.length) {
      types.push('uint24');
      values.push(fees[i]);
    }
  });
  return encodePacked(types, values);
}

/** USDG -> WETH legs worth trying for two-hop routes (the deepest pools). */
const USDG_WETH_FEES = [100, 500] as const;

/**
 * For each token, find Uniswap v3 paths to WETH through pools with real liquidity:
 * token -> WETH directly, or token -> USDG -> WETH. Two batched RPC requests in total.
 */
export async function findUniswapPaths(publicClient: PublicClient, tokens: Address[]): Promise<Map<string, Hex[]>> {
  const out = new Map<string, Hex[]>();
  // USDG itself sells straight into the deep USDG/WETH pools.
  const usdg = tokens.find((t) => t.toLowerCase() === USDG.toLowerCase());
  if (usdg) out.set(usdg.toLowerCase(), USDG_WETH_FEES.map((f) => encodePath([usdg, WETH], [f])));
  const candidates = tokens.filter((t) => t.toLowerCase() !== WETH.toLowerCase() && t.toLowerCase() !== USDG.toLowerCase());
  if (candidates.length === 0) return out;

  const lookups = candidates.flatMap((token) =>
    [WETH, USDG].flatMap((quote) => FEES.map((fee) => ({ token, quote, fee })))
  );
  const pools = await publicClient.multicall({
    allowFailure: true,
    contracts: lookups.map(
      (l) => ({ address: FACTORY, abi: uniswapAbi, functionName: 'getPool', args: [l.token, l.quote, l.fee] }) as const
    ),
  });
  const existing = lookups
    .map((l, i) => ({ ...l, pool: pools[i].status === 'success' ? (pools[i].result as Address) : zeroAddress }))
    .filter((l) => l.pool !== zeroAddress);
  if (existing.length === 0) return out;

  // Liquidity check: how much WETH or USDG actually sits in each pool.
  const reserves = await publicClient.multicall({
    allowFailure: true,
    contracts: existing.map((l) => ({ address: l.quote, abi: erc20Abi, functionName: 'balanceOf', args: [l.pool] }) as const),
  });
  existing.forEach((l, i) => {
    const r = reserves[i];
    const reserve = r.status === 'success' ? (r.result as bigint) : 0n;
    const deep = l.quote === WETH ? reserve >= MIN_WETH : reserve >= MIN_USDG;
    if (!deep) return;
    const paths =
      l.quote === WETH
        ? [encodePath([l.token, WETH], [l.fee])]
        : USDG_WETH_FEES.map((f) => encodePath([l.token, USDG, WETH], [l.fee, f]));
    const key = l.token.toLowerCase();
    out.set(key, [...(out.get(key) ?? []), ...paths]);
  });
  return out;
}

/** Ask the official QuoterV2 for each path; returns the one that yields the most WETH. */
export async function bestQuote(
  publicClient: PublicClient,
  paths: Hex[],
  amountIn: bigint
): Promise<{ path: Hex; amountOut: bigint } | undefined> {
  const quotes = await Promise.all(
    paths.map((path) =>
      publicClient
        .simulateContract({ address: QUOTER, abi: uniswapAbi, functionName: 'quoteExactInput', args: [path, amountIn] })
        .then((r) => ({ path, amountOut: r.result[0] }))
        .catch(() => undefined)
    )
  );
  return quotes
    .filter((q): q is { path: Hex; amountOut: bigint } => q !== undefined && q.amountOut > 0n)
    .sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0))[0];
}
