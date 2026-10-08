import { Address, Hex, encodeAbiParameters, encodePacked, getAddress, keccak256, zeroAddress } from 'viem';
import { CONTRACTS, UNISWAP_V4 } from '../constants.js';
import { PublicClient, v4Abi } from '../chain.js';
import { V4PoolKey } from '../types.js';
import { blockscoutRaw } from './blockscout.js';

const POOL_KEY_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
] as const;

export const poolId = (key: V4PoolKey): Hex => keccak256(encodeAbiParameters(POOL_KEY_ABI, [key]));

const topicFor = (a: Address) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;

/** Decode a PoolManager Initialize log (Etherscan-style log object from Blockscout). */
export function parseInitializeLog(log: { topics: string[]; data: string }): { key: V4PoolKey; id: Hex } | undefined {
  const [, id, c0, c1] = log.topics;
  if (!id || !c0 || !c1) return undefined;
  const words = log.data.slice(2).match(/.{64}/g) ?? [];
  if (words.length < 3) return undefined;
  const signed24 = (w: string) => {
    const v = Number(BigInt(`0x${w}`) & 0xffffffn);
    return v >= 0x800000 ? v - 0x1000000 : v;
  };
  const key: V4PoolKey = {
    currency0: getAddress(`0x${c0.slice(-40)}`),
    currency1: getAddress(`0x${c1.slice(-40)}`),
    fee: Number(BigInt(`0x${words[0]}`)),
    tickSpacing: signed24(words[1]),
    hooks: getAddress(`0x${words[2].slice(-40)}`),
  };
  return { key, id: id as Hex };
}

/** ETH per token from a native-ETH/token pool price: (sqrtPriceX96 / 2^96)^2 is token per ETH. */
export function ethPerTokenFromSqrtPrice(sqrtPriceX96: bigint, tokenDecimals: number): number | undefined {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const rawTokenPerRawEth = ratio * ratio;
  if (!(rawTokenPerRawEth > 0) || !Number.isFinite(rawTokenPerRawEth)) return undefined;
  const tokenPerEth = rawTokenPerRawEth * 10 ** (18 - tokenDecimals);
  return 1 / tokenPerEth;
}

export interface V4Found {
  pools: V4PoolKey[];
  /** Mid price from the deepest pool, ETH per whole token. */
  ethPerToken?: number;
}

/**
 * Find Uniswap v4 pools pairing each token with native ETH, using the PoolManager's Initialize
 * events (one Blockscout request per token), then keep pools that currently have liquidity.
 */
export async function findV4Pools(
  publicClient: PublicClient,
  chainId: number,
  apiKey: string,
  tokens: { address: Address; decimals: number }[]
): Promise<Map<string, V4Found>> {
  const out = new Map<string, V4Found>();
  const found: { token: { address: Address; decimals: number }; key: V4PoolKey; id: Hex }[] = [];

  // A few lookups at a time: much faster for wallets full of airdrops, gentle on the API.
  const lookup = async (token: { address: Address; decimals: number }) => {
    const query = new URLSearchParams({
      module: 'logs',
      action: 'getLogs',
      address: UNISWAP_V4.POOL_MANAGER,
      topic0: UNISWAP_V4.INITIALIZE_TOPIC,
      topic2: topicFor(zeroAddress),
      topic3: topicFor(token.address),
      topic0_2_opr: 'and',
      topic0_3_opr: 'and',
      topic2_3_opr: 'and',
      fromBlock: '0',
      toBlock: 'latest',
    });
    const res = (await blockscoutRaw(chainId, apiKey, `/api?${query}`).catch(() => undefined)) as
      | { result?: { topics: string[]; data: string }[] }
      | undefined;
    for (const log of Array.isArray(res?.result) ? res.result : []) {
      const parsed = parseInitializeLog(log);
      if (parsed && parsed.key.currency1.toLowerCase() === token.address.toLowerCase()) found.push({ token, ...parsed });
    }
  };
  const queue = [...tokens];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) await lookup(t);
    })
  );
  if (found.length === 0) return out;

  const state = await publicClient.multicall({
    allowFailure: true,
    contracts: found.flatMap((f) => [
      { address: CONTRACTS.STATE_VIEW, abi: v4Abi, functionName: 'getLiquidity', args: [f.id] } as const,
      { address: CONTRACTS.STATE_VIEW, abi: v4Abi, functionName: 'getSlot0', args: [f.id] } as const,
    ]),
  });

  const best = new Map<string, bigint>();
  found.forEach((f, i) => {
    const liq = state[i * 2];
    const slot0 = state[i * 2 + 1];
    const liquidity = liq.status === 'success' ? (liq.result as bigint) : 0n;
    if (liquidity <= 0n || slot0.status !== 'success') return;
    const sqrtPriceX96 = (slot0.result as readonly [bigint, number, number, number])[0];
    const k = f.token.address.toLowerCase();
    const entry = out.get(k) ?? { pools: [] };
    entry.pools.push(f.key);
    if (liquidity > (best.get(k) ?? 0n)) {
      best.set(k, liquidity);
      entry.ethPerToken = ethPerTokenFromSqrtPrice(sqrtPriceX96, f.token.decimals);
    }
    out.set(k, entry);
  });
  return out;
}

/** Ask the V4Quoter for each pool; returns the one that pays the most ETH for selling `amountIn`. */
export async function bestV4Quote(
  publicClient: PublicClient,
  pools: V4PoolKey[],
  amountIn: bigint
): Promise<{ key: V4PoolKey; amountOut: bigint } | undefined> {
  const quotes = await Promise.all(
    pools.map((key) =>
      publicClient
        .simulateContract({
          address: UNISWAP_V4.QUOTER,
          abi: v4Abi,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey: key, zeroForOne: false, exactAmount: amountIn, hookData: '0x' }],
        })
        .then((r) => ({ key, amountOut: r.result[0] }))
        .catch(() => undefined)
    )
  );
  return quotes
    .filter((q): q is { key: V4PoolKey; amountOut: bigint } => q !== undefined && q.amountOut > 0n)
    .sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0))[0];
}

// Universal Router: command V4_SWAP, actions SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
// (values from the router's verified source).
const V4_SWAP = 0x10;
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

/** Build Universal Router `execute` arguments to sell `amountIn` of currency1 for at least `minOut` ETH. */
export function buildV4Sell(key: V4PoolKey, amountIn: bigint, minOut: bigint): { commands: Hex; inputs: Hex[] } {
  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);
  const swap = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: POOL_KEY_ABI[0].components },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'minHopPriceX36', type: 'uint256' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne: false, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: '0x' }]
  );
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key.currency1, amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key.currency0, minOut]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swap, settle, take]]);
  return { commands: encodePacked(['uint8'], [V4_SWAP]), inputs: [input] };
}
