import os from 'node:os';
import chalk from 'chalk';
import stringWidth from 'string-width';
import { VERSION } from '../constants.js';

/**
 * Can this terminal draw emoji and rounded boxes? Old Windows 10 consoles can't, so they get plain ASCII.
 * Windows 11 opens CMD and PowerShell in Windows Terminal, which can, but it doesn't always set the
 * WT_SESSION variable, so Windows 11 is treated as capable too.
 * SWEEPER_PLAIN=1 forces the plain style if anything ever looks garbled.
 */
export function detectFancy(env = process.env, platform = process.platform, release = os.release()): boolean {
  if (env.SWEEPER_PLAIN === '1') return false;
  if (platform !== 'win32') return env.TERM !== 'linux'; // the bare Linux console lacks the glyphs
  const build = Number(release.split('.')[2]);
  if (Number.isFinite(build) && build >= 22000) return true; // Windows 11
  // Windows 10: only modern terminals that announce themselves.
  return Boolean(
    env.WT_SESSION ||
      env.TERMINUS_SUBLIME ||
      env.ConEmuTask === '{cmd::Cmder}' ||
      env.TERM_PROGRAM === 'Terminus-Sublime' ||
      env.TERM_PROGRAM === 'vscode' ||
      env.TERM === 'xterm-256color' ||
      env.TERM === 'alacritty' ||
      env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  );
}

export const fancy = detectFancy();

export const c = {
  brand: chalk.hex('#00C805'),
  brandBold: chalk.bold.hex('#00C805'),
  // Exact black, not palette black: many terminals draw bold palette black as grey.
  badge: chalk.bgHex('#00C805').hex('#000000').bold,
  warnBadge: chalk.bgYellow.hex('#000000').bold,
  dangerBadge: chalk.bgRed.white.bold,
  dim: chalk.gray,
  money: chalk.hex('#7CFC9A'),
  addr: chalk.cyan,
  warn: chalk.yellow,
  danger: chalk.red,
  bold: chalk.bold,
};

export const sym = fancy
  ? // Only characters every terminal draws one column wide. ✔ ✖ ⚠ ℹ are avoided on purpose:
    // some terminals (e.g. Windows Terminal) render them as two-column emoji, which breaks alignment.
    { ok: '✓', fail: '✗', warn: '!', info: 'i', arrow: '→', dot: '•', bullet: '›' }
  : { ok: 'OK', fail: 'X', warn: '!', info: 'i', arrow: '->', dot: '*', bullet: '>' };

/** Emoji only where the terminal can draw them. */
export const emoji = (e: string) => (fancy ? `${e} ` : '');

export const width = (s: string) => stringWidth(s);
export const padEnd = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)));
export const padStart = (s: string, w: number) => ' '.repeat(Math.max(0, w - width(s))) + s;

const termWidth = () => Math.max(40, process.stdout.columns || 80);

/**
 * A rounded box. Emoji used in the UI are all true two-column emoji and symbols are one column,
 * so widths measure correctly. If a line is too wide for the terminal, the right border is left
 * off rather than drawn in the wrong place.
 */
export function box(lines: string[], opts: { title?: string; color?: (s: string) => string } = {}): string {
  const paint = opts.color ?? c.brand;
  const [tl, tr, bl, br, h, v] = fancy ? ['╭', '╮', '╰', '╯', '─', '│'] : ['+', '+', '+', '+', '-', '|'];
  const title = opts.title ? ` ${opts.title} ` : '';
  const widest = Math.max(width(title) + 2, ...lines.map((l) => width(l) + 2));
  const fits = widest + 2 <= termWidth();
  const inner = Math.min(Math.max(widest, 48), termWidth() - 2);

  if (!fits) {
    const span = termWidth() - 2;
    return [
      paint(tl + h) + c.bold(title) + paint(h.repeat(Math.max(2, span - width(title) - 2))),
      ...lines.map((l) => `${paint(v)} ${l}`),
      paint(bl + h.repeat(span - 1)),
    ].join('\n');
  }
  const top = paint(tl + h) + c.bold(title) + paint(h.repeat(inner - width(title) - 1) + tr);
  const body = lines.map((l) => paint(v) + ' ' + padEnd(l, inner - 2) + ' ' + paint(v));
  const bottom = paint(bl + h.repeat(inner) + br);
  return [top, ...body, bottom].join('\n');
}

export function banner(dryRun = false): void {
  const lines = [
    `${c.brandBold(`${emoji('🧹')}Robinhood Chain Asset Sweeper`)} ${c.dim(VERSION)}`,
    c.dim('Send, sell or clean up the tokens in your wallet'),
  ];
  console.log('\n' + box(lines));
  if (dryRun) {
    console.log(
      '\n' +
        box(
          [
            c.warn.bold(`${emoji('🧪')}PRACTICE MODE`),
            'Everything is simulated. Nothing will be signed or sent,',
            'so you can safely explore every step.',
          ],
          { color: c.warn }
        )
    );
  }
}

/** Step header: a coloured badge plus a title, and an optional plain-English hint below. */
export function step(n: number, total: number, title: string, hint?: string): void {
  console.log(`\n${c.badge(` STEP ${n}/${total} `)} ${c.bold(title)}`);
  if (hint) console.log(c.dim(`  ${hint}`));
}

export function tip(text: string): void {
  console.log(c.dim(`  ${emoji('💡')}${text}`));
}

/** Shared look for every question. */
export const promptTheme = {
  prefix: { idle: c.brand('?'), done: c.brand(sym.ok) },
  style: {
    highlight: (s: string) => c.brandBold(s),
    description: (s: string) => c.dim(`  ${s}`),
  },
};

export const checkboxTheme = {
  ...promptTheme,
  icon: fancy
    ? { checked: c.brand(' ◉'), unchecked: c.dim(' ◯'), cursor: c.brand('❯') }
    : { checked: ' [x]', unchecked: ' [ ]', cursor: '>' },
};
