import type { Address } from 'viem';

export type OperationMode = 'TRANSFER' | 'SELL' | 'SELL_AND_SWEEP' | 'BURN';

/** Which router, if any, can turn this token into ETH. */
/** UNWRAP: WETH, turned into ETH 1:1 by unwrapping. */
export type SellRoute = 'BUCKET' | 'USDG' | 'DIRECT' | 'UNIV3' | 'UNWRAP' | 'NONE';

export interface NativeAsset {
  kind: 'native';
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  priceUsd?: number;
}

export interface TokenAsset {
  kind: 'erc20';
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  route: SellRoute;
  /** Candidate Uniswap v3 paths to WETH, when route is UNIV3. The best is picked by a live quote. */
  uniPaths?: `0x${string}`[];
  /** Blockscout flagged it as spam, or it is a known Robinhood stock token. Purely informational. */
  flags: { spam?: boolean; robinhoodStock?: boolean };
  priceUsd?: number;
}

export type Asset = NativeAsset | TokenAsset;

export interface PlanItem {
  asset: Asset;
  /** Amount chosen by the user. For `max`, re-read from chain right before sending. */
  amount: bigint;
  max: boolean;
}

export type ResultStatus = 'success' | 'failed' | 'skipped' | 'simulated';

export interface ActionResult {
  asset: Asset;
  status: ResultStatus;
  amount?: bigint;
  txHash?: `0x${string}`;
  /** ETH received from a sale (sell modes only). */
  proceeds?: bigint;
  message?: string;
}

export interface Config {
  privateKey: `0x${string}`;
  defaultDestination?: Address;
  rpcUrl: string;
  chainId: number;
  chainName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerUrl: string;
  /** Blockscout Pro API key (free at dev.blockscout.com). Required for token discovery. */
  blockscoutApiKey: string;
  slippagePercent: number;
  /** Skip a sale whose quote is this much below the indicative USD price. */
  maxPriceImpactPercent: number;
  dryRun: boolean;
}
