export type AssetType = 'NATIVE' | 'ERC20';
export type AssetCategory = 'NATIVE' | 'BUCKET' | 'STOCK' | 'CRYPTO' | 'UNREGISTERED';
export type OperationMode = 'TRANSFER' | 'SELL_TO_ETH' | 'SELL_AND_SWEEP';

export interface AssetInfo {
  address: `0x${string}` | 'NATIVE';
  type: AssetType;
  category: AssetCategory;
  name: string;
  symbol: string;
  decimals: number;
  balanceRaw: bigint;
  balanceFormatted: string;
  isSellable: boolean;
  priceUsd?: number;
  valueUsd?: number;
}

export interface AssetTransferPlan {
  asset: AssetInfo;
  amountRaw: bigint;
  amountFormatted: string;
  isMax: boolean;
  valueUsd?: number;
}

export interface ExecutionResult {
  asset: AssetInfo;
  amountFormatted: string;
  txHash?: `0x${string}`;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  error?: string;
  proceedsEth?: string;
}

export interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  explorerUrl?: string;
  blockscoutApiUrl?: string;
  blockscoutApiKey?: string;
}
