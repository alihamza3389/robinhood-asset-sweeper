import { formatUnits } from 'viem';
import { AssetInfo } from './types.js';

export async function fetchTokensFromBlockscout(
  baseUrl: string,
  walletAddress: string,
  apiKey?: string,
  chainId: number = 4663
): Promise<AssetInfo[]> {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'Robinhood-EVM-Sweeper/1.0',
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Candidate URLs for Blockscout Pro API & instance API v2
  const candidateUrls: string[] = [
    // 1. Instance REST API v2 token-balances
    `${cleanBaseUrl}/addresses/${walletAddress}/token-balances`,
    `${cleanBaseUrl}/api/v2/addresses/${walletAddress}/token-balances`,
    // 2. Global Blockscout Pro REST API v2
    `https://api.blockscout.com/v2/chains/${chainId}/addresses/${walletAddress}/token-balances`,
    `https://api.blockscout.com/v2/addresses/${walletAddress}/token-balances?chain_id=${chainId}`,
    // 3. Instance REST API v2 tokens
    `${cleanBaseUrl}/addresses/${walletAddress}/tokens`,
    `${cleanBaseUrl}/api/v2/addresses/${walletAddress}/tokens`,
    // 4. Etherscan / Blockscout Pro Module format
    `${cleanBaseUrl}/api?module=account&action=tokenlist&address=${walletAddress}`,
    `https://api.blockscout.com/v2/api?chain_id=${chainId}&module=account&action=tokenlist&address=${walletAddress}`,
  ];

  for (const urlStr of candidateUrls) {
    try {
      const url = new URL(urlStr);
      if (apiKey && !url.searchParams.has('apikey')) {
        url.searchParams.set('apikey', apiKey);
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers,
      });

      if (!res.ok) {
        continue;
      }

      const data = await res.json();
      const assets = parseBlockscoutResponse(data);
      if (assets.length > 0) {
        return assets;
      }
    } catch {
      continue;
    }
  }

  return [];
}

function parseBlockscoutResponse(data: any): AssetInfo[] {
  const assets: AssetInfo[] = [];

  // Case 1: v2 array response [ { token: {...}, value: "..." } ]
  let items: any[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && Array.isArray(data.items)) {
    items = data.items;
  } else if (data && data.result && Array.isArray(data.result)) {
    // Case 2: v1 Etherscan-style { status: "1", result: [ { contractAddress, tokenName, tokenSymbol, tokenDecimal, balance } ] }
    for (const item of data.result) {
      try {
        const rawAddress = item.contractAddress || item.address;
        if (!rawAddress || !rawAddress.startsWith('0x')) continue;

        const decimals = parseInt(item.tokenDecimal || item.decimals || '18', 10);
        const balanceRaw = BigInt(item.balance || item.value || '0');
        if (balanceRaw <= 0n) continue;

        assets.push({
          address: rawAddress.toLowerCase() as `0x${string}`,
          type: 'ERC20',
          name: item.tokenName || item.name || 'Unknown Token',
          symbol: item.tokenSymbol || item.symbol || '???',
          decimals: isNaN(decimals) ? 18 : decimals,
          balanceRaw,
          balanceFormatted: formatUnits(balanceRaw, isNaN(decimals) ? 18 : decimals),
        });
      } catch {
        continue;
      }
    }
    return assets;
  }

  // Parse Blockscout v2 items
  for (const item of items) {
    try {
      const token = item.token || item;
      const rawAddress = token.address;
      if (!rawAddress || typeof rawAddress !== 'string' || !rawAddress.startsWith('0x')) {
        continue;
      }

      // Filter to only ERC-20
      if (token.type && token.type !== 'ERC-20') {
        continue;
      }

      const decimals = parseInt(String(token.decimals ?? '18'), 10);
      const balanceRawStr = item.value ?? token.balance ?? '0';
      const balanceRaw = BigInt(balanceRawStr);

      if (balanceRaw <= 0n) {
        continue;
      }

      const dec = isNaN(decimals) ? 18 : decimals;
      assets.push({
        address: rawAddress.toLowerCase() as `0x${string}`,
        type: 'ERC20',
        name: token.name || 'Unknown Token',
        symbol: token.symbol || '???',
        decimals: dec,
        balanceRaw,
        balanceFormatted: formatUnits(balanceRaw, dec),
      });
    } catch {
      continue;
    }
  }

  return assets;
}
