import { Address, getAddress, isAddress, parseUnits, zeroAddress } from 'viem';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { Asset, OperationMode, PlanItem, TokenAsset } from '../types.js';
import { DEAD_ADDRESS, gmgnTokenUrl } from '../constants.js';
import { formatAmount, formatUsd, usdValue } from './format.js';
import { box, c, checkboxTheme, emoji, promptTheme } from './theme.js';
import { tokenTable } from './table.js';

export async function promptMode(): Promise<OperationMode | 'QUIT'> {
  return select<OperationMode | 'QUIT'>({
    message: 'What would you like to do?',
    theme: promptTheme,
    choices: [
      {
        name: `${emoji('📤')}Send to another wallet`,
        value: 'TRANSFER',
        description: 'Move tokens and/or ETH to another address, like your main wallet.',
      },
      {
        name: `${emoji('💱')}Sell tokens for ETH`,
        value: 'SELL',
        description: 'Swap tokens into ETH. The ETH stays in this wallet.',
      },
      {
        name: `${emoji('🧹')}Sell everything, then send the ETH`,
        value: 'SELL_AND_SWEEP',
        description: 'Swap tokens into ETH, then send all of it to another address in one go.',
      },
      {
        name: `${emoji('🔥')}Get rid of spam tokens`,
        value: 'BURN',
        description: 'Send junk or scam tokens to a burn address so they stop cluttering your wallet. Permanent.',
      },
      { name: `${emoji('👋')}Exit`, value: 'QUIT', description: 'Close the tool without doing anything.' },
    ],
  });
}

export function validateDestination(value: string, sender: Address): true | string {
  const v = value.trim();
  if (!isAddress(v)) return 'That is not a wallet address. It should start with 0x and be 42 characters long.';
  const lower = v.toLowerCase();
  if (lower === sender.toLowerCase()) return 'That is this same wallet. Enter a different address.';
  if (lower === zeroAddress) return 'That is the zero address. Anything sent there is lost forever.';
  if (lower === DEAD_ADDRESS.toLowerCase()) return 'That is the burn address. Use "Get rid of spam tokens" instead.';
  return true;
}

export async function promptDestination(sender: Address, fallback?: Address): Promise<Address> {
  const usableDefault = fallback && validateDestination(fallback, sender) === true ? fallback : undefined;
  const value = await input({
    message: usableDefault ? 'Where should it go? (press Enter to use your saved address)' : 'Where should it go? Paste the address:',
    default: usableDefault,
    theme: promptTheme,
    validate: (v) => validateDestination(v, sender),
  });
  return getAddress(value.trim());
}

export async function promptManualTokens(): Promise<Address[]> {
  const out: Address[] = [];
  const wants = await confirm({
    message: 'Is a token missing from this list? Add it by its contract address?',
    default: false,
    theme: promptTheme,
  });
  if (!wants) return out;
  for (;;) {
    const value = await input({
      message: 'Token contract address (press Enter when done):',
      theme: promptTheme,
      validate: (v) => (v.trim() === '' || isAddress(v.trim()) ? true : 'That is not a contract address (0x + 40 characters)'),
    });
    if (value.trim() === '') return out;
    out.push(getAddress(value.trim()));
  }
}

export async function promptAssets(mode: OperationMode, assets: Asset[]): Promise<Asset[]> {
  const { header, rows } = tokenTable(assets);
  const preselect = (a: Asset) => {
    const spam = a.kind === 'erc20' && a.flags.spam === true;
    return mode === 'BURN' ? spam : !spam;
  };

  // The header lines up with the checkbox rows (cursor + icon take 4 columns).
  console.log(`    ${header}`);
  return checkbox<Asset>({
    message: mode === 'BURN' ? c.danger('Pick the tokens to destroy') : 'Pick what to include',
    instructions: c.dim(' (↑↓ move, space select, a all, enter continue)'),
    theme: {
      ...checkboxTheme,
      style: {
        ...checkboxTheme.style,
        // After answering, list just the names instead of repeating whole table rows.
        renderSelectedChoices: <T,>(selected: ReadonlyArray<{ value: T }>) =>
          selected.map((ch) => (ch.value as Asset).symbol).join(', '),
      },
    },
    pageSize: 14,
    loop: false,
    choices: assets.map((a, i) => ({ name: rows[i], value: a, checked: preselect(a) })),
    validate: (v) => (v.length > 0 ? true : 'Pick at least one (use the space bar)'),
  });
}

