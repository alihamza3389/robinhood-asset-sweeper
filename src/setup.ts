import fs from 'node:fs';
import path from 'node:path';
import { getAddress, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { confirm, input, select } from '@inquirer/prompts';
import { DEFAULTS } from './constants.js';
import { checkBlockscoutKey } from './scan/blockscout.js';
import { promptNewPassword, promptPrivateKey, saveEncryptedKey } from './unlock.js';
import { deleteKeystore, keystoreExists } from './keystore.js';
import { box, c, emoji, promptTheme, sym } from './ui/theme.js';

export const ENV_FILE = '.env';
const envPath = () => path.resolve(process.cwd(), ENV_FILE);

export const envExists = () => fs.existsSync(envPath());

/** Keep any lines of an existing .env we don't manage (custom RPC, etc.). */
function preservedLines(): string[] {
  if (!envExists()) return [];
  const managed = /^(PRIVATE_KEY|BLOCKSCOUT_API_KEY|DESTINATION_ADDRESS)\s*=/;
  return fs
    .readFileSync(envPath(), 'utf-8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+\s*=/.test(l) && !managed.test(l));
}

/**
 * Asks for a Blockscout key and checks it. If Blockscout can't be reached (outage, rate limit),
 * the user can keep the key anyway instead of being stuck.
 */
export async function askBlockscoutKey(chainId: number = DEFAULTS.chainId): Promise<string> {
  for (;;) {
    const key = (
      await input({
        message: 'Paste your Blockscout API key:',
        theme: promptTheme,
        validate: (v) => (v.trim() ? true : 'The key is needed to find your tokens'),
      })
    ).trim();
    process.stdout.write(c.dim('  Checking the key… '));
    const status = await checkBlockscoutKey(chainId, key);
    if (status === 'ok') {
      console.log(c.brand(`${sym.ok} it works!`));
      return key;
    }
    if (status === 'rejected') {
      console.log(c.danger(`${sym.fail} Blockscout did not accept it. Make sure you copied the whole key.`));
      continue;
    }
    console.log(c.warn(`${sym.warn} Blockscout could not be reached right now, so the key could not be checked.`));
    const next = await select({
      message: 'What would you like to do?',
      theme: promptTheme,
      choices: [
        { name: 'Try again', value: 'retry' },
        { name: 'Use this key anyway', value: 'keep', description: 'If it is wrong, the tool will tell you when it scans.' },
      ],
    });
    if (next === 'keep') return key;
  }
}

/** Setup section header, styled like the main steps. */
function section(n: number, title: string) {
  console.log(`\n${c.badge(` SETUP ${n}/3 `)} ${c.bold(title)}`);
}

/** Friendly first-run setup. Writes .env (readable only by the current user). */
export async function runSetupWizard(): Promise<void> {
  console.log(
    '\n' +
      box(
        [
          c.bold("Welcome! Let's get you set up. It takes about a minute."),
          '',
          `${sym.ok} Everything is signed ${c.bold('on this computer')}.`,
          `${sym.ok} Your private key is never sent anywhere.`,
          `${sym.ok} You will see a full summary before anything is sent.`,
          '',
          c.dim('Tip: start with "npm run dry-run" to practice without sending anything.'),
        ],
        { title: `${emoji('👋')}First-time setup` }
      )
  );

  if (envExists()) {
    const overwrite = await confirm({
      message: 'You already have saved settings. Replace them?',
      default: false,
      theme: promptTheme,
    });
    if (!overwrite) return;
    // Back up the old settings, but never a plain-text private key (older versions could save one there).
    const old = fs.readFileSync(envPath(), 'utf-8').replace(/^\s*PRIVATE_KEY\s*=.*$/gm, 'PRIVATE_KEY=');
    fs.writeFileSync(envPath() + '.bak', old, { encoding: 'utf-8', mode: 0o600 });
    console.log(c.dim(`  Your old settings were backed up to ${ENV_FILE}.bak`));
  }

  // 1. Private key
  section(1, 'Your wallet');
  const keyMode = await select({
    message: 'How should the tool get your private key?',
    theme: promptTheme,
    choices: [
      {
        name: 'Save it locked with a password (recommended)',
        value: 'encrypt',
        description: 'The key is encrypted on this computer. Each time, you just type your password.',
      },
      {
        name: 'Ask me to paste it every time',
        value: 'ask',
        description: 'Nothing is saved at all. You paste the key (it stays hidden) each time.',
      },
    ],
  });

  if (keyMode === 'encrypt') {
    for (;;) {
      const key = await promptPrivateKey();
      const address = privateKeyToAccount(key).address;
      console.log(`\n  ${c.dim('That key opens wallet')}  ${c.addr.bold(address)}`);
      if (await confirm({ message: 'Is this the right wallet?', default: true, theme: promptTheme })) {
        await saveEncryptedKey(key, await promptNewPassword());
        break;
      }
    }
  } else if (keystoreExists()) {
    const remove = await confirm({
      message: 'You have a password-locked key saved. Delete it so nothing is stored?',
      default: true,
      theme: promptTheme,
    });
    if (remove) deleteKeystore();
  }

  // 2. Blockscout key (required: it is how the tool finds your tokens)
  section(2, 'Free Blockscout key');
  console.log(
    box(
      [
        'Blockscout is the Robinhood Chain explorer. The tool uses it to',
        'find every token in your wallet. You need a free key:',
        '',
        `  1. Open ${c.addr.underline('https://dev.blockscout.com')}`,
        '  2. Sign in with email, Google or GitHub',
        '  3. Create an API key and copy it',
        '',
        c.dim('It takes about 30 seconds. No card needed.'),
      ],
      { title: `${emoji('🔑')}How to get it`, color: c.dim }
    )
  );
  const blockscoutKey = await askBlockscoutKey();

  // 3. Default destination
  section(3, 'Your usual destination (optional)');
  console.log(c.dim('  If you usually send to the same wallet, save it here so you do not have to paste it each time.'));
  const destination = (
    await input({
      message: 'Wallet address (or press Enter to skip):',
      theme: promptTheme,
      validate: (v) => (v.trim() === '' || isAddress(v.trim()) ? true : 'That is not a wallet address (0x + 40 characters)'),
    })
  ).trim();

  const lines = [
    '# Created by the setup wizard. Run `npm run setup` to change these.',
    '# Keep this file private. It is listed in .gitignore.',
    '',
    'PRIVATE_KEY=',
    `BLOCKSCOUT_API_KEY=${blockscoutKey}`,
    `DESTINATION_ADDRESS=${destination ? getAddress(destination) : ''}`,
    ...preservedLines(),
    '',
  ];
  fs.writeFileSync(envPath(), lines.join('\n'), { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(envPath(), 0o600);
  } catch {
    // Not supported on every filesystem (e.g. Windows); harmless.
  }

  console.log(
    '\n' +
      box(
        [
          c.brand.bold(`${sym.ok} Settings saved`),
          keyMode === 'ask'
            ? c.dim('Your private key was not saved. You will paste it each time.')
            : c.dim('Your key is locked with your password. Next time, just type the password.'),
          c.dim('Change these any time with "npm run setup".'),
        ],
        { title: `${emoji('✨')}You're ready` }
      )
  );
}
