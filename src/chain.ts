import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Config } from './types.js';
import { CONTRACTS } from './constants.js';

export function createClients(config: Config) {
  const account = privateKeyToAccount(config.privateKey);

  const chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: { name: config.nativeSymbol, symbol: config.nativeSymbol, decimals: config.nativeDecimals },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: 'RobinScan', url: config.explorerUrl } },
    contracts: { multicall3: { address: CONTRACTS.MULTICALL3 } },
  });

  // The public RPC rate-limits bursts (HTTP 429); back off patiently instead of failing.
  const transport = http(config.rpcUrl, { retryCount: 6, retryDelay: 400, timeout: 30_000 });
  const publicClient = createPublicClient({ chain, transport, batch: { multicall: { batchSize: 16_384 } } });
  const walletClient = createWalletClient({ account, chain, transport });

  return { account, chain, publicClient, walletClient };
}

export type Clients = ReturnType<typeof createClients>;
export type PublicClient = Clients['publicClient'];
export type WalletClient = Clients['walletClient'];

export const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export const registryAbi = parseAbi(['function isRegistered(address token) view returns (bool)']);

export const routerAbi = parseAbi([
  'function swapExactBucketForETH(uint256 amountIn, uint256 minAmountOut, address to, uint256 deadline) returns (uint256 amountOut)',
  'function swapExactStockForETH(address stock, uint256 amountIn, uint256 minAmountOut, address to, uint256 deadline) returns (uint256 amountOut)',
]);

export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
]);

export const uniswapAbi = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)',
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
  'struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
]);

export const v4Abi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);

export const permit2Abi = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

export const wethAbi = parseAbi(['function withdraw(uint256 wad)']);
