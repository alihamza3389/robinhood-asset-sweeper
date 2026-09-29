import { Hex, decodeFunctionResult, encodeFunctionData } from 'viem';
import { erc20Abi, permit2Abi, routerAbi, uniswapAbi, v4Abi, wethAbi } from '../chain.js';
import { UNISWAP_V4 } from '../constants.js';
import { bestV4Quote, buildV4Sell } from '../scan/uniswapV4.js';
import { bestQuote } from '../scan/uniswap.js';
import { routerAddress } from '../scan/registry.js';
import { ActionResult, TokenAsset } from '../types.js';
import { ActionContext, describeError, waitForSuccess } from './context.js';

const DEADLINE_SECONDS = 600n;
/** SwapRouter02's placeholder for "keep the output in the router" (so it can unwrap WETH to ETH for us). */
const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';

/** quoted * (1 - slippage). Slippage is a percent; resolution is 0.01%. */
export function applySlippage(quoted: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100));
  if (bps < 0n || bps >= 10_000n) throw new Error(`Invalid slippage ${slippagePercent}%`);
  return (quoted * (10_000n - bps)) / 10_000n;
}

/** Simulate a swap; returns the router's output and a function that sends exactly the simulated call. */
async function simulateSwap(
  ctx: ActionContext,
  token: TokenAsset,
  amountIn: bigint,
  minOut: bigint,
  deadline: bigint,
  uniPath?: Hex
) {
  const { publicClient, walletClient, owner } = ctx;
  if (token.route === 'NONE' || token.route === 'UNWRAP' || token.route === 'UNIV4') throw new Error('Token has no swap route');
  const address = routerAddress(token.route);
  const account = walletClient.account;
  if (token.route === 'UNIV3') {
    if (!uniPath) throw new Error('No Uniswap path');
    // Swap into WETH held by the router, then unwrap it and send plain ETH to the wallet, in one transaction.
    const calls = [
      encodeFunctionData({
        abi: uniswapAbi,
        functionName: 'exactInput',
        args: [{ path: uniPath, recipient: ADDRESS_THIS, amountIn, amountOutMinimum: minOut }],
      }),
      encodeFunctionData({ abi: uniswapAbi, functionName: 'unwrapWETH9', args: [minOut, owner] }),
    ];
    const { result, request } = await publicClient.simulateContract({
      account,
      address,
      abi: uniswapAbi,
      functionName: 'multicall',
      args: [deadline, calls],
    });
    const quoted = decodeFunctionResult({ abi: uniswapAbi, functionName: 'exactInput', data: result[0] });
    return { quoted, send: () => walletClient.writeContract(request) };
  }
  if (token.route === 'BUCKET') {
    const { result, request } = await publicClient.simulateContract({
      account,
      address,
      abi: routerAbi,
      functionName: 'swapExactBucketForETH',
      args: [amountIn, minOut, owner, deadline],
    });
    return { quoted: result, send: () => walletClient.writeContract(request) };
  }
  const { result, request } = await publicClient.simulateContract({
    account,
    address,
    abi: routerAbi,
    functionName: 'swapExactStockForETH',
    args: [token.address, amountIn, minOut, owner, deadline],
  });
  return { quoted: result, send: () => walletClient.writeContract(request) };
}

/**
 * Sell a token for ETH, delivered to the sender's wallet.
 *
 *  1. Approve the router for exactly `amountIn` (never unlimited).
 *  2. Simulate the swap to get the real output at current pool state.
 *  3. Send the swap with minAmountOut = simulated output minus slippage, so a front-run or
 *     sandwich that moves the price further than that makes the swap revert instead of losing funds.
 */
export interface SellOptions {
  slippagePercent: number;
  maxPriceImpactPercent: number;
  /** ETH value of one whole token at indicative market prices, if known. */
  ethPerToken?: number;
}

/** How far below the indicative price a quote is, in percent (negative = better than market). */
export function priceImpactPercent(quotedWei: bigint, amountIn: bigint, decimals: number, ethPerToken: number): number {
  const expected = (Number(amountIn) / 10 ** decimals) * ethPerToken;
  const got = Number(quotedWei) / 1e18;
  return expected > 0 ? ((expected - got) / expected) * 100 : 0;
}

/** Returns a "skipped" result when a quote is too far below the market price. */
function tooFarBelowMarket(token: TokenAsset, quoted: bigint, amountIn: bigint, opts: SellOptions): ActionResult | undefined {
  if (opts.ethPerToken === undefined) return undefined;
  const impact = priceImpactPercent(quoted, amountIn, token.decimals, opts.ethPerToken);
  if (impact <= opts.maxPriceImpactPercent) return undefined;
  return {
    asset: token,
    status: 'skipped',
    amount: amountIn,
    proceeds: quoted,
    message:
      `quote is ${impact.toFixed(1)}% below the market price (limit ${opts.maxPriceImpactPercent}%), ` +
      'probably thin liquidity. Try a smaller amount, or raise the limit with --max-impact.',
  };
}

