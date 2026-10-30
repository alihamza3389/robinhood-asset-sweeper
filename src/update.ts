import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { confirm } from '@inquirer/prompts';
import { box, c, emoji, promptTheme, sym } from './ui/theme.js';

/**
 * Ask-first self update. Checks GitHub for a newer release on start; if the user agrees,
 * replaces the program files (never the user's key, settings or tokens) and asks the launcher
 * to reinstall packages and restart. Never updates without asking.
 */

export const REPO = 'alihamza3389/robinhood-asset-sweeper';
const PACKAGE_NAME = 'robinhood-chain-asset-sweeper';
/** Exit code that tells the launchers "update installed: run npm install and start again". */
export const RESTART_EXIT_CODE = 75;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files that belong to the user and must never be overwritten or removed by an update. */
export function isUserFile(rel: string): boolean {
  const first = rel.split(/[\\/]/)[0];
  return (
    first === 'node_modules' ||
    first === '.git' ||
    first === '.update-backup' ||
    first === '.env' ||
    (first.startsWith('.env.') && first !== '.env.example') ||
    /^wallet\.keystore.*\.json$/.test(first) ||
    first === 'custom-tokens.json'
  );
}

export function parseVersion(v: string): [number, number, number] | undefined {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The first few bullet points of the release notes, as plain text. */
export function summarizeNotes(body: string, max = 4): string[] {
  // The "How to update" section is instructions, not news.
  return body
    .split(/^#+\s*How to update.*$/im)[0]
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) =>
      l
        .replace(/^\s*[-*]\s+/, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .replace(/^\p{Extended_Pictographic}️?\s*/u, '')
        .trim()
    )
    .map((l) => l.split(/(?<=\.)\s/)[0]) // first sentence only
    .filter(Boolean)
    .slice(0, max)
    .map((l) => (l.length > 70 ? l.slice(0, 69) + '…' : l));
}

export function currentVersion(): string {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version as string;
}

interface Release {
  tag: string;
  name: string;
  body: string;
  /** The release's own .tar.gz upload, if it has one. Downloading it is what counts an update. */
  archiveUrl?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name: string; download_count: number; browser_download_url: string }[];
}

/**
 * Every release uploads robinhood-asset-sweeper.zip (for people: the README links to the latest one)
 * and robinhood-asset-sweeper-<tag>.tar.gz (for the updater). GitHub counts downloads of both.
 */
const ASSET_PREFIX = 'robinhood-asset-sweeper';
/** The banner only shows the download count once it is worth showing. */
export const MIN_DOWNLOADS_SHOWN = 100;

export interface ReleaseInfo {
  latest?: Release;
  /** Downloads of the uploaded release files, across all releases (fresh downloads and updates). */
  downloads: number;
}

/** Exported for tests: the newest published release, and the total downloads of our uploaded files. */
export function readReleases(list: GitHubRelease[]): ReleaseInfo {
  let latest: GitHubRelease | undefined;
  let downloads = 0;
  for (const r of list) {
    for (const a of r.assets ?? []) if (a.name.startsWith(ASSET_PREFIX) && /\.(zip|tar\.gz)$/.test(a.name)) downloads += a.download_count;
    if (r.draft || r.prerelease || !r.tag_name || !parseVersion(r.tag_name)) continue;
    if (!latest || isNewer(r.tag_name, latest.tag_name!)) latest = r;
  }
  if (!latest) return { downloads };
  const tag = latest.tag_name!;
  // Only ever download from this repo's own release files.
  const archiveUrl = latest.assets?.find(
    (a) =>
      a.name === `${ASSET_PREFIX}-${tag}.tar.gz` &&
      a.browser_download_url === `https://github.com/${REPO}/releases/download/${tag}/${a.name}`
  )?.browser_download_url;
  return { latest: { tag, name: latest.name ?? tag, body: latest.body ?? '', archiveUrl }, downloads };
}

/** One request for both the update check and the download count. Undefined if GitHub does not answer. */
export async function fetchReleases(): Promise<ReleaseInfo | undefined> {
  if (process.env.SWEEPER_NO_UPDATE === '1' || !process.stdout.isTTY) return undefined;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': PACKAGE_NAME },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return undefined;
    return readReleases((await res.json()) as GitHubRelease[]);
  } catch {
    return undefined;
  }
}

