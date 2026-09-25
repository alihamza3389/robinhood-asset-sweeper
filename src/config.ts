import dotenv from 'dotenv';
import { parseArgs } from 'node:util';
import { Address, isAddress, getAddress } from 'viem';
import { Config } from './types.js';
import { DEFAULTS } from './constants.js';
import { isValidPrivateKey, obtainPrivateKey, withPrefix } from './unlock.js';

export { isValidPrivateKey };

export const HELP = `
Robinhood Chain Asset Sweeper

Start it with run.bat (Windows), ./run.sh (Mac/Linux) or npm start.
Add options after --, for example: npm start -- --dry-run

Options:
  --dry-run            Scan and simulate everything, but never sign or send a transaction
  --slippage <pct>     Max slippage for sells, as a percent (default ${DEFAULTS.slippagePercent})
  --max-impact <pct>   Skip a sale if its quote is this much below the market price (default ${DEFAULTS.maxPriceImpactPercent})
  --setup              Run the setup wizard again
  --reset              Remove saved settings and your saved (password-locked) key
  -h, --help           Show this help

Settings are read from .env, which the setup wizard creates on first run.
`;

export function parsePercent(flag: string, raw: string | undefined, fallback: number, max = 50): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > max) {
    throw new Error(`--${flag} must be a number above 0 and at most ${max} (got "${raw}")`);
  }
  return n;
}

export interface CliOptions {
  help: boolean;
  setup: boolean;
  reset: boolean;
  dryRun: boolean;
  slippagePercent: number;
  maxPriceImpactPercent: number;
}

export function parseCli(argv = process.argv.slice(2)): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      slippage: { type: 'string' },
      'max-impact': { type: 'string' },
      setup: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  return {
    help: values.help ?? false,
    setup: values.setup ?? false,
    reset: values.reset ?? false,
    dryRun: values['dry-run'] ?? false,
    slippagePercent: parsePercent('slippage', values.slippage, DEFAULTS.slippagePercent),
    maxPriceImpactPercent: parsePercent('max-impact', values['max-impact'], DEFAULTS.maxPriceImpactPercent, 100),
  };
}

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envStr(name: string): string | undefined {
  const v = process.env[name]?.trim();
  // Treat untouched template placeholders ("your_..._here") as not set.
  return v && !/your_.*_here/i.test(v) ? v : undefined;
}

/** Reads .env (without overriding real environment variables) and gets the private key. */
export async function loadConfig(cli: CliOptions): Promise<Config> {
  dotenv.config({ quiet: true });

  // A plain key in .env (advanced) wins; otherwise the encrypted keystore, otherwise ask.
  const envKey = envStr('PRIVATE_KEY');
  const privateKey = envKey && isValidPrivateKey(withPrefix(envKey)) ? withPrefix(envKey) : await obtainPrivateKey(!!envKey);

  const destEnv = envStr('DESTINATION_ADDRESS');
  const chainId = envInt('CHAIN_ID', DEFAULTS.chainId);
  const explorerUrl = (envStr('EXPLORER_URL') ?? DEFAULTS.explorerUrl).replace(/\/+$/, '');

  return {
    privateKey: privateKey as `0x${string}`,
    defaultDestination: destEnv && isAddress(destEnv) ? (getAddress(destEnv) as Address) : undefined,
    rpcUrl: envStr('RPC_URL') ?? DEFAULTS.rpcUrl,
    chainId,
    chainName: envStr('CHAIN_NAME') ?? DEFAULTS.chainName,
    nativeSymbol: envStr('NATIVE_CURRENCY_SYMBOL') ?? DEFAULTS.nativeSymbol,
    nativeDecimals: envInt('NATIVE_CURRENCY_DECIMALS', DEFAULTS.nativeDecimals),
    explorerUrl,
    blockscoutApiKey: envStr('BLOCKSCOUT_API_KEY') ?? '',
    slippagePercent: cli.slippagePercent,
    maxPriceImpactPercent: cli.maxPriceImpactPercent,
    dryRun: cli.dryRun,
  };
}
