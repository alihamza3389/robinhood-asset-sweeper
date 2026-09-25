import { Address, BaseError, ContractFunctionRevertedError, Hash, WaitForTransactionReceiptTimeoutError } from 'viem';
import { PublicClient, WalletClient } from '../chain.js';

export interface ActionContext {
  publicClient: PublicClient;
  walletClient: WalletClient;
  owner: Address;
  dryRun: boolean;
  /** Progress callback for spinners. */
  onStatus?: (text: string) => void;
}

export async function waitForSuccess(publicClient: PublicClient, hash: Hash) {
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  } catch (err) {
    if (err instanceof WaitForTransactionReceiptTimeoutError) {
      // The transaction may still confirm later; retrying blindly could send it twice.
      throw new Error(`Sent ${hash} but it was not confirmed within 3 minutes. Check it on the explorer before retrying.`);
    }
    throw err;
  }
  if (receipt.status !== 'success') throw new TxRevertedError(hash);
  return receipt;
}

export class TxRevertedError extends Error {
  constructor(public readonly hash: Hash) {
    super(`Transaction ${hash} reverted on-chain`);
  }
}

// Custom errors seen on the Robinhood Chain routers and OpenZeppelin tokens
const KNOWN_ERRORS: Record<string, string> = {
  '0xc4a25a83': 'Token is not registered with this DEX router',
  '0xe450d38c': 'Token reports a balance it cannot actually transfer (likely a phantom/spam token)',
};

/** Turn viem errors into one readable line. */
export function describeError(err: unknown): string {
  if (err instanceof TxRevertedError) return err.message;
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const sig = revert.signature ?? revert.raw?.slice(0, 10);
      if (sig && KNOWN_ERRORS[sig]) return KNOWN_ERRORS[sig];
      if (revert.data?.errorName) return `Reverted: ${revert.data.errorName}`;
      if (revert.reason) return `Reverted: ${revert.reason}`;
    }
    const text = err.details || err.shortMessage;
    for (const [sig, msg] of Object.entries(KNOWN_ERRORS)) if (err.message.includes(sig)) return msg;
    return text;
  }
  return err instanceof Error ? err.message : String(err);
}
