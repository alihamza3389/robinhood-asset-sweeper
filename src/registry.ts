import { Address, PublicClient, parseAbi } from 'viem';
import { AssetCategory } from './types.js';

export const CONTRACTS = {
  TREASURY: '0xe211898a898e5788878C91A1e458F3FFF3A8dD92' as Address,
  BUCKET_ROUTER: '0x35f9D5187A37003CEc81B630b3d378BA55C364Ea' as Address,
  STOCK_ROUTER_USDG: '0x716f97Dd8e4A6DE04327e5A34a6B03f934905d6e' as Address,
  STOCK_ROUTER_DIRECT: '0xbdA740412082BEf923131a3303c024a06E3a77Ec' as Address,
  BUCKET_TOKEN: '0xbc9E7b1c5C0081f4aE85e71eC95703d3dEC9ffaD' as Address,
};

// Known Robinhood Stock Tokens (from docs.robinhood.com)
export const KNOWN_STOCK_ADDRESSES = new Set([
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
]);

// Fetch and cache dynamic stock tokens from official Robinhood API
let dynamicStocksFetched = false;
export async function loadOfficialRobinhoodStocks() {
  if (dynamicStocksFetched) return;
  try {
    const res = await fetch('https://api.robinhood.com/rhj/assets', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const assets = await res.json();
      if (Array.isArray(assets)) {
        for (const a of assets) {
          const contract = a.deployments?.[0]?.contractAddress;
          if (contract && typeof contract === 'string') {
            KNOWN_STOCK_ADDRESSES.add(contract.toLowerCase());
          }
        }
      }
      dynamicStocksFetched = true;
    }
  } catch {
    // Non-fatal, KNOWN_STOCK_ADDRESSES has default list
  }
}

const treasuryAbi = parseAbi([
  'function isRegistered(address token) view returns (bool)',
]);

export async function classifyAsset(
  tokenAddress: `0x${string}` | 'NATIVE',
  publicClient: PublicClient
): Promise<{ category: AssetCategory; isSellable: boolean }> {
  if (tokenAddress === 'NATIVE') {
    return { category: 'NATIVE', isSellable: false };
  }

  const addrLower = tokenAddress.toLowerCase();

  // 1. Check if $BUCKET Token
  if (addrLower === CONTRACTS.BUCKET_TOKEN.toLowerCase()) {
    return { category: 'BUCKET', isSellable: true };
  }

  // 2. Check if Stock Token
  if (KNOWN_STOCK_ADDRESSES.has(addrLower)) {
    return { category: 'STOCK', isSellable: true };
  }

  // 3. Check if registered in Treasury (Crypto / Payout assets)
  try {
    const isReg = await publicClient.readContract({
      address: CONTRACTS.TREASURY,
      abi: treasuryAbi,
      functionName: 'isRegistered',
      args: [tokenAddress],
    });

    if (isReg) {
      return { category: 'CRYPTO', isSellable: true };
    }
  } catch {
    // Ignore
  }

  return { category: 'UNREGISTERED', isSellable: false };
}
