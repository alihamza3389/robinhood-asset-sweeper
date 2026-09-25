import { Address, getAddress } from 'viem';

// Robinhood Chain mainnet (Arbitrum Orbit L2) defaults
/** Shown in the banner and help. Keep in step with package.json. */
export const VERSION = 'v3 Rework';

export const DEFAULTS = {
  chainId: 4663,
  chainName: 'Robinhood Chain',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  // RobinScan (Etherscan) is faster than the Blockscout explorer. Blockscout's API is still used to find tokens.
  explorerUrl: 'https://robin.etherscan.io',
  nativeSymbol: 'ETH',
  nativeDecimals: 18,
  slippagePercent: 2,
  maxPriceImpactPercent: 15,
} as const;

// All on-chain addresses live here and nowhere else.
// Selectors used below were checked against the deployed bytecode (the contracts are not verified).
export const CONTRACTS = {
  // Treasury.isRegistered(token) -> token is sellable through STOCK_ROUTER_DIRECT
  TREASURY: getAddress('0xe211898a898e5788878C91A1e458F3FFF3A8dD92'),
  // swapExactBucketForETH(amountIn, minOut, to, deadline)
  BUCKET_ROUTER: getAddress('0x35f9D5187A37003CEc81B630b3d378BA55C364Ea'),
  // swapExactStockForETH(stock, amountIn, minOut, to, deadline); has its own isRegistered(token)
  STOCK_ROUTER_USDG: getAddress('0x716f97Dd8e4A6DE04327e5A34a6B03f934905d6e'),
  // swapExactStockForETH(...) for Treasury-registered tokens
  STOCK_ROUTER_DIRECT: getAddress('0xbdA740412082BEf923131a3303c024a06E3a77Ec'),
  BUCKET_TOKEN: getAddress('0xbc9E7b1c5C0081f4aE85e71eC95703d3dEC9ffaD'),
  // Uniswap v4 StateView and the BUCKET/ETH pool, used for BUCKET pricing
  STATE_VIEW: getAddress('0xF3334192D15450CdD385c8B70e03f9A6bD9E673b'),
  MULTICALL3: getAddress('0xcA11bde05977b3631167028862bE2a173976CA11'),
} as const;

// Uniswap v3 on Robinhood Chain: used to sell tokens the Bucket routers don't support.
// Router and quoter were matched to the factory that deployed the live pools (all verified on Blockscout).
export const UNISWAP_V3 = {
  FACTORY: getAddress('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA'),
  ROUTER: getAddress('0xCaf681a66D020601342297493863E78C959E5cb2'), // SwapRouter02
  QUOTER: getAddress('0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7'), // QuoterV2
  WETH: getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'),
  USDG: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
  FEES: [100, 500, 3000, 10000] as const,
  /** Pools thinner than this are ignored (dust or bait pools). */
  MIN_WETH: 10n ** 16n, // 0.01 WETH
  MIN_USDG: 25_000_000n, // 25 USDG (6 decimals)
} as const;

export const BUCKET_POOL_ID = '0x8857c1a180b5483c98d38f4d62db5866de2f91b737513347283f55e446424ce3' as const;

/** Fallback if the official Robinhood token list can't be downloaded. Always checked on-chain. */
export const FALLBACK_STOCK_TOKENS: readonly string[] = [
  '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', // AAPL
  '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', // SPCX
  '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', // NVDA
  '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', // PLTR
  '0x322f0929c4625ed5bad873c95208d54e1c003b2d', // TSLA
  '0xff080c8ce2e5feadaca0da81314ae59d232d4afd', // MU
  '0x05b37fb53a299a1b874a619e1c4c404d52c36f4c', // RDDT
  '0x4ea005168d7f09a7a0ba9d1def21a479950e44c2', // COST
  '0xec262a75e413fafd0df80480274532c79d42da09', // MSTR
  '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc', // AMD
  '0xe0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8', // NFLX
  '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', // SPY
  '0xe93237c50d904957cf27e7b1133b510c669c2e74', // MSFT
  '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', // GOOGL
  '0x1b0e319c6a659f002271b69db8a7df2f911c153e', // GME
  '0x6330d8c3178a418788df01a47479c0ce7ccf450b', // COIN
  '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', // META
  '0xb90a19ff0af67f7779aff50a882a9cff42446400', // SNDK
  '0xb8dbf92f9741c9ac1c32115e78581f23509916fd', // APLD
  '0x75742c18bc1f1c5c5f448f4c9d9c6f66dafaaa38', // SOXX
  '0x47f93d52cbec7c6d2cfc080e154002370a60daea', // ASML
  '0xeb61c0ed490a367d4e3631ccf8a74b3bfc7e775d', // HII
  '0xf6290b5e7c26502e2da514c31509849718ea76a5', // AVAV
  '0xacef2e09adb47ad6abebad9ff06689e60615c2b6', // INDA
  '0xddf2266b79abf0b48898959b0ed6e6adf512be74', // MDB
  '0x7066a64c24e4206cd62e83bf198c1e7eb361f51e', // PFE
  '0x96b933c74ecb4a0926b9210cef7b743ef46be2e9', // KLAC
  '0x7c148f74ac7445d1f28366b7fcdc6792a9fcd0cf', // IBRX
];

export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD';

export const API = {
  blockscoutPro: (chainId: number) => `https://api.blockscout.com/${chainId}/api/v2`,
  bucketPrices: 'https://indexer-api.bucket.markets/prices',
  robinhoodAssets: 'https://api.robinhood.com/rhj/assets',
} as const;

/** GMGN referral code. Also embedded in the per-token chart links below. */
export const GMGN_REF = 'sZ5uzVHs';
export const GMGN_REFERRAL_URL = `https://gmgn.ai/r/${GMGN_REF}?chain=robinhood`;
/** Curated Robinhood Chain wallets (KOLs, influencers, notable traders) to follow on GMGN. */
export const RH_WALLETS_URL = 'https://rh-wallets.vercel.app/';
export const gmgnTokenUrl = (token: string) => `https://gmgn.ai/robinhood/token/${GMGN_REF}_${token}`;

export const DONATIONS = {
  evm: '0xcDcC4656293424544F32BfA58089e982B9624866',
  solana: '94TmHVSd6ZWc9cAWKysQXQ5hGaymBvkQVEgaTtLVyHt8',
} as const;

export const CUSTOM_TOKENS_FILE = 'custom-tokens.json';
