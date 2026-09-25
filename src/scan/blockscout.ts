import { Address, getAddress, isAddress } from 'viem';
import { API } from '../constants.js';

export interface IndexedToken {
  address: Address;
  spam: boolean;
  /** USD price reported by Blockscout, if any. */
  exchangeRate?: number;
}

const MAX_PAGES = 20;
const NFT_TYPES = new Set(['ERC-721', 'ERC-1155', 'ERC-404']);

export class BlockscoutKeyError extends Error {}

/**
 * Parse one page of Blockscout v2 `/addresses/{addr}/tokens` (fungible tokens only).
 * Balances are ignored on purpose: they are re-read on-chain, which is authoritative.
 */
export function parseTokenItems(data: unknown): IndexedToken[] {
  const items: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown[] })?.items)
      ? (data as { items: unknown[] }).items
      : [];

  const out: IndexedToken[] = [];
  for (const item of items) {
    const token = (item as { token?: Record<string, unknown> })?.token;
    if (!token) continue;
    // Skip NFTs only. Fungible tokens come in several types: Robinhood stock tokens, for example,
    // are "ERC-8056" (ERC-20 plus a split/dividend multiplier). Each token is verified on-chain later.
    if (typeof token.type === 'string' && NFT_TYPES.has(token.type)) continue;
    const raw = (token.address_hash ?? token.address) as unknown;
    if (typeof raw !== 'string' || !isAddress(raw)) continue;

    const rate = Number.parseFloat(String(token.exchange_rate ?? ''));
    out.push({
      address: getAddress(raw),
      spam: token.reputation === 'scam' || token.reputation === 'spam' || token.is_scam === true,
      exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
    });
  }
  return out;
}

/** GET a Blockscout Pro API path. Throws BlockscoutKeyError for a missing or rejected key. */
export async function blockscoutGet(chainId: number, apiKey: string, pathAndQuery: string): Promise<unknown> {
  const url = new URL(`${API.blockscoutPro(chainId)}${pathAndQuery}`);
  url.searchParams.set('apikey', apiKey);
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    throw new BlockscoutKeyError('Blockscout rejected the API key. Run `npm run setup` to enter a valid one.');
  }
  if (res.status === 429) throw new Error('Blockscout rate limit reached; wait a minute and try again');
  if (!res.ok) throw new Error(`Blockscout returned HTTP ${res.status}`);
  return res.json();
}

/** Checks a key against the Blockscout Pro API, telling a rejected key apart from Blockscout being unreachable. */
export async function checkBlockscoutKey(chainId: number, apiKey: string): Promise<'ok' | 'rejected' | 'unreachable'> {
  try {
    await blockscoutGet(chainId, apiKey, '/stats');
    return 'ok';
  } catch (err) {
    return err instanceof BlockscoutKeyError ? 'rejected' : 'unreachable';
  }
}

/**
 * Every fungible token Blockscout knows this wallet holds (all pages). A rejected key throws;
 * any other failure returns what was fetched so far plus an error, so the scan can continue.
 */
export async function fetchIndexedTokens(
  chainId: number,
  apiKey: string,
  owner: Address
): Promise<{ tokens: IndexedToken[]; error?: string }> {
  const tokens: IndexedToken[] = [];
  let pageParams: Record<string, unknown> | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(pageParams ?? {})) {
      if (v !== null && v !== undefined) query.set(k, String(v));
    }
    let data: { next_page_params?: Record<string, unknown> | null };
    try {
      data = (await blockscoutGet(chainId, apiKey, `/addresses/${owner}/tokens?${query}`)) as typeof data;
    } catch (err) {
      if (err instanceof BlockscoutKeyError) throw err;
      return { tokens, error: (err as Error).message };
    }
    tokens.push(...parseTokenItems(data));
    pageParams = data.next_page_params ?? null;
    if (!pageParams) break;
  }
  return { tokens };
}