/** WETH is just wrapped ETH: "selling" it means unwrapping it, 1:1, no market involved. */
async function unwrapWeth(ctx: ActionContext, token: TokenAsset, amount: bigint, max: boolean): Promise<ActionResult> {
  const { publicClient, walletClient, owner } = ctx;
  try {
    const balance = await publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
    const amountIn = max ? balance : amount;
    if (amountIn <= 0n) return { asset: token, status: 'skipped', message: 'Zero balance' };
    if (amountIn > balance) return { asset: token, status: 'failed', message: 'Amount exceeds current balance' };
    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: token.address,
      abi: wethAbi,
      functionName: 'withdraw',
      args: [amountIn],
    });
    if (ctx.dryRun) return { asset: token, status: 'simulated', amount: amountIn, proceeds: amountIn, message: 'Unwrap simulation passed' };
    ctx.onStatus?.('Unwrapping WETH to ETH…');
    const hash = await walletClient.writeContract(request);
    await waitForSuccess(publicClient, hash);
    return { asset: token, status: 'success', amount: amountIn, txHash: hash, proceeds: amountIn };
  } catch (err) {
    return { asset: token, status: 'failed', message: describeError(err) };
  }
}

/** Approve `spender` for exactly `amount` of `token` (resetting to 0 first if needed). */
async function approveExact(ctx: ActionContext, token: TokenAsset, spender: `0x${string}`, current: bigint, amount: bigint) {
  const { publicClient, walletClient } = ctx;
  // Some tokens refuse to change a non-zero allowance directly; reset to zero first for those.
  if (current > 0n) {
    const reset = await walletClient.writeContract({ address: token.address, abi: erc20Abi, functionName: 'approve', args: [spender, 0n] });
    await waitForSuccess(publicClient, reset);
  }
  const hash = await walletClient.writeContract({ address: token.address, abi: erc20Abi, functionName: 'approve', args: [spender, amount] });
  await waitForSuccess(publicClient, hash);
}

/**
 * Sell through a Uniswap v4 pool (token/ETH) using the Universal Router.
 * Approvals stay exact: the token approves Permit2 for exactly `amountIn`, and Permit2 lets the
 * router spend exactly `amountIn` for 10 minutes. The quote comes from the official V4Quoter.
 */
async function sellViaV4(
  ctx: ActionContext,
  token: TokenAsset,
  amount: bigint,
  max: boolean,
  opts: SellOptions
): Promise<ActionResult> {
  const { publicClient, walletClient, owner } = ctx;
  const { PERMIT2, UNIVERSAL_ROUTER } = UNISWAP_V4;
  try {
    const [balance, erc20Allowance, permit] = await Promise.all([
      publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'allowance', args: [owner, PERMIT2] }),
      publicClient.readContract({ address: PERMIT2, abi: permit2Abi, functionName: 'allowance', args: [owner, token.address, UNIVERSAL_ROUTER] }),
    ]);
    const amountIn = max ? balance : amount;
    if (amountIn <= 0n) return { asset: token, status: 'skipped', message: 'Zero balance' };
    if (amountIn > balance) return { asset: token, status: 'failed', message: 'Amount exceeds current balance' };

    ctx.onStatus?.(`Finding the best Uniswap price for ${token.symbol}…`);
    const best = await bestV4Quote(publicClient, token.v4Pools ?? [], amountIn);
    if (!best) return { asset: token, status: 'failed', message: 'No Uniswap pool can take this amount right now' };
    const skip = tooFarBelowMarket(token, best.amountOut, amountIn, opts);
    if (skip) return skip;

    const now = Math.floor(Date.now() / 1000);
    const [permitAmount, permitExpiry] = permit;
    const needErc20 = erc20Allowance !== amountIn;
    const needPermit = permitAmount !== amountIn || permitExpiry < now + 60;
    if (needErc20 || needPermit) {
      if (ctx.dryRun) {
        return {
          asset: token,
          status: 'simulated',
          amount: amountIn,
          proceeds: best.amountOut,
          message: 'Would approve the exact amount (via Permit2), then swap on Uniswap',
        };
      }
      ctx.onStatus?.(`Approving ${token.symbol} for the exact amount…`);
      if (needErc20) await approveExact(ctx, token, PERMIT2, erc20Allowance, amountIn);
      if (needPermit) {
        const hash = await walletClient.writeContract({
          address: PERMIT2,
          abi: permit2Abi,
          functionName: 'approve',
          args: [token.address, UNIVERSAL_ROUTER, amountIn, now + 600],
        });
        await waitForSuccess(publicClient, hash);
      }
    }

    const minOut = applySlippage(best.amountOut, opts.slippagePercent);
    const { commands, inputs } = buildV4Sell(best.key, amountIn, minOut);
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_SECONDS;
    const { request } = await publicClient.simulateContract({
      account: walletClient.account,
      address: UNIVERSAL_ROUTER,
      abi: v4Abi,
      functionName: 'execute',
      args: [commands, inputs, deadline],
    });
    if (ctx.dryRun) {
      return { asset: token, status: 'simulated', amount: amountIn, proceeds: best.amountOut, message: 'Swap simulation passed' };
    }

    const before = await publicClient.getBalance({ address: owner });
    ctx.onStatus?.(`Swapping ${token.symbol} → ETH (min ${opts.slippagePercent}% slippage guard)…`);
    const hash = await walletClient.writeContract(request);
    const receipt = await waitForSuccess(publicClient, hash);
    const after = await publicClient.getBalance({ address: owner, blockNumber: receipt.blockNumber });
    const received = after - before + receipt.gasUsed * receipt.effectiveGasPrice;
    return { asset: token, status: 'success', amount: amountIn, txHash: hash, proceeds: received > 0n ? received : undefined };
  } catch (err) {
    return { asset: token, status: 'failed', message: describeError(err) };
  }
}

