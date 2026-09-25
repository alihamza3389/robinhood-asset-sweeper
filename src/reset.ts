import fs from 'node:fs';
import path from 'node:path';
import { checkbox, confirm } from '@inquirer/prompts';
import { CUSTOM_TOKENS_FILE } from './constants.js';
import { KEYSTORE_FILE, keystoreAddress, keystoreBackups, loadKeystore } from './keystore.js';
import { box, c, checkboxTheme, emoji, promptTheme, sym } from './ui/theme.js';

interface SavedItem {
  file: string;
  label: string;
  description: string;
}

function savedItems(): SavedItem[] {
  let wallet = '';
  try {
    const addr = keystoreAddress(loadKeystore());
    if (addr) wallet = ` for ${addr.slice(0, 6)}…${addr.slice(-4)}`;
  } catch {
    // Missing or unreadable; the label just omits the address.
  }
  const all: SavedItem[] = [
    {
      file: KEYSTORE_FILE,
      label: `Password-locked private key${wallet}`,
      description: 'Removing it means you paste your key again next time.',
    },
    {
      file: '.env',
      label: 'Settings (Blockscout key, default destination)',
      description: 'The setup wizard runs again next time.',
    },
    { file: '.env.bak', label: 'Backup of older settings', description: 'Made when settings were replaced.' },
    {
      file: CUSTOM_TOKENS_FILE,
      label: 'Tokens you added by hand',
      description: 'They will no longer be checked automatically.',
    },
  ];
  const found = all.filter((i) => fs.existsSync(path.resolve(process.cwd(), i.file)));
  for (const file of keystoreBackups()) {
    found.push({
      file,
      label: `Older saved key (backup ${file.match(/\d+/)?.[0] ? new Date(Number(file.match(/\d+/)![0])).toLocaleDateString() : ''})`,
      description: 'Kept when a saved key was replaced. Still locked with its old password.',
    });
  }
  return found;
}

/** Lets the user choose which saved data to delete. Never touches anything on the blockchain. */
export async function runReset(): Promise<void> {
  const items = savedItems();
  console.log(
    '\n' +
      box(
        [
          'This removes what the tool has saved on this computer, so you can',
          'start fresh. It does not touch your wallet or any funds.',
        ],
        { title: `${emoji('🧽')}Reset the tool` }
      )
  );
  if (items.length === 0) {
    console.log(c.dim('\nNothing is saved, so there is nothing to reset.\n'));
    return;
  }

  const chosen = await checkbox<SavedItem>({
    message: 'What should be removed?',
    instructions: c.dim(' (space to change, enter to continue)'),
    theme: checkboxTheme,
    choices: items.map((i) => ({ name: i.label, value: i, checked: true, description: i.description })),
  });
  if (chosen.length === 0) {
    console.log(c.dim('\nNothing selected. Nothing was removed.\n'));
    return;
  }

  if (chosen.some((i) => i.file === KEYSTORE_FILE)) {
    console.log(
      '\n' +
        box(
          [
            'Before removing your saved key, make sure you can still get your',
            'private key elsewhere (for example from MetaMask or Rabby).',
            'The tool keeps no other copy.',
          ],
          { title: `${sym.warn} Your saved key`, color: c.warn }
        )
    );
  }
  const ok = await confirm({ message: `Remove ${chosen.length} item(s)?`, default: false, theme: promptTheme });
  if (!ok) {
    console.log(c.dim('\nCancelled. Nothing was removed.\n'));
    return;
  }

  for (const item of chosen) {
    fs.rmSync(path.resolve(process.cwd(), item.file), { force: true });
    console.log(c.brand(`  ${sym.ok} Removed: ${item.label}`));
  }
  const setupAgain = chosen.some((i) => i.file === '.env');
  console.log(
    c.dim(`\nDone. ${setupAgain ? 'Next time you start the tool, the setup wizard will run.' : 'Start the tool again whenever you like.'}\n`)
  );
}
