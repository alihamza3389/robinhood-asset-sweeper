import { Address } from 'viem';
import { API, CONTRACTS, UNISWAP_V3 } from '../constants.js';
import { SellRoute } from '../types.js';

/**
 * Router choice, in priority order:
 *   BUCKET token             -> BucketRouter
 *   USDG router registered   -> StockRouterUsdg (e.g. AAPL, TSLA, NVDA)
 *   Treasury registered      -> StockRouterDirect (other stocks and payout tokens)
 *   otherwise                -> not sellable here
 */
export function pickRoute(token: Address, registered: { usdg: boolean; treasury: boolean }): SellRoute {
  if (token.toLowerCase() === CONTRACTS.BUCKET_TOKEN.toLowerCase()) return 'BUCKET';
  if (token.toLowerCase() === UNISWAP_V3.WETH.toLowerCase()) return 'UNWRAP';
  if (registered.usdg) return 'USDG';
  if (registered.treasury) return 'DIRECT';
  return 'NONE';
}

export function routerAddress(route: Exclude<SellRoute, 'NONE' | 'UNWRAP'>): Address {
  switch (route) {
    case 'BUCKET':
      return CONTRACTS.BUCKET_ROUTER;
    case 'USDG':
      return CONTRACTS.STOCK_ROUTER_USDG;
    case 'DIRECT':
      return CONTRACTS.STOCK_ROUTER_DIRECT;
    case 'UNIV3':
      return UNISWAP_V3.ROUTER;
  }
}

/** Parse `https://api.robinhood.com/rhj/assets` -> lowercase contract addresses on the given chain. */
export function parseRobinhoodAssets(data: unknown, chainId: number): Set<string> {
  const out = new Set<string>();
  const assets = (data as { assets?: unknown })?.assets;
  if (!Array.isArray(assets)) return out;
  for (const a of assets) {
    const deployments = (a as { deployments?: unknown })?.deployments;
    if (!Array.isArray(deployments)) continue;
    for (const d of deployments as Array<{ contractAddress?: unknown; chainId?: unknown }>) {
      if (typeof d?.contractAddress === 'string' && (d.chainId === undefined || Number(d.chainId) === chainId)) {
        out.add(d.contractAddress.toLowerCase());
      }
    }
  }
  return out;
}

/** Official Robinhood stock token list. Only used to label tokens; routing comes from on-chain registries. */
export async function fetchRobinhoodStocks(chainId: number): Promise<Set<string>> {
  try {
    const res = await fetch(API.robinhoodAssets, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return new Set();
    return parseRobinhoodAssets(await res.json(), chainId);
  } catch {
    return new Set();
  }
}
