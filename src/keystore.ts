import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { Address, bytesToHex, concatBytes, getAddress, hexToBytes, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Password-encrypted private key, in the standard Ethereum keystore format (Web3 Secret Storage v3:
 * scrypt key derivation, AES-128-CTR, keccak MAC). The same format MetaMask and geth use, so the file
 * can also be imported into those wallets.
 */

export const KEYSTORE_FILE = 'wallet.keystore.json';
const keystorePath = () => path.resolve(process.cwd(), KEYSTORE_FILE);

// scrypt cost. N = 2^17 takes roughly half a second and 128 MB, which makes password guessing slow.
const SCRYPT = { n: 131_072, r: 8, p: 1, dklen: 32 };

export interface KeystoreV3 {
  version: 3;
  id: string;
  address: string;
  crypto: {
    cipher: 'aes-128-ctr';
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: 'scrypt';
    kdfparams: { n: number; r: number; p: number; dklen: number; salt: string };
    mac: string;
  };
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
  }
}

function deriveKey(password: string, salt: Buffer, p: { n: number; r: number; p: number; dklen: number }): Promise<Buffer> {
  // Refuse absurd parameters from a tampered file rather than trying to allocate gigabytes.
  if (p.n > 2 ** 20 || p.r > 16 || p.p > 16) return Promise.reject(new Error('Unsupported keystore file'));
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      p.dklen,
      { N: p.n, r: p.r, p: p.p, maxmem: 256 * p.n * p.r + 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key))
    )
  );
}

const macOf = (derived: Buffer, ciphertext: Buffer) => hexToBytes(keccak256(concatBytes([derived.subarray(16, 32), ciphertext])));

export async function encryptKey(privateKey: `0x${string}`, password: string): Promise<KeystoreV3> {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derived = await deriveKey(password, salt, SCRYPT);
  const cipher = createCipheriv('aes-128-ctr', derived.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(hexToBytes(privateKey)), cipher.final()]);
  return {
    version: 3,
    id: randomUUID(),
    address: privateKeyToAccount(privateKey).address.slice(2).toLowerCase(),
    crypto: {
      cipher: 'aes-128-ctr',
      ciphertext: ciphertext.toString('hex'),
      cipherparams: { iv: iv.toString('hex') },
      kdf: 'scrypt',
      kdfparams: { ...SCRYPT, salt: salt.toString('hex') },
      mac: bytesToHex(macOf(derived, ciphertext)).slice(2),
    },
  };
}

/** Throws WrongPasswordError if the password does not match. */
export async function decryptKey(ks: KeystoreV3, password: string): Promise<`0x${string}`> {
  // Some wallets (ethers, MyEtherWallet) write "Crypto" with a capital C.
  const cr = ks.crypto ?? (ks as unknown as { Crypto?: KeystoreV3['crypto'] }).Crypto;
  if (ks.version !== 3 || !cr || cr.kdf !== 'scrypt' || cr.cipher !== 'aes-128-ctr') {
    throw new Error('Unsupported keystore file');
  }
  const ciphertext = Buffer.from(cr.ciphertext, 'hex');
  const derived = await deriveKey(password, Buffer.from(cr.kdfparams.salt, 'hex'), cr.kdfparams);
  const expected = Buffer.from(cr.mac, 'hex');
  const actual = Buffer.from(macOf(derived, ciphertext));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new WrongPasswordError();

  const decipher = createDecipheriv('aes-128-ctr', derived.subarray(0, 16), Buffer.from(cr.cipherparams.iv, 'hex'));
  const key = bytesToHex(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  if (ks.address && privateKeyToAccount(key).address.toLowerCase() !== `0x${ks.address.toLowerCase()}`) {
    throw new Error('Keystore file is damaged (address does not match)');
  }
  return key;
}

export function keystoreExists(): boolean {
  return fs.existsSync(keystorePath());
}

export function loadKeystore(): KeystoreV3 {
  return JSON.parse(fs.readFileSync(keystorePath(), 'utf-8')) as KeystoreV3;
}

export function keystoreAddress(ks: KeystoreV3): Address | undefined {
  try {
    return getAddress(`0x${ks.address}`);
  } catch {
    return undefined;
  }
}

/** Previous keystores are kept as wallet.keystore.<time>.bak.json, never silently overwritten. */
export const KEYSTORE_BACKUP_PATTERN = /^wallet\.keystore\.\d+\.bak\.json$/;

export function keystoreBackups(): string[] {
  return fs.readdirSync(process.cwd()).filter((f) => KEYSTORE_BACKUP_PATTERN.test(f));
}

/** Writes the keystore readable only by the current user, backing up any existing one first. */
export function saveKeystore(ks: KeystoreV3): void {
  if (fs.existsSync(keystorePath())) {
    fs.renameSync(keystorePath(), path.resolve(process.cwd(), `wallet.keystore.${Date.now()}.bak.json`));
  }
  fs.writeFileSync(keystorePath(), JSON.stringify(ks, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(keystorePath(), 0o600);
  } catch {
    // Not supported on every filesystem (e.g. Windows); harmless.
  }
}

export function deleteKeystore(): void {
  fs.rmSync(keystorePath(), { force: true });
}
