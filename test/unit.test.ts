import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, parseEther } from 'viem';
import { applySlippage, priceImpactPercent } from '../src/actions/sell.js';
import { maxSendable } from '../src/actions/transfer.js';
import { BlockscoutKeyError, fetchIndexedTokens, parseTokenItems } from '../src/scan/blockscout.js';
import { parseRobinhoodAssets, pickRoute } from '../src/scan/registry.js';
import { ethPerBucketFromSqrtPrice } from '../src/scan/prices.js';
import { formatAmount, formatUsd } from '../src/ui/format.js';
import { cleanText } from '../src/scan/wallet.js';
import { detectFancy } from '../src/ui/theme.js';
import { encodePath } from '../src/scan/uniswap.js';
import { decryptKey, encryptKey, KeystoreV3, keystoreBackups, saveKeystore, WrongPasswordError } from '../src/keystore.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAmountInput, validateDestination } from '../src/ui/prompts.js';
import { isValidPrivateKey, parseCli } from '../src/config.js';
import { CONTRACTS, DEAD_ADDRESS } from '../src/constants.js';
import { TokenAsset } from '../src/types.js';

const SENDER = getAddress('0x1111111111111111111111111111111111111111');
const OTHER = getAddress('0x2222222222222222222222222222222222222222');

test('applySlippage takes the percent off the quote', () => {
  assert.equal(applySlippage(10_000n, 2), 9_800n);
  assert.equal(applySlippage(10_000n, 0.5), 9_950n);
  assert.equal(applySlippage(parseEther('1'), 3), parseEther('0.97'));
  assert.throws(() => applySlippage(1n, 100));
});

test('maxSendable leaves exactly gasLimit * maxFeePerGas', () => {
  assert.equal(maxSendable(1_000_000n, 1_000n, 100n), 900_000n);
  assert.equal(maxSendable(100_000n, 1_000n, 100n), 0n);
  assert.equal(maxSendable(50n, 1_000n, 100n), 0n);
});

