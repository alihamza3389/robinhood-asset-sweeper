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
    if (firstNonZero >= keep) keep = Math.min(firstNonZero + 3, decimals);
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
