export type AssetType = 'NATIVE' | 'ERC20';

export interface AssetInfo {
  address: `0x${string}` | 'NATIVE';
  type: AssetType;
  name: string;
  symbol: string;
  decimals: number;
  balanceRaw: bigint;
  balanceFormatted: string;
}

export interface AssetTransferPlan {
  asset: AssetInfo;
  amountRaw: bigint;
  amountFormatted: string;
  isMax: boolean;
}

export interface ExecutionResult {
  asset: AssetInfo;
  amountFormatted: string;
  txHash?: `0x${string}`;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  error?: string;
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
