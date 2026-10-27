import { Address, formatEther } from 'viem';
import { BridgeAmount, BridgeQuote, formatEthShort, TrackResult } from '../actions/bridge.js';
import { Competitor } from '../bridge/across.js';
import { formatUsd } from './format.js';
import { box, c, emoji, padEnd, padStart, sym, width } from './theme.js';

const ACROSS_ROW = 'Across (used by this tool)';
const MAX_ROWS = 5;

const usdOf = (wei: bigint, price?: number) => (price === undefined ? undefined : Number(formatEther(wei)) * price);
const withUsd = (wei: bigint, price?: number, round: 'down' | 'up' = 'down') => {
  const usd = usdOf(wei, price);
  return `${formatEthShort(wei, round)} ETH${usd === undefined ? '' : c.dim(` (${formatUsd(usd)})`)}`;
};

/** Rows for the comparison table: best first, at most MAX_ROWS, Across always included. Exported for tests. */
export function comparisonRows(acrossExpected: bigint, others: Competitor[]): Competitor[] {
  const rows = [{ name: ACROSS_ROW, out: acrossExpected }, ...others];
  // Stable sort: Across stays first on a tie.
  rows.sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0));
  const i = rows.findIndex((r) => r.name === ACROSS_ROW);
  return i < MAX_ROWS ? rows.slice(0, MAX_ROWS) : [...rows.slice(0, MAX_ROWS - 1), rows[i]];
}

export function printBridgeQuote(opts: { q: BridgeQuote; amountArg: BridgeAmount; from: Address; ethUsd?: number; dryRun: boolean }) {
  const { q, amountArg, from, ethUsd } = opts;
  const own = q.recipient.toLowerCase() === from.toLowerCase();
  const lines: string[] = [
    `${c.dim('Action')}    ${c.bold('Bridge ETH from Robinhood Chain to Ethereum')}`,
    `          ${c.dim('ETH in on Robinhood Chain, ETH out on Ethereum, through Across')}`,
    `${c.dim('From')}      ${c.addr(from)} ${c.dim('(Robinhood Chain)')}`,
    `${c.dim('To')}        ${c.warn.bold(q.recipient)} ${c.dim('(Ethereum)')}`,
    own ? `          ${c.dim('your own wallet, on Ethereum')}` : `          ${c.warn(`${sym.warn} not this wallet: double-check it`)}`,
    '',
    `${c.dim('You send')}  ${c.bold(withUsd(q.amount, ethUsd))}${amountArg.kind === 'max' ? c.dim('  (everything)') : ''}`,
  ];
  if (amountArg.kind === 'usd') {
    lines.push(`          ${c.dim(`you typed $${amountArg.usd}, at ${formatUsd(amountArg.usdPrice)} per ETH`)}`);
  }
  lines.push(
    `${c.dim('Arrives')}   ${c.money.bold(`at least ${formatEthShort(q.guaranteed)} ETH`)}${ethUsd ? c.dim(` (${formatUsd(usdOf(q.guaranteed, ethUsd))})`) : ''} ${c.dim(`usually in about ${q.fillSeconds} s`)}`,
    `${c.dim('Cost')}      ${withUsd(q.amount - q.guaranteed, ethUsd)} ${c.dim(`bridge fee, plus about ${formatUsd(q.gasUsd)} network fee`)}`
  );
  if (q.limits) {
    lines.push(`${c.dim('Limits')}    ${c.dim(`min ${formatEthShort(q.limits.min, 'up')} ETH, fast fill up to ${formatEthShort(q.limits.maxInstant)} ETH`)}`);
    if (q.amount > q.limits.maxInstant) lines.push(c.warn(`${sym.warn} Above the fast-fill limit, so it may take longer to arrive.`));
  }

  // Comparison: everyone's expected ETH for the same ETH in (for this route Across's expected equals its guarantee).
  const rows = comparisonRows(q.expected, q.competitors);
  const nameW = Math.max(...rows.map((r) => width(r.name)));
  const amounts = rows.map((r) => formatEthShort(r.out));
  const amountW = Math.max(...amounts.map(width));
  lines.push('', c.bold('Compared with other bridges') + c.dim(' (ETH arriving, best first)'));
  rows.forEach((r, i) => {
    const across = r.name === ACROSS_ROW;
    const diff = usdOf(r.out - q.expected, ethUsd);
    const gap = across
      ? c.brand('guaranteed')
      : diff === undefined
        ? ''
        : Math.abs(diff) < 0.005
          ? c.dim('about the same')
          : diff > 0
            ? c.warn(`${formatUsd(diff)} more (estimate)`)
            : c.dim(`${formatUsd(-diff)} less`);
    const name = across ? c.brand.bold(padEnd(r.name, nameW)) : padEnd(r.name, nameW);
    lines.push(`  ${name}  ${padStart(amounts[i], amountW)} ETH  ${gap}`);
  });
  if (q.competitors.length === 0) lines.push(c.dim('  (the other bridges did not answer in time)'));
  const best = rows[0];
  if (best.name !== ACROSS_ROW) {
    const more = usdOf(best.out - q.expected, ethUsd);
    if (more === undefined || more >= 0.1) {
      lines.push(c.dim(`  ${best.name} estimates a little more right now. That is an estimate;`), c.dim('  the Across amount is guaranteed, and this tool only uses Across.'));
    }
  }

  lines.push(
    '',
    c.brand(`${sym.ok} Checked: Across's known contract, this amount, the address above`),
    c.brand(`${sym.ok} Tested against the live chain first`),
    c.brand(`${sym.ok} If Across can't deliver, the ETH comes back here (as WETH)`)
  );
  console.log('\n' + box(lines, { title: `${emoji('🌉')}Please check this carefully`, color: c.warn }));
}

