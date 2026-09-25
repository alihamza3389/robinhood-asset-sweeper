import { Address } from 'viem';
import { erc20Abi } from '../chain.js';
import { ActionResult, NativeAsset, TokenAsset } from '../types.js';
import { ActionContext, describeError, waitForSuccess } from './context.js';

/** Send an ERC-20. Simulated first, so phantom/non-transferable tokens are caught without spending gas. */
export async function transferToken(
  ctx: ActionContext,
  token: TokenAsset,
  to: Address,
  amount: bigint,
  max: boolean
): Promise<ActionResult> {
  const { publicClient, walletClient, owner } = ctx;
  try {
    const balance = await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    });
    const value = max ? balance : amount;
    if (value <= 0n) return { asset: token, status: 'skipped', message: 'Zero balance' };
    if (value > balance) return { asset: token, status: 'failed', message: 'Amount exceeds current balance' };

    const { request, result } = await publicClient.simulateContract({
      account: walletClient.account,
      address: token.address,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, value],
    });
    // Some tokens signal failure by returning false instead of reverting.
    if (result === false) return { asset: token, status: 'failed', message: 'The token refused the transfer (it may be paused or restricted)' };
    if (ctx.dryRun) return { asset: token, status: 'simulated', amount: value, message: 'Transfer simulation passed' };

    const hash = await walletClient.writeContract(request);
    ctx.onStatus?.(`Waiting for confirmation (${hash.slice(0, 10)}…)`);
    await waitForSuccess(publicClient, hash);
    return { asset: token, status: 'success', amount: value, txHash: hash };
  } catch (err) {
    return { asset: token, status: 'failed', message: describeError(err) };
  }
}

/**
 * Compute how much ETH can be sent while leaving exactly enough for the worst-case fee.
 * Exported for tests.
 */
export function maxSendable(balance: bigint, gasLimit: bigint, maxFeePerGas: bigint): bigint {
  const reserve = gasLimit * maxFeePerGas;
  return balance > reserve ? balance - reserve : 0n;
}

/**
 * Send native ETH. For `max`, the fee reserve is gasLimit * maxFeePerGas, and those exact values are
 * set on the transaction, so the node can never reject it for insufficient funds.
 */
export async function sendNative(
  ctx: ActionContext,
  asset: NativeAsset,
  to: Address,
  amount: bigint,
  max: boolean
): Promise<ActionResult> {
  const { publicClient, walletClient, owner } = ctx;
  try {
    const [balance, fees, estimate] = await Promise.all([
      publicClient.getBalance({ address: owner }),
      publicClient.estimateFeesPerGas(),
      publicClient.estimateGas({ account: owner, to, value: 1n }),
    ]);
    // Arbitrum gas estimates include the L1 data fee, which moves with L1 gas prices: keep headroom.
    const gas = (estimate * 125n) / 100n;
    const { maxFeePerGas, maxPriorityFeePerGas } = fees;
    const reserve = gas * maxFeePerGas;

    const value = max ? maxSendable(balance, gas, maxFeePerGas) : amount;
    if (value <= 0n) {
      return { asset, status: 'skipped', message: 'Balance is too small to cover the network fee' };
    }
    if (value + reserve > balance) {
      return { asset, status: 'failed', message: 'Not enough ETH to send this amount and pay the network fee' };
    }
    if (ctx.dryRun) return { asset, status: 'simulated', amount: value, message: 'Fee reserve calculated' };

    const hash = await walletClient.sendTransaction({ to, value, gas, maxFeePerGas, maxPriorityFeePerGas });
    ctx.onStatus?.(`Waiting for confirmation (${hash.slice(0, 10)}…)`);
    await waitForSuccess(publicClient, hash);
    return { asset, status: 'success', amount: value, txHash: hash };
  } catch (err) {
    return { asset, status: 'failed', message: describeError(err) };
  }
}
