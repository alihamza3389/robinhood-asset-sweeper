import ora from 'ora';
import { Address, formatUnits } from 'viem';
import { DEAD_ADDRESS, DONATIONS, GMGN_REFERRAL_URL, RH_WALLETS_URL, gmgnTokenUrl } from '../constants.js';
import { Asset, ActionResult, Config, NativeAsset, OperationMode, PlanItem } from '../types.js';
import { formatAmount, formatUsd, usdValue } from './format.js';
import { box, c, emoji, padEnd, padStart, sym, width } from './theme.js';
import { tokenTable } from './table.js';

const isToken = (a: Asset) => a.kind === 'erc20';

export const MODE_TITLE: Record<OperationMode, string> = {
  TRANSFER: 'Send to another wallet',
  SELL: 'Sell tokens for ETH',
  SELL_AND_SWEEP: 'Sell everything, then send the ETH',
  BURN: 'Get rid of spam tokens',
};

export function printWalletCard(sender: Address, native: NativeAsset, assets: Asset[], ethUsd?: number) {
  const tokens = assets.filter(isToken) as Extract<Asset, { kind: 'erc20' }>[];
  const sellable = tokens.filter((t) => t.route !== 'NONE').length;
  const spam = tokens.filter((t) => t.flags.spam).length;
  const total = assets.reduce((s, a) => s + (usdValue(a) ?? 0), 0);
  const eth = `${formatAmount(native.balance, native.decimals)} ${native.symbol}`;
  const ethValue =
    ethUsd !== undefined ? c.dim(` (${formatUsd(Number(formatUnits(native.balance, native.decimals)) * ethUsd)})`) : '';
  const fees = native.balance > 0n ? c.brand(`${sym.ok} can pay fees`) : c.danger(`${sym.fail} none, fees can't be paid`);

  const tokenSummary = [`${tokens.length} found`];
  if (sellable) tokenSummary.push(`${sellable} sellable`);
  if (spam) tokenSummary.push(c.danger(`${spam} likely spam`));

  const lines = [
    `${c.dim('Address')}   ${c.addr(sender)}`,
    `${c.dim('ETH')}       ${eth}${ethValue}  ${fees}`,
    `${c.dim('Tokens')}    ${tokenSummary.join(c.dim(' · '))}`,
    `${c.dim('Worth')}     ${c.money.bold(`about ${formatUsd(total)}`)}`,
  ];
  console.log('\n' + box(lines, { title: `${emoji('👛')}Your wallet` }));
}

function actionWord(mode: OperationMode, asset: Asset): string {
  if (mode === 'BURN') return c.danger('burn');
  if (mode === 'TRANSFER' || asset.kind === 'native') return 'send';
  return 'sell for ETH';
}

function txCount(mode: OperationMode, plan: PlanItem[]): string {
  if (mode === 'SELL' || mode === 'SELL_AND_SWEEP') {
    const extra = mode === 'SELL_AND_SWEEP' ? 1 : 0;
    return `${plan.length + extra} to ${plan.length * 2 + extra}`;
  }
  return String(plan.length);
}

const LIST_LIMIT = 25;

/** Everything found, so the user can see it before being asked about missing tokens. */
export function printTokenList(assets: Asset[]) {
  if (assets.length === 0) return;
  const shown = assets.slice(0, LIST_LIMIT);
  const { header, rows } = tokenTable(shown);
  console.log(`\n  ${header}`);
  for (const r of rows) console.log(`  ${r}`);
  if (assets.length > shown.length) console.log(c.dim(`  …and ${assets.length - shown.length} more`));
  console.log();
}

/** GMGN chart for every token in the plan, to check price and liquidity before confirming. */
export function printChartLinks(plan: PlanItem[]) {
  const tokens = plan.map((p) => p.asset).filter((a) => a.kind === 'erc20');
  if (tokens.length === 0) return;
  const w = Math.max(...tokens.map((t) => width(t.symbol)));
  console.log(`\n  ${emoji('📈')}${c.bold('Charts')} ${c.dim('(open one to check the price and trading activity)')}`);
  for (const t of tokens) console.log(`  ${padEnd(c.bold(t.symbol), w)}  ${c.addr(gmgnTokenUrl(t.address))}`);
}

export function printReview(mode: OperationMode, plan: PlanItem[], destination: Address | undefined, config: Config) {
  const rows = plan.map(({ asset, amount, max }) => ({
    name: asset.symbol,
    amount: `${max ? 'all ' : ''}${formatAmount(amount, asset.decimals)}`,
    usd: formatUsd(usdValue(asset, amount)),
    action: actionWord(mode, asset),
  }));
  const w = {
    name: Math.max(...rows.map((r) => width(r.name))),
    amount: Math.max(...rows.map((r) => width(r.amount))),
    usd: Math.max(...rows.map((r) => width(r.usd))),
  };
  const total = plan.reduce((s, p) => s + (usdValue(p.asset, p.amount) ?? 0), 0);

  const lines: string[] = [`${c.dim('Action')}    ${c.bold(MODE_TITLE[mode])}`];
  if (mode === 'BURN') lines.push(`${c.dim('To')}        ${c.danger(`${DEAD_ADDRESS} (burn address)`)}`);
  else if (destination) lines.push(`${c.dim('To')}        ${c.warn.bold(destination)}`);
  else lines.push(`${c.dim('ETH goes')}  back into this wallet`);
  lines.push('');
  for (const r of rows) {
    lines.push(
      `  ${padEnd(c.bold(r.name), w.name)}  ${padStart(r.amount, w.amount)}  ${c.money(padStart(r.usd, w.usd))}  ${c.dim(sym.arrow)} ${r.action}`
    );
  }
  if (mode === 'SELL_AND_SWEEP') lines.push(`  ${c.dim('then send all the ETH to the address above, minus the fee')}`);
  lines.push('');
  lines.push(`${c.dim('Worth')}     ${c.money.bold(`about ${formatUsd(total)}`)} ${c.dim('(prices are estimates)')}`);
  lines.push(`${c.dim('Txs')}       ${txCount(mode, plan)} ${c.dim('(each costs a tiny ETH network fee)')}`);
  if (mode === 'SELL' || mode === 'SELL_AND_SWEEP') {
    lines.push('');
    lines.push(c.brand(`${sym.ok} A sale is cancelled if the price moves more than ${config.slippagePercent}% while sending`));
    lines.push(c.brand(`${sym.ok} A sale is skipped if its price is ${config.maxPriceImpactPercent}%+ below the market`));
    lines.push(c.brand(`${sym.ok} The swap contract may only use the exact amount you are selling`));
  }
  const color = mode === 'BURN' ? c.danger : c.warn;
  console.log('\n' + box(lines, { title: `${emoji('🧾')}Please check this carefully`, color }));
  printChartLinks(plan);
}