export function printBridgeOutcome(opts: {
  result: TrackResult;
  depositHash: string;
  explorerUrl: string;
  recipient?: Address;
  before?: bigint;
  after?: bigint;
  ethUsd?: number;
  /** Off for --track, where the wait measured is the lookup, not the delivery. */
  showTime?: boolean;
}) {
  const { result, depositHash, explorerUrl, recipient, before, after, ethUsd, showTime = true } = opts;
  const deposit = `${explorerUrl}/tx/${depositHash}`;
  if (result.status === 'filled') {
    const lines = recipient ? [`${c.dim('To')}        ${c.addr(recipient)} ${c.dim('(Ethereum)')}`] : [];
    if (before !== undefined && after !== undefined && after > before) {
      lines.push(`${c.dim('Received')}  ${c.money.bold(withUsd(after - before, ethUsd))}`);
      lines.push(`${c.dim('Balance')}   ${formatEthShort(before)} ${sym.arrow} ${formatEthShort(after)} ETH`);
    }
    if (showTime) lines.push(`${c.dim('Time')}      about ${result.seconds} s`);
    lines.push('', c.dim('Deposit  ') + c.addr(deposit), c.dim('Arrival  ') + c.addr(`https://etherscan.io/tx/${result.fillHash}`));
    console.log('\n' + box(lines, { title: `${emoji('🎉')}Arrived on Ethereum` }));
    return;
  }
  if (result.status === 'refunded') {
    const lines = [
      'Across could not deliver this one, so it was refunded to this',
      'wallet on Robinhood Chain as WETH. Run "Sell tokens for ETH" to',
      'turn the WETH back into ETH.',
      '',
      c.dim('Deposit  ') + c.addr(deposit),
    ];
    console.log('\n' + box(lines, { title: `${sym.warn} Refunded`, color: c.warn }));
    return;
  }
  if (result.status === 'unknown') {
    const lines = [
      'Across has no record of a deposit with this hash.',
      'Check that the hash is right (open the link below).',
      '',
      c.warn('If you just sent it, do NOT bridge again: it can take a few minutes'),
      c.warn('to appear. Check on it later with --track.'),
      '',
      c.dim('Deposit  ') + c.addr(deposit),
    ];
    console.log('\n' + box(lines, { title: `${sym.warn} Not found`, color: c.warn }));
    return;
  }
  const lines = [
    c.warn.bold('Do NOT bridge again.') + ' The deposit was sent; Across has not',
    'delivered it yet. It usually takes under a minute, sometimes longer.',
    '',
    'Check on it later by starting the tool with:',
    c.bold(`--track ${depositHash}`),
    c.dim('(for example: run.bat --track 0x…  or  ./run.sh --track 0x…)'),
    '',
    c.dim('Deposit  ') + c.addr(deposit),
  ];
  console.log('\n' + box(lines, { title: `${sym.warn} Still on its way`, color: c.warn }));
}
