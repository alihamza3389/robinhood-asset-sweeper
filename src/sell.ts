import {
  Address,
  PublicClient,
  WalletClient,
  parseAbi,
  formatUnits,
  maxUint256,
} from 'viem';
import { AssetInfo, ExecutionResult } from './types.js';
import { erc20Abi } from './transfer.js';

export const ROUTERS = {
  BUCKET_ROUTER: '0x35f9D5187A37003CEc81B630b3d378BA55C364Ea' as Address,
  STOCK_ROUTER_USDG: '0x716f97Dd8e4A6DE04327e5A34a6B03f934905d6e' as Address,
  STOCK_ROUTER_DIRECT: '0xbdA740412082BEf923131a3303c024a06E3a77Ec' as Address,
  BUCKET_TOKEN: '0xbc9E7b1c5C0081f4aE85e71eC95703d3dEC9ffaD' as Address,
};

// Known USDG-routed stocks on Robinhood Chain
const USDG_STOCKS = new Set([
  '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', // AAPL
  '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', // SPCX
  '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', // NVDA
  '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', // PLTR
  '0x322f0929c4625ed5bad873c95208d54e1c003b2d', // TSLA
]);

export const routerAbi = parseAbi([
  'function swapExactBucketForETH(uint256 amountIn, uint256 minAmountOut, address to, uint256 deadline) returns (uint256 amountOut)',
  'function swapExactStockForETH(address stock, uint256 amountIn, uint256 minAmountOut, address to, uint256 deadline) returns (uint256 amountOut)',
]);

export function getRouterForToken(tokenAddress: Address): { routerAddress: Address; isBucket: boolean } {
  const addrLower = tokenAddress.toLowerCase();
  if (addrLower === ROUTERS.BUCKET_TOKEN.toLowerCase()) {
    return { routerAddress: ROUTERS.BUCKET_ROUTER, isBucket: true };
  }
  if (USDG_STOCKS.has(addrLower)) {
    return { routerAddress: ROUTERS.STOCK_ROUTER_USDG, isBucket: false };
  }
  return { routerAddress: ROUTERS.STOCK_ROUTER_DIRECT, isBucket: false };
}

export async function executeSellToken(
  publicClient: PublicClient,
  walletClient: WalletClient,
  asset: AssetInfo,
  amountIn: bigint,
  isMax: boolean,
  recipientAddress: Address,
  slippagePercent = 5,
  onStatusUpdate?: (status: string) => void
): Promise<ExecutionResult> {
  const account = walletClient.account;
  if (!account) {
    throw new Error('WalletClient missing account');
  }

  if (asset.type === 'NATIVE') {
    return {
      asset,
      amountFormatted: asset.balanceFormatted,
      status: 'SKIPPED',
      error: 'Cannot sell Native ETH for ETH',
    };
  }

  const tokenAddress = asset.address as Address;
  let { routerAddress, isBucket } = getRouterForToken(tokenAddress);

  try {
    // 1. Re-read on-chain balance to prevent 1-wei precision mismatches (ERC20InsufficientBalance)
    const latestBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }).catch(() => 0n);

    const actualAmountIn = isMax
      ? latestBalance
      : (amountIn > latestBalance ? latestBalance : amountIn);

    if (actualAmountIn <= 0n) {
      return {
        asset,
        amountFormatted: '0',
        status: 'SKIPPED',
        error: 'Zero on-chain balance available to sell',
      };
    }

    const formattedAmount = formatUnits(actualAmountIn, asset.decimals);

    // 2. Check and ensure token allowance for the router
    onStatusUpdate?.(`Checking allowance for ${asset.symbol}...`);
    const currentAllowance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, routerAddress],
    });

    if (currentAllowance < actualAmountIn) {
      onStatusUpdate?.(`Step 1/2: Approving router for ${asset.symbol}...`);
      const approveTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [routerAddress, maxUint256],
        account,
        chain: walletClient.chain,
      });

      await publicClient.waitForTransactionReceipt({ hash: approveTx });
    }

    // 3. Swap token for ETH
    onStatusUpdate?.(`Step 2/2: Swapping ${asset.symbol} for ETH...`);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900); // 15 min deadline

    let swapTx: `0x${string}`;

    if (isBucket) {
      swapTx = await walletClient.writeContract({
        address: routerAddress,
        abi: routerAbi,
        functionName: 'swapExactBucketForETH',
        args: [actualAmountIn, 0n, recipientAddress, deadline],
        account,
        chain: walletClient.chain,
      });
    } else {
      try {
        swapTx = await walletClient.writeContract({
          address: routerAddress,
          abi: routerAbi,
          functionName: 'swapExactStockForETH',
          args: [tokenAddress, actualAmountIn, 0n, recipientAddress, deadline],
          account,
          chain: walletClient.chain,
        });
      } catch (err: any) {
        // If USDG router failed with StockNotRegistered, try Direct router
        if (routerAddress === ROUTERS.STOCK_ROUTER_USDG) {
          routerAddress = ROUTERS.STOCK_ROUTER_DIRECT;
          // Approve Direct router if needed
          const directAllowance = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [account.address, routerAddress],
          });
          if (directAllowance < actualAmountIn) {
            const approveDirect = await walletClient.writeContract({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: 'approve',
              args: [routerAddress, maxUint256],
              account,
              chain: walletClient.chain,
            });
            await publicClient.waitForTransactionReceipt({ hash: approveDirect });
          }

          swapTx = await walletClient.writeContract({
            address: routerAddress,
            abi: routerAbi,
            functionName: 'swapExactStockForETH',
            args: [tokenAddress, actualAmountIn, 0n, recipientAddress, deadline],
            account,
            chain: walletClient.chain,
          });
        } else {
          throw err;
        }
      }
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: swapTx });

    return {
      asset,
      amountFormatted: formattedAmount,
      txHash: swapTx,
      status: receipt.status === 'success' ? 'SUCCESS' : 'FAILED',
      error: receipt.status === 'reverted' ? 'Swap transaction reverted on-chain' : undefined,
    };
  } catch (err: any) {
    const rawError = String(err.message || err.shortMessage || err);
    let friendlyError = err.shortMessage || err.message || 'Unknown swap error';

    if (rawError.includes('0xc4a25a83') || rawError.includes('StockNotRegistered')) {
      friendlyError = 'Token not registered in Robinhood Chain DEX router';
    } else if (rawError.includes('0xe450d38c') || rawError.includes('ERC20InsufficientBalance')) {
      friendlyError = 'Insufficient on-chain token balance';
    }

    return {
      asset,
      amountFormatted: formatUnits(amountIn, asset.decimals),
      status: 'FAILED',
      error: friendlyError,
    };
  }
}
