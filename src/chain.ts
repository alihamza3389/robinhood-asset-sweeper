import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  BaseError,
  HttpRequestError,
  nonceManager,
  parseAbi,
  RpcRequestError,
  TimeoutError,
  Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Config } from './types.js';
import { API, CONTRACTS } from './constants.js';

/**
 * Blockscout's JSON-RPC endpoint, used as a backup when the public RPC blocks or rate-limits.
 * It needs a block tag on eth_estimateGas, which viem leaves out, so that is added here.
 */
export function blockscoutRpcTransport(chainId: number, apiKey: string): Transport {
  const url = `${API.blockscoutRpc(chainId)}?apikey=${encodeURIComponent(apiKey)}`;
  return custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        let p = Array.isArray(params) ? params : [];
        if (method === 'eth_estimateGas' && p.length === 1) p = [...p, 'latest'];
        const body = { jsonrpc: '2.0', id: 1, method, params: p };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new HttpRequestError({ url: API.blockscoutRpc(chainId), status: res.status, body, details: res.statusText });
        const json = (await res.json()) as { result?: unknown; error?: unknown };
        if (json.error !== undefined) {
          const error =
            typeof json.error === 'string' ? { code: -32603, message: json.error } : (json.error as { code: number; message: string });
          throw new RpcRequestError({ body, error, url: API.blockscoutRpc(chainId) });
        }
        return json.result;
      },
    },
    { retryCount: 3, retryDelay: 500 }
  );
}

const FAILOVER_MS = 5 * 60_000;

/** Errors that mean "this RPC is refusing us right now", as opposed to a real answer like a revert. */
export function isRpcUnavailable(err: unknown): boolean {
  const http = err instanceof BaseError ? err.walk((e) => e instanceof HttpRequestError) : undefined;
  if (http instanceof HttpRequestError) return http.status === undefined || http.status === 403 || http.status === 429 || http.status >= 500;
  return err instanceof BaseError && err.walk((e) => e instanceof TimeoutError) instanceof TimeoutError;
}

/** Use `primary`; once it refuses us, use `backup` for a few minutes before trying `primary` again. */
export function failover(primary: Transport, backup: Transport): Transport {
  let backupUntil = 0;
  return (opts) => {
    const a = primary({ ...opts, retryCount: 0 });
    const b = backup(opts);
    return custom(
      {
        async request(args: { method: string; params?: unknown }) {
          if (Date.now() >= backupUntil) {
            try {
              return await a.request(args);
            } catch (err) {
              if (!isRpcUnavailable(err)) throw err;
              backupUntil = Date.now() + FAILOVER_MS;
            }
          }
          return b.request(args);
        },
      },
      { retryCount: 1 }
    )(opts);
  };
}

export function createClients(config: Config) {
  // The nonce is tracked locally after the first transaction, so back-to-back transactions
  // (approve, then swap) never reuse a nonce even if a backup RPC reports a slightly stale count.
  const account = privateKeyToAccount(config.privateKey, { nonceManager });

  const chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: { name: config.nativeSymbol, symbol: config.nativeSymbol, decimals: config.nativeDecimals },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: 'RobinScan', url: config.explorerUrl } },
    contracts: { multicall3: { address: CONTRACTS.MULTICALL3 } },
  });

  // The public RPC sometimes rate-limits or blocks a connection (HTTP 429/403). When it does, requests
  // move to Blockscout's JSON-RPC (the user's existing key) for a few minutes, then the public RPC is tried again.
  const primary = http(config.rpcUrl, { retryCount: 0, timeout: 20_000 });
  const transport = config.blockscoutApiKey
    ? failover(primary, blockscoutRpcTransport(config.chainId, config.blockscoutApiKey))
    : http(config.rpcUrl, { retryCount: 6, retryDelay: 400, timeout: 30_000 });
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