const run = (cmd: string, args: string[], cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf-8', windowsHide: true });

function isGitCheckout(): boolean {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return false;
  try {
    return run('git', ['remote', 'get-url', 'origin']).includes(REPO);
  } catch {
    return false;
  }
}

function updateWithGit(tag: string): void {
  if (run('git', ['status', '--porcelain']).trim()) {
    throw new Error('You have changed files in this folder, so it was not updated automatically. Run "git pull" yourself.');
  }
  run('git', ['fetch', '--tags', 'origin']);
  run('git', ['merge', '--ff-only', tag]);
  // Guard against a pull that changed nothing (which would otherwise offer the update forever).
  if (currentVersion() !== tag.replace(/^v/, '')) {
    throw new Error('git could not move this folder to the new version. Run "git pull" yourself.');
  }
}

/** All files under `dir` (relative paths), skipping symlinks and the user's own files and folders. */
function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isSymbolicLink() || isUserFile(rel)) return [];
    return e.isDirectory() ? listFiles(full, base) : [rel];
  });
}

/** Download the release, check it, then swap the program files (with a backup to roll back to). */
async function updateFromArchive(tag: string, archiveUrl?: string): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-update-'));
  try {
    // The release's uploaded file when it has one (so the update is counted), else GitHub's source download.
    const res = await fetch(archiveUrl ?? `https://api.github.com/repos/${REPO}/tarball/${encodeURIComponent(tag)}`, {
      headers: { 'User-Agent': PACKAGE_NAME },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status} for the download`);
    const archive = path.join(tmp, 'release.tar.gz');
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    const extracted = path.join(tmp, 'x');
    fs.mkdirSync(extracted);
    run('tar', ['-xzf', archive, '-C', extracted]);
    const [top] = fs.readdirSync(extracted);
    const src = path.join(extracted, top);

    // Make sure this really is the tool, at the version we expect.
    const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf-8')) as { name?: string; version?: string };
    if (pkg.name !== PACKAGE_NAME || pkg.version !== tag.replace(/^v/, '')) {
      throw new Error('The downloaded release did not look right, so nothing was changed.');
    }

    const incoming = listFiles(src);
    const current = listFiles(ROOT);
    const backup = path.join(ROOT, '.update-backup');
    fs.rmSync(backup, { recursive: true, force: true });
    for (const f of current) {
      fs.mkdirSync(path.dirname(path.join(backup, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(backup, f));
    }
    try {
      // Remove program files that the new version no longer has, then copy the new ones in.
      // Files whose content is unchanged are left alone (important for launchers that are running).
      const keep = new Set(incoming);
      for (const f of current) if (!keep.has(f)) fs.rmSync(path.join(ROOT, f), { force: true });
      for (const f of incoming) {
        const from = path.join(src, f);
        const to = path.join(ROOT, f);
        if (fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from))) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
      if (process.platform !== 'win32') fs.chmodSync(path.join(ROOT, 'run.sh'), 0o755);
    } catch (err) {
      for (const f of listFiles(backup)) fs.copyFileSync(path.join(backup, f), path.join(ROOT, f));
      throw new Error(`The update could not be applied, so the previous version was restored (${(err as Error).message}).`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Check for a newer release and offer to install it. Returns true if the program should exit so
 * the launcher can reinstall packages and start the new version.
 */
export async function checkForUpdate(releases: ReleaseInfo | undefined): Promise<boolean> {
  const current = currentVersion();
  const latest = releases?.latest;
  if (!latest || !isNewer(latest.tag, current)) return false;

  const notes = summarizeNotes(latest.body);
  console.log(
    '\n' +
      box(
        [
          `${c.bold(latest.tag)} is out ${c.dim(`(you have v${current})`)}`,
          ...(notes.length ? ['', ...notes.map((n) => `${sym.dot} ${n}`)] : []),
          '',
          c.dim('Your saved key, settings and tokens are kept.'),
        ],
        { title: `${emoji('✨')}Update available` }
      )
  );
  const yes = await confirm({ message: 'Update now?', default: true, theme: promptTheme });
  if (!yes) {
    console.log(c.dim('  Skipped. You can update any time by restarting the tool.'));
    return false;
  }

  process.stdout.write(c.dim(`  Downloading ${latest.tag}… `));
  try {
    if (isGitCheckout()) updateWithGit(latest.tag);
    else await updateFromArchive(latest.tag, latest.archiveUrl);
  } catch (err) {
    console.log(c.danger(`${sym.fail} ${(err as Error).message}`));
    console.log(c.dim(`  You can download it yourself: https://github.com/${REPO}/releases/latest`));
    return false;
  }
  console.log(c.brand(sym.ok));
  console.log(c.brand(`  ${sym.ok} Updated to ${latest.tag}. Your key and settings were kept.`));

  if (process.env.SWEEPER_LAUNCHER === '1') {
    console.log(c.dim('  Installing packages and restarting…\n'));
    return true;
  }
  console.log(c.warn(`\n  ${sym.warn} Run "npm install", then start the tool again to use the new version.\n`));
  return true;
}
