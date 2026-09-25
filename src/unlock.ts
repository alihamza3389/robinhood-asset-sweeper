import { confirm, password, select } from '@inquirer/prompts';
import { privateKeyToAccount } from 'viem/accounts';
import { isHex } from 'viem';
import {
  KEYSTORE_FILE,
  WrongPasswordError,
  decryptKey,
  encryptKey,
  keystoreAddress,
  keystoreExists,
  loadKeystore,
  saveKeystore,
} from './keystore.js';
import { box, c, emoji, promptTheme, sym } from './ui/theme.js';

export const MIN_PASSWORD = 8;
const MAX_TRIES = 3;

export function isValidPrivateKey(value: string): value is `0x${string}` {
  return isHex(value, { strict: true }) && value.length === 66;
}

export const withPrefix = (v: string) => (v.trim().startsWith('0x') ? v.trim() : `0x${v.trim()}`);

/** Explains why the key is needed, then asks for it (hidden). */
export async function promptPrivateKey(note?: string): Promise<`0x${string}`> {
  const lines = [
    "To sign transactions, the tool needs this wallet's private key.",
    '',
    `${sym.ok} It stays hidden while you paste it`,
    `${sym.ok} It never leaves this computer`,
    '',
    c.dim('Where to find it: MetaMask or Rabby, then Account details, then Show private key.'),
    c.dim('To paste here: right-click, or press Ctrl+V (Ctrl+Shift+V on Linux).'),
  ];
  if (note) lines.unshift(c.warn(note), '');
  console.log('\n' + box(lines, { title: `${emoji('🔐')}Unlock your wallet` }) + '\n');
  const key = await password({
    message: 'Paste your private key:',
    mask: '*',
    theme: promptTheme,
    validate: (v) =>
      isValidPrivateKey(withPrefix(v)) ? true : 'That does not look like a private key (64 letters and numbers, maybe starting with 0x)',
  });
  return withPrefix(key) as `0x${string}`;
}

/** Asks for a new password twice. */
export async function promptNewPassword(): Promise<string> {
  console.log(
    '\n' +
      box(
        [
          'Choose a password to lock your saved key. Next time you only',
          'type this password instead of pasting the key.',
          '',
          `${sym.warn} If you forget it, the saved key cannot be unlocked. Your`,
          '  wallet is still safe: just paste the key again and pick a new one.',
        ],
        { title: `${emoji('🔑')}Create a password`, color: c.dim }
      )
  );
  for (;;) {
    const first = await password({
      message: `New password (at least ${MIN_PASSWORD} characters):`,
      mask: '*',
      theme: promptTheme,
      validate: (v) => (v.length >= MIN_PASSWORD ? true : `Use at least ${MIN_PASSWORD} characters`),
    });
    const second = await password({ message: 'Type it again:', mask: '*', theme: promptTheme });
    if (first === second) return first;
    console.log(c.danger(`  ${sym.fail} The two passwords were different. Let's try again.`));
  }
}

/** Encrypts and saves the key; prints where. */
export async function saveEncryptedKey(key: `0x${string}`, pw: string): Promise<void> {
  process.stdout.write(c.dim('  Encrypting… '));
  saveKeystore(await encryptKey(key, pw));
  console.log(c.brand(`${sym.ok} saved to ${KEYSTORE_FILE}, locked with your password.`));
}

/** After a key was pasted, offer to keep it encrypted so the next run only needs a password. */
async function offerToSave(key: `0x${string}`): Promise<void> {
  const save = await confirm({
    message: 'Save this key, locked with a password, so next time you only type the password?',
    default: true,
    theme: promptTheme,
  });
  if (save) await saveEncryptedKey(key, await promptNewPassword());
}

async function pasteInstead(note?: string): Promise<`0x${string}`> {
  const key = await promptPrivateKey(note);
  await offerToSave(key);
  return key;
}

/**
 * Returns the private key: from the encrypted keystore (asking its password), or by asking
 * the user to paste it (then offering to save it encrypted).
 */
export async function obtainPrivateKey(savedInvalid = false): Promise<`0x${string}`> {
  if (!keystoreExists()) {
    return pasteInstead(savedInvalid ? 'The key saved in .env is not valid, so please paste it instead.' : undefined);
  }

  let ks;
  try {
    ks = loadKeystore();
  } catch {
    return pasteInstead(`${KEYSTORE_FILE} could not be read, so please paste your key instead.`);
  }
  const address = keystoreAddress(ks);
  console.log(
    '\n' +
      box([`${c.dim('Wallet')}  ${address ? c.addr(address) : c.dim('unknown')}`, c.dim('Your key is saved and locked.')], {
        title: `${emoji('🔐')}Unlock your wallet`,
      }) +
      '\n'
  );

  for (;;) {
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      // Neutral marker after answering: a green tick would suggest the password was right.
      const pw = await password({
        message: 'Password:',
        mask: '*',
        theme: { ...promptTheme, prefix: { idle: promptTheme.prefix.idle, done: c.dim(sym.bullet) } },
      });
      try {
        const key = await decryptKey(ks, pw);
        console.log(c.brand(`  ${sym.ok} Unlocked`));
        return key;
      } catch (err) {
        if (!(err instanceof WrongPasswordError)) {
          return pasteInstead(`${KEYSTORE_FILE} looks damaged (${(err as Error).message}), so please paste your key.`);
        }
        const left = MAX_TRIES - attempt;
        console.log(c.danger(`  ${sym.fail} Wrong password.${left ? ` ${left} more ${left === 1 ? 'try' : 'tries'}.` : ''}`));
      }
    }
    const next = await select({
      message: 'What would you like to do?',
      theme: promptTheme,
      choices: [
        { name: 'Try the password again', value: 'retry' },
        {
          name: 'I forgot it: paste my private key instead',
          value: 'paste',
          description: 'You can then choose a new password. The old saved key is kept as a backup.',
        },
        { name: 'Exit', value: 'exit' },
      ],
    });
    if (next === 'exit') process.exit(0);
    if (next === 'paste') {
      const key = await promptPrivateKey();
      if (address && privateKeyToAccount(key).address !== address) {
        console.log(c.warn(`  ${sym.warn} Note: this key is for a different wallet than the one saved.`));
      }
      await offerToSave(key);
      return key;
    }
  }
}