export function parseAmountInput(value: string, asset: Asset): bigint | string {
  const v = value.trim().replace(/,/g, '');
  if (v.endsWith('%')) {
    const pct = Number(v.slice(0, -1));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 'Percent must be between 0 and 100';
    const raw = (asset.balance * BigInt(Math.round(pct * 100))) / 10_000n;
    return raw > 0n ? raw : 'That percent of the balance rounds to 0';
  }
  if (!/^\d*\.?\d+$/.test(v)) return 'Type a number (like 1.5), a percent (like 50%), or "max"';
  try {
    const raw = parseUnits(v, asset.decimals);
    if (raw <= 0n) return 'The amount must be more than 0';
    if (raw > asset.balance) return `You only have ${formatAmount(asset.balance, asset.decimals)} ${asset.symbol}`;
    return raw;
  } catch {
    return 'That amount could not be read';
  }
}

export async function promptAmounts(assets: Asset[]): Promise<PlanItem[]> {
  const allMax = await select({
    message: 'How much of each?',
    theme: promptTheme,
    choices: [
      { name: 'Everything (full balance)', value: true, description: 'For ETH, a small amount is kept back to pay the network fee.' },
      { name: 'Let me choose amounts', value: false, description: 'Type an amount or a percent for each one.' },
    ],
  });
  if (allMax) return assets.map((asset) => ({ asset, amount: asset.balance, max: true }));

  const plan: PlanItem[] = [];
  for (const asset of assets) {
    const lines = [
      `${c.bold(asset.symbol)}  ${c.dim(asset.name)}`,
      `You have  ${formatAmount(asset.balance, asset.decimals)} ${asset.symbol}  ${c.money(formatUsd(usdValue(asset)))}`,
    ];
    if (asset.kind === 'erc20') {
      lines.push(c.dim(`Contract  ${asset.address}`));
      lines.push(c.dim(`Chart     ${gmgnTokenUrl(asset.address)}`));
    } else {
      lines.push(c.dim('"max" keeps back just enough ETH for the network fee.'));
    }
    console.log('\n' + box(lines, { color: c.dim }));
    const value = await input({
      message: `Amount of ${asset.symbol} (a number, a percent like 50%, or max):`,
      default: 'max',
      theme: promptTheme,
      validate: (v) => {
        if (v.trim().toLowerCase() === 'max') return true;
        const parsed = parseAmountInput(v, asset);
        return typeof parsed === 'bigint' ? true : parsed;
      },
    });
    if (value.trim().toLowerCase() === 'max') {
      plan.push({ asset, amount: asset.balance, max: true });
    } else {
      const amount = parseAmountInput(value, asset) as bigint;
      plan.push({ asset, amount, max: amount === asset.balance });
    }
  }
  return plan;
}

export async function confirmBurn(count: number): Promise<boolean> {
  console.log(
    '\n' +
      box(
        [
          c.danger.bold(`${emoji('🔥')}This cannot be undone`),
          `${count} token(s) will be sent to the burn address and destroyed.`,
          'Only do this for tokens you are sure are worthless.',
        ],
        { color: c.danger }
      )
  );
  const typed = await input({ message: `Type ${c.danger.bold('BURN')} to continue, or anything else to cancel:`, theme: promptTheme });
  return typed.trim() === 'BURN';
}

export async function confirmPlan(dryRun: boolean): Promise<boolean> {
  return confirm({
    message: dryRun ? 'Run the practice simulation?' : 'Everything look right? Sign and send now?',
    default: false,
    theme: promptTheme,
  });
}

export const isTokenAsset = (a: Asset): a is TokenAsset => a.kind === 'erc20';
