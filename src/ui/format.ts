import { formatUnits } from 'viem';
import { Asset } from '../types.js';

/** Human-readable token amount with thousands separators and a sensible number of decimals. */
export function formatAmount(raw: bigint, decimals: number, maxFraction = 6): string {
  const s = formatUnits(raw, decimals);
  const [int, frac = ''] = s.split('.');
  const intFmt = BigInt(int).toLocaleString('en-US');
  if (!frac) return intFmt;

  // Big numbers need fewer decimals; tiny ones keep enough to show the first significant digits.
  let keep = int.replace('-', '').length >= 4 ? 2 : maxFraction;
  if (int === '0' || int === '-0') {
    const firstNonZero = frac.search(/[1-9]/);
    // Show 3 significant digits for values below 1 (0.00000499, not 0.000004).
    if (firstNonZero >= 0) keep = Math.min(Math.max(keep, firstNonZero + 3), decimals);
  }
  const trimmed = frac.slice(0, keep).replace(/0+$/, '');
  return trimmed ? `${intFmt}.${trimmed}` : intFmt;
}

export function formatUsd(amount?: number): string {
  if (amount === undefined || !Number.isFinite(amount)) return '$--';
  if (amount > 0 && amount < 0.01) return '<$0.01';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function usdValue(asset: Asset, amount: bigint = asset.balance): number | undefined {
  if (asset.priceUsd === undefined) return undefined;
  return Number(formatUnits(amount, asset.decimals)) * asset.priceUsd;
}

/** ETH with 5 decimals, rounded down (or up, for minimums) so "at least X" never overstates. */
export function formatEthShort(wei: bigint, round: 'down' | 'up' = 'down'): string {
  const unit = 10n ** 13n;
  const units = round === 'up' ? (wei + unit - 1n) / unit : wei / unit;
  const s = units.toString().padStart(6, '0');
  return `${s.slice(0, -5)}.${s.slice(-5)}`;
}

/** Splits a message into lines of at most `max` characters, so it fits in a box on narrow terminals. */
export function wrap(text: string, max = 64): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}