export async function runStep(
  labels: { doing: string; done: string; would: string },
  fn: (onStatus: (t: string) => void) => Promise<ActionResult>,
  explorerUrl: string
) {
  const spinner = ora({ text: labels.doing, discardStdin: false }).start();
  const result = await fn((t) => (spinner.text = `${labels.doing} ${c.dim(`· ${t}`)}`));
  const what =
    result.amount !== undefined
      ? `${formatAmount(result.amount, result.asset.decimals)} ${result.asset.symbol}`
      : result.asset.symbol;
  const proceeds = result.proceeds !== undefined ? ` for ${c.money(`${formatAmount(result.proceeds, 18)} ETH`)}` : '';
  switch (result.status) {
    case 'success':
      spinner.stopAndPersist({ symbol: c.brand(sym.ok), text: `${labels.done} ${c.bold(what)}${proceeds}` });
      console.log(c.dim(`    ${explorerUrl}/tx/${result.txHash}`));
      break;
    case 'simulated':
      spinner.stopAndPersist({ symbol: c.addr(sym.info), text: `${labels.would} ${c.bold(what)}${proceeds} ${c.dim(`(practice: ${result.message ?? 'ok'})`)}` });
      break;
    case 'skipped':
      spinner.stopAndPersist({ symbol: c.warn(sym.warn), text: c.warn(`Skipped ${result.asset.symbol}: ${result.message}`) });
      break;
    case 'failed':
      spinner.stopAndPersist({ symbol: c.danger(sym.fail), text: c.danger(`${result.asset.symbol} failed: ${result.message}`) });
      break;
  }
  return result;
}

export function printSummary(results: ActionResult[], config: Config, ethUsd?: number) {
  const count = (s: ActionResult['status']) => results.filter((r) => r.status === s).length;
  const proceeds = results.reduce((sum, r) => sum + (r.status === 'success' ? (r.proceeds ?? 0n) : 0n), 0n);
  const failed = count('failed');

  const lines: string[] = [];
  if (count('success')) lines.push(c.brand(`${sym.ok} ${count('success')} completed`));
  if (count('simulated')) lines.push(c.addr(`${sym.info} ${count('simulated')} simulated`));
  if (count('skipped')) lines.push(c.warn(`${sym.warn} ${count('skipped')} skipped`));
  if (failed) lines.push(c.danger(`${sym.fail} ${failed} failed`));
  if (proceeds > 0n) {
    const usd = ethUsd ? c.dim(` (${formatUsd(Number(formatUnits(proceeds, 18)) * ethUsd)})`) : '';
    lines.push('', `ETH from sales: ${c.money.bold(`${formatAmount(proceeds, 18)} ETH`)}${usd}`);
  }
  if (failed) {
    lines.push('', 'When a step fails, the tokens stay in your wallet (only a', 'tiny network fee may be used). You can run the tool again.');
  }
  if (config.dryRun) {
    lines.push('', c.warn('This was practice. Nothing was sent.'), 'Start the tool again without --dry-run to do it for real.');
  }
  const title = config.dryRun
    ? `${emoji('🧪')}Practice run finished`
    : failed
      ? `${sym.warn} Finished, with some problems`
      : `${emoji('🎉')}All done`;
  console.log('\n' + box(lines, { title, color: failed ? c.warn : c.brand }));
}

export function printDonations() {
  console.log(
    '\n' +
      box(
        [
          'This tool is free and open source. If it saved you time or',
          'money, a tip keeps it going. Thank you!',
          '',
          c.dim('EVM (Ethereum, Base, Arbitrum, Robinhood Chain, Arc)'),
          c.addr.bold(DONATIONS.evm),
          '',
          c.dim('Solana'),
          c.addr.bold(DONATIONS.solana),
          '',
          `${emoji('⚡')}${c.bold('Trade on GMGN')}`,
          c.dim('Instant fills, multi-chain support (Robinhood Chain, Solana,'),
          c.dim('Base, BSC, Ethereum), live charts and smart-money tracking.'),
          c.dim('Sign up with this link to support the project:'),
          c.addr.bold(GMGN_REFERRAL_URL),
          '',
          c.dim('New to GMGN? Get instant access to the wallets of major KOLs,'),
          c.dim('influencers and top traders on Robinhood Chain to follow:'),
          c.addr.bold(RH_WALLETS_URL),
        ],
        { title: `${emoji('💚')}Support this project` }
      ) +
      '\n'
  );
}