test('parseTokenItems keeps fungible types (incl. ERC-8056 stocks), drops NFTs, flags spam', () => {
  const tokens = parseTokenItems({
    items: [
      { token: { address_hash: '0x366EffF7918807c144700cfC4b69bD21e42537F8', type: 'ERC-20', reputation: 'ok', exchange_rate: '1.5' }, value: '9' },
      { token: { address_hash: '0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e', type: 'ERC-20', reputation: 'scam' }, value: '1' },
      { token: { address_hash: '0x0000000000000000000000000000000000000001', type: 'ERC-721' }, value: '1' },
      { token: { address_hash: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', type: 'ERC-8056' }, value: '5' },
      { token: { address: 'not-an-address', type: 'ERC-20' } },
    ],
  });
  assert.equal(tokens.length, 3);
  assert.ok(tokens.some((t) => t.address === '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'), 'ERC-8056 stock tokens are kept');
  assert.equal(tokens[0].address, '0x366EffF7918807c144700cfC4b69bD21e42537F8');
  assert.equal(tokens[0].spam, false);
  assert.equal(tokens[0].exchangeRate, 1.5);
  assert.equal(tokens[1].spam, true);
  assert.deepEqual(parseTokenItems({ nonsense: true }), []);
});

test('parseRobinhoodAssets handles the { assets: [...] } shape and filters by chain', () => {
  const set = parseRobinhoodAssets(
    {
      assets: [
        { deployments: [{ contractAddress: '0xD95B44124e475743a7589e68F3D74008A5536D44', chainId: 4663 }] },
        { deployments: [{ contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', chainId: 46630 }] },
      ],
    },
    4663
  );
  assert.deepEqual([...set], ['0xd95b44124e475743a7589e68f3d74008a5536d44']);
  assert.equal(parseRobinhoodAssets([1, 2], 4663).size, 0);
});

test('pickRoute prefers BUCKET, then USDG registry, then Treasury', () => {
  assert.equal(pickRoute(CONTRACTS.BUCKET_TOKEN, { usdg: false, treasury: false }), 'BUCKET');
  assert.equal(pickRoute(OTHER, { usdg: true, treasury: true }), 'USDG');
  assert.equal(pickRoute(OTHER, { usdg: false, treasury: true }), 'DIRECT');
  assert.equal(pickRoute(OTHER, { usdg: false, treasury: false }), 'NONE');
});

test('ethPerBucketFromSqrtPrice inverts the squared ratio', () => {
  // sqrtPrice = 2^96 * 10  ->  100 BUCKET per ETH  ->  0.01 ETH per BUCKET
  const v = ethPerBucketFromSqrtPrice(2n ** 96n * 10n)!;
  assert.ok(Math.abs(v - 0.01) < 1e-12);
  assert.equal(ethPerBucketFromSqrtPrice(0n), undefined);
});

test('formatAmount keeps significant digits for small values and trims big ones', () => {
  assert.equal(formatAmount(parseEther('1234567.891'), 18), '1,234,567.89');
  assert.equal(formatAmount(parseEther('1.5'), 18), '1.5');
  assert.equal(formatAmount(parseEther('0.00000001234'), 18), '0.0000000123');
  assert.equal(formatAmount(0n, 18), '0');
  assert.equal(formatAmount(123n, 0), '123');
  assert.equal(formatUsd(undefined), '$--');
  assert.equal(formatUsd(0.001), '<$0.01');
  assert.equal(formatUsd(1234.5), '$1,234.50');
});

test('parseAmountInput accepts numbers and percents, rejects bad input', () => {
  const asset: TokenAsset = {
    kind: 'erc20',
    address: OTHER,
    symbol: 'TKN',
    name: 'Token',
    decimals: 18,
    balance: parseEther('10'),
    route: 'NONE',
    flags: {},
  };
  assert.equal(parseAmountInput('2.5', asset), parseEther('2.5'));
  assert.equal(parseAmountInput('1,000', { ...asset, balance: parseEther('5000') }), parseEther('1000'));
  assert.equal(parseAmountInput('50%', asset), parseEther('5'));
  assert.equal(typeof parseAmountInput('11', asset), 'string');
  assert.equal(typeof parseAmountInput('0', asset), 'string');
  assert.equal(typeof parseAmountInput('-1', asset), 'string');
  assert.equal(typeof parseAmountInput('1e3', asset), 'string');
  assert.equal(typeof parseAmountInput('150%', asset), 'string');
});

test('validateDestination blocks self, zero and dead addresses', () => {
  assert.equal(validateDestination(OTHER, SENDER), true);
  assert.equal(typeof validateDestination(SENDER.toLowerCase(), SENDER), 'string');
  assert.equal(typeof validateDestination('0x0000000000000000000000000000000000000000', SENDER), 'string');
  assert.equal(typeof validateDestination(DEAD_ADDRESS, SENDER), 'string');
  assert.equal(typeof validateDestination('0x123', SENDER), 'string');
});

test('config helpers', () => {
  assert.equal(isValidPrivateKey('0x' + 'ab'.repeat(32)), true);
  assert.equal(isValidPrivateKey('0x' + 'zz'.repeat(32)), false);
  assert.equal(isValidPrivateKey('ab'.repeat(33)), false);
  const defaults = parseCli([]);
  assert.equal(defaults.slippagePercent, 2);
  assert.equal(defaults.maxPriceImpactPercent, 15);
  assert.equal(defaults.dryRun, false);
  const custom = parseCli(['--dry-run', '--slippage', '0.5', '--max-impact', '30']);
  assert.equal(custom.dryRun, true);
  assert.equal(custom.slippagePercent, 0.5);
  assert.equal(custom.maxPriceImpactPercent, 30);
  assert.throws(() => parseCli(['--slippage', '0']));
  assert.throws(() => parseCli(['--slippage', 'abc']));
  assert.throws(() => parseCli(['--slippage', '80']));
  assert.throws(() => parseCli(['--unknown']));
  assert.equal(parseCli(['--reset']).reset, true);
  assert.equal(defaults.reset, false);
});

test('priceImpactPercent compares the quote with the market price', () => {
  // 10 tokens at 0.01 ETH each should fetch 0.1 ETH
  assert.ok(Math.abs(priceImpactPercent(parseEther('0.1'), parseEther('10'), 18, 0.01)) < 1e-9);
  assert.ok(Math.abs(priceImpactPercent(parseEther('0.08'), parseEther('10'), 18, 0.01) - 20) < 1e-9);
  assert.ok(priceImpactPercent(parseEther('0.11'), parseEther('10'), 18, 0.01) < 0);
  assert.equal(priceImpactPercent(1n, 10n ** 6n, 6, 0), 0);
});

test('cleanText strips terminal escape codes and bidi tricks from token names', () => {
  assert.equal(cleanText('\u001b[2J\u001b[31mFAKE\u0007', 16), '[2J[31mFAKE');
  assert.equal(cleanText('USD‮C', 16), 'USDC');
  assert.equal(cleanText('  AAPL  ', 16), 'AAPL');
  assert.equal(cleanText('A'.repeat(30), 10), 'AAAAAAAAA…');
});

// Keystore written by ethers v6 (independent implementation) for key 0xabab…ab, password "another pass".
const ETHERS_KEYSTORE = {"address":"e239cdc5fbe977a8a141b72194d3cf8c41bc5bc6","id":"373fdc5d-e2ed-4395-b378-13240d08797f","version":3,"Crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"5271520c8cf26fb2ad13b430f46d7143"},"ciphertext":"e3c5dd112a4ce8aa27c96202e502dfe25ce87274cc39c34e52f0149e621afe78","kdf":"scrypt","kdfparams":{"salt":"892d21e8ff67296f5d38142d0236e3b5c2d9e6e4735961e45559a5b8cf760134","n":131072,"dklen":32,"p":1,"r":8},"mac":"0242fea7086dd4a0549a5f00ecac8cd26dcd448f571b1461f66cc511e71fe642"}};

test('keystore: decrypts a file made by ethers, rejects a wrong password', async () => {
  const ks = ETHERS_KEYSTORE as unknown as KeystoreV3;
  assert.equal(await decryptKey(ks, 'another pass'), '0x' + 'ab'.repeat(32));
  await assert.rejects(decryptKey(ks, 'another pas'), WrongPasswordError);
});

test('keystore: round-trips and never stores the key in plain text', async () => {
  const key = ('0x' + '5c'.repeat(32)) as `0x${string}`;
  const ks = await encryptKey(key, 'correct horse battery');
  assert.ok(!JSON.stringify(ks).includes('5c'.repeat(32)));
  assert.equal(await decryptKey(ks, 'correct horse battery'), key);
  await assert.rejects(decryptKey(ks, 'Correct horse battery'), WrongPasswordError);
});

test('encodePath packs token/fee/token for Uniswap v3', () => {
  const a = getAddress('0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e');
  const b = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73');
  const path = encodePath([a, b], [500]);
  assert.equal(path, `0x${a.slice(2).toLowerCase()}0001f4${b.slice(2).toLowerCase()}`);
  assert.equal((path.length - 2) / 2, 20 + 3 + 20);
});

test('saving a keystore keeps the previous one as a backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    saveKeystore(await encryptKey(('0x' + '01'.repeat(32)) as `0x${string}`, 'first password'));
    saveKeystore(await encryptKey(('0x' + '02'.repeat(32)) as `0x${string}`, 'second password'));
    assert.equal(keystoreBackups().length, 1);
    const backup = JSON.parse(fs.readFileSync(keystoreBackups()[0], 'utf-8'));
    assert.equal(await decryptKey(backup, 'first password'), '0x' + '01'.repeat(32));
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Blockscout: a failed later page keeps earlier results; a rejected key throws', async () => {
  const realFetch = globalThis.fetch;
  const page1 = { items: [{ token: { address_hash: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', type: 'ERC-8056' } }], next_page_params: { id: 1 } };
  try {
    let call = 0;
    globalThis.fetch = (async () => (++call === 1 ? new Response(JSON.stringify(page1)) : new Response('busy', { status: 503 }))) as typeof fetch;
    const partial = await fetchIndexedTokens(4663, 'key', getAddress('0x1111111111111111111111111111111111111111'));
    assert.equal(partial.tokens.length, 1);
    assert.match(partial.error ?? '', /503/);

    globalThis.fetch = (async () => new Response('no', { status: 401 })) as typeof fetch;
    await assert.rejects(fetchIndexedTokens(4663, 'bad', getAddress('0x1111111111111111111111111111111111111111')), BlockscoutKeyError);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('WETH is sold by unwrapping', () => {
  assert.equal(pickRoute(getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'), { usdg: false, treasury: false }), 'UNWRAP');
});

test('terminal style: Windows 11 gets the full style, Windows 10 without WT falls back, override wins', () => {
  assert.equal(detectFancy({}, 'win32', '10.0.22631'), true);
  assert.equal(detectFancy({}, 'win32', '10.0.19045'), false);
  assert.equal(detectFancy({ WT_SESSION: 'x' }, 'win32', '10.0.19045'), true);
  assert.equal(detectFancy({ SWEEPER_PLAIN: '1' }, 'win32', '10.0.22631'), false);
});
