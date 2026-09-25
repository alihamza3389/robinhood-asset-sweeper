import fs from 'node:fs';
import path from 'node:path';
import { Address, getAddress, isAddress } from 'viem';
import { CUSTOM_TOKENS_FILE } from '../constants.js';

const filePath = () => path.resolve(process.cwd(), CUSTOM_TOKENS_FILE);

export function loadCustomTokens(): Address[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(filePath(), 'utf-8'));
    if (!Array.isArray(data)) return [];
    return data.filter((a): a is string => typeof a === 'string' && isAddress(a)).map((a) => getAddress(a));
  } catch {
    return [];
  }
}

export function saveCustomToken(token: Address): void {
  const existing = loadCustomTokens();
  if (existing.some((a) => a.toLowerCase() === token.toLowerCase())) return;
  existing.push(getAddress(token));
  fs.writeFileSync(filePath(), JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}
