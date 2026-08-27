import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  parseAbi,
  Address,
  PublicClient,
  WalletClient,
  Chain,
  defineChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { AssetInfo, AssetTransferPlan, ExecutionResult, NetworkConfig } from './types.js';

export const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export function createClients(config: NetworkConfig, privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);

  const customChain: Chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: {
      default: { http: [config.rpcUrl] },
      public: { http: [config.rpcUrl] },
    },
    blockExplorers: config.explorerUrl
      ? {
          default: {
            name: 'Explorer',
            url: config.explorerUrl,
          },
        }
      : undefined,
  });

  const publicClient = createPublicClient({
    chain: customChain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: customChain,
    transport: http(config.rpcUrl),
  });

  return { account, publicClient, walletClient, chain: customChain };
}

export async function fetchNativeAsset(
  publicClient: PublicClient,
  address: `0x${string}`,
  symbol = 'ETH',
  decimals = 18
): Promise<AssetInfo> {
  const balanceRaw = await publicClient.getBalance({ address });
  return {
    address: 'NATIVE',
    type: 'NATIVE',
    name: 'Native Gas Token',
    symbol,
    decimals,
    balanceRaw,
    balanceFormatted: formatUnits(balanceRaw, decimals),
  };
}

export async function fetchOnchainErc20(
  publicClient: PublicClient,
  tokenAddress: `0x${string}`,
  ownerAddress: `0x${string}`
): Promise<AssetInfo | null> {
  try {
    const [name, symbol, decimals, balanceRaw] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'name',
      }).catch(() => 'Unknown Token'),
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'symbol',
      }).catch(() => '???'),
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      }).catch(() => 18),
      publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerAddress],
      }),
    ]);

    return {
      address: tokenAddress.toLowerCase() as `0x${string}`,
      type: 'ERC20',
      name,
      symbol,
      decimals: Number(decimals),
      balanceRaw,
      balanceFormatted: formatUnits(balanceRaw, Number(decimals)),
    };
  } catch {
    return null;
  }
}

export async function executeSingleTransfer(
  plan: AssetTransferPlan,
  recipient: `0x${string}`,
  walletClient: WalletClient,
  publicClient: PublicClient
): Promise<ExecutionResult> {
  const { asset, isMax } = plan;
  const account = walletClient.account;
  if (!account) {
    throw new Error('WalletClient must have an associated account');
  }

  try {
    if (asset.type === 'ERC20') {
      let amountToSend = plan.amountRaw;
      if (isMax) {
        // Re-read latest on-chain balance to account for any intermediate changes
        const latestBalance = await publicClient.readContract({
          address: asset.address as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        });
        amountToSend = latestBalance;
      }

      if (amountToSend <= 0n) {
        return {
          asset,
          amountFormatted: '0',
          status: 'SKIPPED',
          error: 'Zero balance to transfer',
        };
      }

      const txHash = await walletClient.writeContract({
        address: asset.address as Address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [recipient, amountToSend],
        account,
        chain: walletClient.chain,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        asset,
        amountFormatted: formatUnits(amountToSend, asset.decimals),
        txHash,
        status: receipt.status === 'success' ? 'SUCCESS' : 'FAILED',
        error: receipt.status === 'reverted' ? 'Transaction reverted on-chain' : undefined,
      };
    } else {
      // Native ETH transfer (executed last in sequence)
      let amountToSend = plan.amountRaw;
      const currentBalance = await publicClient.getBalance({ address: account.address });

      // Dynamic L2 Gas & EIP-1559 Fee Estimation for Robinhood Chain (Arbitrum Orbit)
      let estimatedGasLimit = 21250n;
      try {
        estimatedGasLimit = await publicClient.estimateGas({
          account: account.address,
          to: recipient,
          value: 1n,
        });
      } catch {
        // Fallback to standard Arbitrum Orbit native transfer limit
        estimatedGasLimit = 22000n;
      }

      let feePerGas = 50000000n; // default fallback 0.05 Gwei
      try {
        const fees = await publicClient.estimateFeesPerGas();
        if (fees.maxFeePerGas && fees.maxFeePerGas > 0n) {
          feePerGas = fees.maxFeePerGas;
        } else {
          feePerGas = await publicClient.getGasPrice();
        }
      } catch {
        feePerGas = await publicClient.getGasPrice();
      }

      // 30% safety buffer over estimated fee per gas to absorb block base-fee variations
      const safeFeePerGas = (feePerGas * 130n) / 100n;
      const totalGasCost = estimatedGasLimit * safeFeePerGas;

      if (isMax) {
        if (currentBalance <= totalGasCost) {
          return {
            asset,
            amountFormatted: '0',
            status: 'SKIPPED',
            error: `Remaining balance (${formatUnits(currentBalance, asset.decimals)} ${asset.symbol}) is lower than the gas required for the sweep (${formatUnits(totalGasCost, asset.decimals)} ${asset.symbol})`,
          };
        }
        amountToSend = currentBalance - totalGasCost;
      } else {
        if (currentBalance < amountToSend + totalGasCost) {
          return {
            asset,
            amountFormatted: plan.amountFormatted,
            status: 'FAILED',
            error: `Insufficient balance (${formatUnits(currentBalance, asset.decimals)} ${asset.symbol}) to send ${plan.amountFormatted} ${asset.symbol} + ${formatUnits(totalGasCost, asset.decimals)} ${asset.symbol} gas fee`,
          };
        }
      }

      const txHash = await walletClient.sendTransaction({
        account,
        chain: walletClient.chain,
        to: recipient,
        value: amountToSend,
        gas: (estimatedGasLimit * 115n) / 100n, // 15% gas limit buffer
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return {
        asset,
        amountFormatted: formatUnits(amountToSend, asset.decimals),
        txHash,
        status: receipt.status === 'success' ? 'SUCCESS' : 'FAILED',
        error: receipt.status === 'reverted' ? 'Transaction reverted on-chain' : undefined,
      };
    }
  } catch (err: any) {
    return {
      asset,
      amountFormatted: plan.amountFormatted,
      status: 'FAILED',
      error: err.shortMessage || err.message || 'Unknown transfer error',
    };
  }
}
