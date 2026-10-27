// Bridge signing test on a LOCAL fork of Robinhood Chain, with a THROWAWAY key. Not part of `npm test`.
//   anvil --fork-url https://robinhood-rpc.publicnode.com --chain-id 4663 --port 8549
//   FORK_RPC=http://127.0.0.1:8549 node --import tsx test/bridge-fork.ts
// Takes a real Across quote, checks it with the tool's own checks, then signs with viem, sends the deposit
// on the fork and confirms Across's real spoke pool accepted it. Only the fork's clients are used, so
// nothing can reach the real network. Across cannot simulate a deposit from an empty address, so only
// its simulationSuccess/gas fields are filled in locally; every other check runs on the real quote.
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, defineChain, http, isAddressEqual, parseEther, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ACROSS } from '../src/constants.js';
import { fetchAcrossQuote, verifyQuote } from '../src/bridge/across.js';
import { bridgeFee, BridgeQuote, sendBridge } from '../src/actions/bridge.js';

const RPC = process.env.FORK_RPC ?? '';
assert.match(RPC, /^http:\/\/127\.0\.0\.1:\d+$/, 'FORK_RPC must be a local anvil fork');
const chain = defineChain({ id: 4663, name: 'fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const publicClient = createPublicClient({ chain, transport: http(RPC) });
assert.equal(await publicClient.getChainId(), 4663);
const account = privateKeyToAccount(generatePrivateKey());
const walletClient = createWalletClient({ account, chain, transport: http(RPC) });
await publicClient.request({ method: 'anvil_setBalance' as never, params: [account.address, toHex(parseEther('1'))] as never });

const amount = parseEther('0.01');
const q = await fetchAcrossQuote(amount, account.address, account.address);
const gas = await publicClient.estimateGas({ account: account.address, to: q.swapTx.to, data: q.swapTx.data, value: amount });
const patched = { ...q, swapTx: { ...q.swapTx, simulationSuccess: true, gas: gas.toString() } };
const { guaranteed, gasLimit } = verifyQuote(patched, amount, account.address, account.address);
console.log(`real quote checked: ${amount} in, ${guaranteed} guaranteed, gas ${gas}`);

const block = await publicClient.getBlock();
const { maxFee } = bridgeFee(block.baseFeePerGas ?? 0n);
const before = await publicClient.getBalance({ address: account.address });
const quote: BridgeQuote = {
  amount, recipient: account.address, guaranteed, expected: BigInt(q.expectedOutputAmount), gasUsd: 0, fillSeconds: 0,
  competitors: [], quotedAt: Date.now(), expiresAt: q.quoteExpiryTimestamp * 1000,
  planned: { to: q.swapTx.to, data: q.swapTx.data, value: amount, gasLimit, maxFee },
};
const native = { kind: 'native' as const, symbol: 'ETH', name: 'Ether', decimals: 18, balance: before };
const ctx = { publicClient, walletClient, owner: account.address, dryRun: false } as never;

const practice = await sendBridge({ ...(ctx as object), dryRun: true } as never, native, quote);
assert.equal(practice.status, 'simulated');
assert.equal(await publicClient.getBalance({ address: account.address }), before, 'practice mode sent nothing');

const result = await sendBridge(ctx, native, quote);
assert.equal(result.status, 'success', result.message);
const receipt = await publicClient.getTransactionReceipt({ hash: result.txHash! });
assert.equal(receipt.status, 'success');
assert.ok(receipt.logs.some((l) => isAddressEqual(l.address, ACROSS.SPOKE_POOL)), 'the Across spoke pool logged the deposit');
const after = await publicClient.getBalance({ address: account.address });
assert.ok(before - after >= amount && before - after <= amount + gasLimit * maxFee, 'exactly the amount plus gas left the wallet');

// A stale quote is refused without signing.
const stale = await sendBridge(ctx, native, { ...quote, quotedAt: Date.now() - 120_000 });
assert.equal(stale.status, 'failed');
assert.equal(await publicClient.getBalance({ address: account.address }), after, 'stale quote sent nothing');
console.log(`ok: deposit ${result.txHash} accepted by the Across spoke pool on the fork; practice and stale quotes sent nothing`);