export async function sellToken(
  ctx: ActionContext,
  token: TokenAsset,
  amount: bigint,
  max: boolean,
  opts: SellOptions
): Promise<ActionResult> {
  const { slippagePercent } = opts;
  const { publicClient, walletClient, owner } = ctx;
  if (token.route === 'NONE') return { asset: token, status: 'skipped', message: 'No DEX route for this token' };
  if (token.route === 'UNWRAP') return unwrapWeth(ctx, token, amount, max);
  if (token.route === 'UNIV4') return sellViaV4(ctx, token, amount, max, opts);
  const router = routerAddress(token.route);

  try {
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
      publicClient.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, router],
      }),
    ]);
    const amountIn = max ? balance : amount;
    if (amountIn <= 0n) return { asset: token, status: 'skipped', message: 'Zero balance' };
    if (amountIn > balance) return { asset: token, status: 'failed', message: 'Amount exceeds current balance' };

    // Uniswap: the quoter prices the trade without an approval, so check the price before
    // approving anything. No gas is spent on a sale that would be skipped anyway.
    let uniPath: Hex | undefined;
    let uniQuote: bigint | undefined;
    if (token.route === 'UNIV3') {
      ctx.onStatus?.(`Finding the best Uniswap price for ${token.symbol}…`);
      const best = await bestQuote(publicClient, token.uniPaths ?? [], amountIn);
      if (!best) return { asset: token, status: 'failed', message: 'No Uniswap pool can take this amount right now' };
      const skip = tooFarBelowMarket(token, best.amountOut, amountIn, opts);
      if (skip) return skip;
      uniPath = best.path;
      uniQuote = best.amountOut;
    }

    // Approve exactly the amount being sold. An allowance that is higher (for example an unlimited
    // one left by an older version of this tool) is also replaced, so no router keeps extra access.
    if (allowance !== amountIn) {
      if (ctx.dryRun) {
        return {
          asset: token,
          status: 'simulated',
          amount: amountIn,
          proceeds: uniQuote,
          message: uniQuote
            ? 'Would approve the exact amount, then swap on Uniswap'
            : 'Would approve the router for the exact amount, then quote and swap (quote needs the approval)',
        };
      }
      ctx.onStatus?.(`Approving router for ${token.symbol} (exact amount)…`);
      // Some tokens refuse to change a non-zero allowance directly; reset to zero first for those.
      if (allowance > 0n) {
        const reset = await walletClient.writeContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [router, 0n],
        });
        await waitForSuccess(publicClient, reset);
      }
      const approve = await walletClient.writeContract({
        address: token.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [router, amountIn],
      });
      await waitForSuccess(publicClient, approve);
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_SECONDS;
    let quoted: bigint;
    if (uniQuote !== undefined) {
      quoted = uniQuote;
    } else {
      // Bucket routers can only be quoted by simulating the swap, which needs the approval.
      ctx.onStatus?.(`Quoting ${token.symbol} → ETH…`);
      quoted = (await simulateSwap(ctx, token, amountIn, 0n, deadline)).quoted;
      if (quoted <= 0n) return { asset: token, status: 'failed', message: 'Router quoted 0 ETH (no liquidity)' };
      const skip = tooFarBelowMarket(token, quoted, amountIn, opts);
      if (skip) return skip;
    }

    const minOut = applySlippage(quoted, slippagePercent);
    const guarded = await simulateSwap(ctx, token, amountIn, minOut, deadline, uniPath);
    if (ctx.dryRun) {
      return { asset: token, status: 'simulated', amount: amountIn, proceeds: quoted, message: 'Swap simulation passed' };
    }

    const before = await publicClient.getBalance({ address: owner });
    ctx.onStatus?.(`Swapping ${token.symbol} → ETH (min ${slippagePercent}% slippage guard)…`);
    const hash = await guarded.send();
    const receipt = await waitForSuccess(publicClient, hash);

    // ETH received = balance change + fee paid for the swap itself.
    const after = await publicClient.getBalance({ address: owner, blockNumber: receipt.blockNumber });
    const received = after - before + receipt.gasUsed * receipt.effectiveGasPrice;

    return {
      asset: token,
      status: 'success',
      amount: amountIn,
      txHash: hash,
      proceeds: received > 0n ? received : undefined,
    };
  } catch (err) {
    return { asset: token, status: 'failed', message: describeError(err) };
  }
}
