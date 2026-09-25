import { Address, getAddress } from 'viem';
import { Config, NativeAsset, TokenAsset } from '../types.js';
import { CONTRACTS } from '../constants.js';
import { PublicClient, erc20Abi, registryAbi } from '../chain.js';
import { fetchIndexedTokens } from './blockscout.js';
import { pickRoute } from './registry.js';
import { findUniswapPaths } from './uniswap.js';

/**
 * Token names come from arbitrary contracts. Strip control and bidi-override characters so a
 * malicious name cannot inject terminal escape codes or visually spoof the screen.
 */
export function cleanText(raw: string, max: number): string {
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Read metadata, balance and sell route for many tokens in one multicall round-trip.
 * On-chain balances are authoritative; indexer balances are never trusted.
 */
export async function readTokens(
  publicClient: PublicClient,
  owner: Address,
  addresses: Address[],
  robinhoodStocks: Set<string> = new Set()
): Promise<TokenAsset[]> {
  if (addresses.length === 0) return [];

  const calls = addresses.flatMap((address) => [
    { address, abi: erc20Abi, functionName: 'symbol' } as const,
    { address, abi: erc20Abi, functionName: 'name' } as const,
    { address, abi: erc20Abi, functionName: 'decimals' } as const,
    { address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] } as const,
    { address: CONTRACTS.STOCK_ROUTER_USDG, abi: registryAbi, functionName: 'isRegistered', args: [address] } as const,
    { address: CONTRACTS.TREASURY, abi: registryAbi, functionName: 'isRegistered', args: [address] } as const,
  ]);

  const res = await publicClient.multicall({ contracts: calls, allowFailure: true });

  const tokens: TokenAsset[] = [];
  addresses.forEach((address, i) => {
    const [symbol, name, decimals, balance, usdg, treasury] = res.slice(i * 6, i * 6 + 6);
    // A contract without a working balanceOf is not a usable ERC-20.
    if (balance.status !== 'success') return;

    tokens.push({
      kind: 'erc20',
      address,
      symbol: symbol.status === 'success' ? cleanText(String(symbol.result), 16) || '???' : '???',
      name: name.status === 'success' ? cleanText(String(name.result), 40) || 'Unknown token' : 'Unknown token',
      decimals: decimals.status === 'success' ? Number(decimals.result) : 18,
      balance: balance.result as bigint,
      route: pickRoute(address, {
        usdg: usdg.status === 'success' && usdg.result === true,
        treasury: treasury.status === 'success' && treasury.result === true,
      }),
      flags: { robinhoodStock: robinhoodStocks.has(address.toLowerCase()) },
    });
  });
  return tokens;
}

export async function readNative(publicClient: PublicClient, owner: Address, config: Config): Promise<NativeAsset> {
  return {
    kind: 'native',
    symbol: config.nativeSymbol,
    name: 'Native gas token',
    decimals: config.nativeDecimals,
    balance: await publicClient.getBalance({ address: owner }),
  };
}

async function nonZeroBalances(publicClient: PublicClient, owner: Address, tokens: Address[]): Promise<Address[]> {
  if (tokens.length === 0) return [];
  const res = await publicClient.multicall({
    contracts: tokens.map((address) => ({ address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) as const),
    allowFailure: true,
  });
  return tokens.filter((_, i) => res[i].status === 'success' && (res[i].result as bigint) > 0n);
}

/** Tokens the Bucket routers can't sell may still trade on Uniswap v3: give those a UNIV3 route. */
export async function addUniswapRoutes(publicClient: PublicClient, tokens: TokenAsset[]): Promise<TokenAsset[]> {
  const unrouted = tokens.filter((t) => t.route === 'NONE').map((t) => t.address);
  if (unrouted.length === 0) return tokens;
  const uniPaths = await findUniswapPaths(publicClient, unrouted).catch(() => new Map<string, `0x${string}`[]>());
  return tokens.map((t) => {
    const paths = uniPaths.get(t.address.toLowerCase());
    return t.route === 'NONE' && paths?.length ? { ...t, route: 'UNIV3' as const, uniPaths: paths } : t;
  });
}

export interface ScanResult {
  native: NativeAsset;
  tokens: TokenAsset[];
  /** USD prices Blockscout reported for tokens (lowercase address -> USD). */
  indexerPrices: Map<string, number>;
  /** Problems worth telling the user about (the scan still completed). */
  warnings: string[];
}

/**
 * Tokens come from Blockscout (plus any saved custom tokens); balances, metadata and sell
 * routes are then read on-chain in a single multicall.
 */
export async function scanWallet(opts: {
  publicClient: PublicClient;
  owner: Address;
  config: Config;
  apiKey: string;
  /** Always checked on-chain too (saved tokens, official stock list, priced tokens), so an indexer gap can't hide them. */
  knownTokens: Address[];
}): Promise<ScanResult> {
  const { publicClient, owner, config } = opts;

  const [native, { tokens: indexed, error }] = await Promise.all([
    readNative(publicClient, owner, config),
    fetchIndexedTokens(config.chainId, opts.apiKey, owner),
  ]);
  const warnings = error
    ? [`Blockscout had a problem (${error}), so some tokens may be missing. Well-known tokens were still checked. Try again in a minute for a full list.`]
    : [];

  const spam = new Set(indexed.filter((t) => t.spam).map((t) => t.address.toLowerCase()));
  const indexerPrices = new Map<string, number>();
  for (const t of indexed) if (t.exchangeRate) indexerPrices.set(t.address.toLowerCase(), t.exchangeRate);

  const candidates = new Map<string, Address>();
  for (const a of indexed.map((t) => t.address)) candidates.set(a.toLowerCase(), getAddress(a));
  // Known tokens: one balanceOf multicall, then full reads only for the ones actually held.
  const extra = opts.knownTokens.filter((a) => !candidates.has(a.toLowerCase()));
  for (const a of await nonZeroBalances(publicClient, owner, extra)) candidates.set(a.toLowerCase(), a);

  let tokens: TokenAsset[] = (await readTokens(publicClient, owner, [...candidates.values()]))
    .filter((t) => t.balance > 0n)
    .map((t) => ({ ...t, flags: { ...t.flags, spam: spam.has(t.address.toLowerCase()) } }));

  tokens = await addUniswapRoutes(publicClient, tokens);

  return { native, tokens, indexerPrices, warnings };
}
