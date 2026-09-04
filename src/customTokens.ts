import fs from 'fs';
import path from 'path';
import { Address, isAddress } from 'viem';

const CUSTOM_TOKENS_FILE = path.resolve(process.cwd(), 'custom-tokens.json');

export function loadSavedCustomTokens(): Address[] {
  try {
    if (!fs.existsSync(CUSTOM_TOKENS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(CUSTOM_TOKENS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data
        .filter((addr): addr is Address => typeof addr === 'string' && isAddress(addr))
        .map((addr) => addr.toLowerCase() as Address);
    }
    return [];
  } catch {
    return [];
  }
}

export function saveCustomToken(tokenAddress: Address): boolean {
  try {
    const existing = loadSavedCustomTokens();
    const addrLower = tokenAddress.toLowerCase() as Address;
    if (!existing.includes(addrLower)) {
      existing.push(addrLower);
      fs.writeFileSync(CUSTOM_TOKENS_FILE, JSON.stringify(existing, null, 2), 'utf-8');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
