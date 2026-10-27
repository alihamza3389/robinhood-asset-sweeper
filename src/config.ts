import dotenv from 'dotenv';
import { parseArgs } from 'node:util';
import { Address, isAddress, getAddress } from 'viem';
import { Config } from './types.js';
import { DEFAULTS, VERSION } from './constants.js';
import { generatePrivateKey } from 'viem/accounts';
import { isValidPrivateKey, obtainPrivateKey, withPrefix } from './unlock.js';
import { promptLookAddress } from './ui/prompts.js';

export { isValidPrivateKey };

export const HELP = `
Robinhood Chain Asset Sweeper ${VERSION}
Send, sell, bridge (Robinhood Chain <-> Ethereum) or clean up your wallet.

Start it with run.bat (Windows), ./run.sh (Mac/Linux) or npm start.
Add options after --, for example: npm start -- --dry-run

Options:
  --dry-run            Scan and simulate everything, but never sign or send a transaction
  --slippage <pct>     Max slippage for sells, as a percent (default ${DEFAULTS.slippagePercent})
  --max-impact <pct>   Skip a sale if its quote is this much below the market price (default ${DEFAULTS.maxPriceImpactPercent})
  --look <address>     Just look around: explore any wallet in practice mode, no key needed
  --track <tx hash>    Check on a bridge deposit you sent earlier
  --setup              Run the setup wizard again
  --reset              Remove saved settings and your saved (password-locked) key
  -h, --help           Show this help

Settings are read from .env, which the setup wizard creates on first run.
On start the tool checks GitHub for a newer version and asks before updating (set SWEEPER_NO_UPDATE=1 to skip).
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
  /** A bridge deposit to check on (--track). */
  track?: `0x${string}`;
  /** Just looking at this wallet, without a key (--look). */
  look?: Address;
}

export function parseCli(argv = process.argv.slice(2)): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      slippage: { type: 'string' },
      'max-impact': { type: 'string' },
      track: { type: 'string' },
      look: { type: 'string' },
      setup: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.track !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(values.track.trim())) {
    throw new Error(`--track needs a transaction hash (0x followed by 64 characters), got "${values.track}"`);
  }
  if (values.look !== undefined && !isAddress(values.look.trim())) {
    throw new Error(`--look needs a wallet address (0x followed by 40 characters), got "${values.look}"`);
  }
  return {
    track: values.track?.trim() as `0x${string}` | undefined,
    look: values.look ? getAddress(values.look.trim()) : undefined,
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
export async function loadConfig(cli: CliOptions, opts: { look?: boolean } = {}): Promise<Config> {
  dotenv.config({ quiet: true });

  // A plain key in .env (advanced) wins; otherwise the encrypted keystore, otherwise ask.
  const envKey = envStr('PRIVATE_KEY');
  // Just looking (--look, or chosen in the wizard or at the key prompt): no key at all.
  let lookAt = cli.look;
  let privateKey: `0x${string}` | 'LOOK' | undefined;
  if (!lookAt && !opts.look) {
    privateKey = envKey && isValidPrivateKey(withPrefix(envKey)) ? (withPrefix(envKey) as `0x${string}`) : await obtainPrivateKey(!!envKey);
  }
  if (!lookAt && (opts.look || privateKey === 'LOOK')) lookAt = await promptLookAddress();
  // A throwaway stands in for the key so the clients can be built; with lookAt set it never signs.
  if (lookAt) privateKey = generatePrivateKey();

  const destEnv = envStr('DESTINATION_ADDRESS');
  const chainId = envInt('CHAIN_ID', DEFAULTS.chainId);
  const explorerUrl = (envStr('EXPLORER_URL') ?? DEFAULTS.explorerUrl).replace(/\/+$/, '');

  return {
    privateKey: privateKey as `0x${string}`,
    lookAt,
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
    dryRun: cli.dryRun || lookAt !== undefined,
  };
}
