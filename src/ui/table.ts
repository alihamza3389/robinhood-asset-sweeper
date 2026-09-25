import { Asset } from '../types.js';
import { formatAmount, formatUsd, usdValue } from './format.js';
import { c, padEnd, padStart, sym, width } from './theme.js';

/** Plain-English note shown next to each asset. */
export function assetNote(asset: Asset): string {
  if (asset.kind === 'native') return c.warn('pays network fees');
  if (asset.flags.spam) return c.danger(`${sym.warn} likely spam`);
  const parts: string[] = [];
  if (asset.flags.robinhoodStock) parts.push('stock');
  if (asset.route === 'NONE') parts.push('not sellable here');
  else if (asset.route === 'UNIV3') parts.push('sellable (Uniswap)');
  else parts.push('sellable');
  return c.dim(parts.join(', '));
}

const clip = (s: string, n: number) => (width(s) > n ? s.slice(0, n - 1) + '…' : s);

/** Aligned rows (token, amount, value, note) plus a matching header. */
export function tokenTable(assets: Asset[]): { header: string; rows: string[] } {
  const cells = assets.map((a) => ({
    name: clip(a.symbol, 12),
    amount: formatAmount(a.balance, a.decimals),
    usd: formatUsd(usdValue(a)),
    note: assetNote(a),
  }));
  const w = {
    name: Math.max(5, ...cells.map((r) => width(r.name))),
    amount: Math.max(6, ...cells.map((r) => width(r.amount))),
    usd: Math.max(5, ...cells.map((r) => width(r.usd))),
  };
  return {
    header: c.dim(`${padEnd('TOKEN', w.name)}  ${padStart('AMOUNT', w.amount)}  ${padStart('VALUE', w.usd)}  NOTE`),
    rows: cells.map(
      (r) => `${padEnd(c.bold(r.name), w.name)}  ${padStart(r.amount, w.amount)}  ${c.money(padStart(r.usd, w.usd))}  ${r.note}`
    ),
  };
}
