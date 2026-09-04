import { PublicClient, parseAbi } from 'viem';
import { AssetInfo } from './types.js';

export interface PriceFeedResponse {
  prices: Record<string, { symbol: string; price_usd: number }>;
  as_of?: number;
}

const BUCKET_TOKEN_ADDRESS = '0xbc9e7b1c5c0081f4ae85e71ec95703d3dec9ffad';
const BUCKET_POOL_ID = '0x8857c1a180b5483c98d38f4d62db5866de2f91b737513347283f55e446424ce3';
const STATE_VIEW_CONTRACT = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b';

export async function fetchLivePrices(publicClient?: PublicClient): Promise<{
  tokenPrices: Record<string, number>;
  ethPriceUsd: number;
}> {
  const tokenPrices: Record<string, number> = {};
  let ethPriceUsd = 2450; // fallback

  // 1. Fetch from Bucket indexer API
  try {
    const res = await fetch('https://indexer-api.bucket.markets/prices', {
      headers: { Accept: 'application/json', 'User-Agent': 'Robinhood-EVM-Sweeper/1.0' },
      signal: AbortSignal.timeout(3500),
    });

    if (res.ok) {
      const data = (await res.json()) as PriceFeedResponse;
      if (data && data.prices) {
        for (const [rawAddr, item] of Object.entries(data.prices)) {
          if (item && typeof item.price_usd === 'number') {
            tokenPrices[rawAddr.toLowerCase()] = item.price_usd;
            if (item.symbol.toUpperCase() === 'WETH') {
              ethPriceUsd = item.price_usd;
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // 2. Fetch ETH price from Blockscout stats if needed
  try {
    const bsRes = await fetch('https://robinhoodchain.blockscout.com/api/v2/stats', {
      signal: AbortSignal.timeout(3000),
    });
    if (bsRes.ok) {
      const bsData = await bsRes.json();
      if (bsData && bsData.coin_price) {
        const p = parseFloat(bsData.coin_price);
        if (!isNaN(p) && p > 0) {
          ethPriceUsd = p;
        }
      }
    }
  } catch {
    // Ignore
  }

  // 3. Calculate $BUCKET token price directly from on-chain Uniswap v4 StateView pool
  if (publicClient) {
    try {
      const abi = parseAbi([
        'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
      ]);
      const [sqrtPriceX96] = await publicClient.readContract({
        address: STATE_VIEW_CONTRACT,
        abi,
        functionName: 'getSlot0',
        args: [BUCKET_POOL_ID],
      });

      const ratio = Number(sqrtPriceX96) / 2 ** 96;
      const bucketPerEth = ratio * ratio;
      if (bucketPerEth > 0) {
        const ethPerBucket = 1 / bucketPerEth;
        tokenPrices[BUCKET_TOKEN_ADDRESS] = ethPerBucket * ethPriceUsd;
      }
    } catch {
      // Ignore
    }
  }

  return { tokenPrices, ethPriceUsd };
}

export function enrichAssetsWithPrices(
  assets: AssetInfo[],
  tokenPrices: Record<string, number>,
  ethPriceUsd: number
): AssetInfo[] {
  return assets.map((asset) => {
    let priceUsd: number | undefined;

    if (asset.type === 'NATIVE') {
      priceUsd = ethPriceUsd;
    } else {
      const addrLower = asset.address.toLowerCase();
      if (tokenPrices[addrLower] !== undefined) {
        priceUsd = tokenPrices[addrLower];
      }
    }

    let valueUsd: number | undefined;
    if (priceUsd !== undefined) {
      const qty = Number(asset.balanceRaw) / Math.pow(10, asset.decimals);
      valueUsd = qty * priceUsd;
    }

    return {
      ...asset,
      priceUsd,
      valueUsd,
    };
  });
}

export function formatBalance(rawStr: string): string {
  const num = parseFloat(rawStr);
  if (isNaN(num)) return rawStr;
  if (num === 0) return '0';
  if (num >= 1000) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (num >= 1) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function formatUsd(amount?: number): string {
  if (amount === undefined || isNaN(amount)) return '$--';
  if (amount < 0.01 && amount > 0) return '<$0.01';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
