import { API, BUCKET_POOL_ID, CONTRACTS } from '../constants.js';
import { PublicClient, stateViewAbi } from '../chain.js';
import { blockscoutGet } from './blockscout.js';

export interface PriceBook {
  /** lowercase token address -> USD */
  tokens: Map<string, number>;
  ethUsd?: number;
}

/** BUCKET/ETH v4 pool: price = (sqrtPriceX96 / 2^96)^2 is BUCKET per ETH (both 18 decimals). */
export function ethPerBucketFromSqrtPrice(sqrtPriceX96: bigint): number | undefined {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const bucketPerEth = ratio * ratio;
  return bucketPerEth > 0 && Number.isFinite(bucketPerEth) ? 1 / bucketPerEth : undefined;
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Best-effort pricing. Every source is optional; missing prices display as "$--". */
export async function fetchPrices(
  publicClient: PublicClient,
  opts: { chainId: number; apiKey: string }
): Promise<PriceBook> {
  const tokens = new Map<string, number>();
  let ethUsd: number | undefined;

  const [bucketFeed, stats, slot0] = await Promise.allSettled([
    getJson(API.bucketPrices, 5_000),
    blockscoutGet(opts.chainId, opts.apiKey, '/stats'),
    publicClient.readContract({
      address: CONTRACTS.STATE_VIEW,
      abi: stateViewAbi,
      functionName: 'getSlot0',
      args: [BUCKET_POOL_ID],
    }),
  ]);

  if (bucketFeed.status === 'fulfilled') {
    const prices = (bucketFeed.value as { prices?: Record<string, { symbol?: string; price_usd?: unknown }> })?.prices;
    for (const [addr, item] of Object.entries(prices ?? {})) {
      if (typeof item?.price_usd !== 'number' || !(item.price_usd > 0)) continue;
      tokens.set(addr.toLowerCase(), item.price_usd);
      if (item.symbol?.toUpperCase() === 'WETH') ethUsd = item.price_usd;
    }
  }

  if (stats.status === 'fulfilled') {
    const p = Number.parseFloat(String((stats.value as { coin_price?: unknown })?.coin_price ?? ''));
    if (Number.isFinite(p) && p > 0) ethUsd = p;
  }

  if (slot0.status === 'fulfilled' && ethUsd) {
    const ethPerBucket = ethPerBucketFromSqrtPrice(slot0.value[0]);
    if (ethPerBucket) tokens.set(CONTRACTS.BUCKET_TOKEN.toLowerCase(), ethPerBucket * ethUsd);
  }

  return { tokens, ethUsd };
}
