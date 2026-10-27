import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Address, encodeFunctionData, getAddress, Hex, pad, parseEther, TransactionSerialized } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ACROSS, UNISWAP_V3 } from '../src/constants.js';
import { AcrossQuote, BridgeError, PERIPHERY_ABI, PlannedTx, agreedPrice, signedMismatch, usdToWei, verifyQuote } from '../src/bridge/across.js';
import { bridgeFee, checkEthereumRecipient, formatEthShort, isStale, trackDeposit, BridgeQuote } from '../src/actions/bridge.js';
import { comparisonRows } from '../src/ui/bridgeScreens.js';
import { parseCli } from '../src/config.js';

const FROM = getAddress('0x1111111111111111111111111111111111111111');
const TO = getAddress('0x2222222222222222222222222222222222222222');
const OTHER = getAddress('0x000000000000000000000000000000000000dEaD');
const NOW = 1_800_000_000_000;
const AMOUNT = parseEther('0.05');
const OUT = parseEther('0.0499');

type Args = {
  spokePool: Address; depositor: Address; recipient: Address; inputToken: Address; inputAmount: bigint;
  outputToken: Address; outputAmount: bigint; destId: bigint; fillDeadline: number; message: Hex;
};
const good: Args = {
  spokePool: ACROSS.SPOKE_POOL, depositor: FROM, recipient: TO, inputToken: UNISWAP_V3.WETH, inputAmount: AMOUNT,
  outputToken: ACROSS.MAINNET_WETH, outputAmount: OUT, destId: 1n, fillDeadline: NOW / 1000 + 3600, message: '0x',
};

function quote(args: Partial<Args> = {}, top: Partial<AcrossQuote> = {}, tx: Partial<AcrossQuote['swapTx']> = {}): AcrossQuote {
  const a = { ...good, ...args };
  const data = encodeFunctionData({
    abi: PERIPHERY_ABI,
    functionName: 'depositNative',
    args: [a.spokePool, a.depositor, pad(a.recipient), a.inputToken, a.inputAmount, pad(a.outputToken), a.outputAmount, a.destId, pad('0x00'), NOW / 1000, a.fillDeadline, 0, a.message],
  });
  return {
    crossSwapType: 'bridgeableToBridgeable',
    approvalTxns: [],
    expectedOutputAmount: OUT.toString(),
    minOutputAmount: OUT.toString(),
    expectedFillTime: 2,
    quoteExpiryTimestamp: NOW / 1000 + 300,
    fees: { total: { amountUsd: '0.1' }, originGas: { amountUsd: '0.01' } },
    swapTx: { chainId: 4663, to: ACROSS.PERIPHERY, data, value: AMOUNT.toString(), gas: 150_000, simulationSuccess: true, ...tx },
    ...top,
  };
}

const verify = (q: AcrossQuote, recipient = TO) => verifyQuote(q, AMOUNT, FROM, recipient, NOW);

test('bridge: a correct Across deposit passes and returns the guarantee', () => {
  const { guaranteed, gasLimit } = verify(quote());
  assert.equal(guaranteed, OUT);
  assert.equal(gasLimit, 195_000n);
});

test('bridge: every tampered quote is refused before signing', () => {
  const cases: [string, AcrossQuote][] = [
    ['other contract', quote({}, {}, { to: OTHER })],
    ['other chain', quote({}, {}, { chainId: 1 })],
    ['other value', quote({}, {}, { value: (AMOUNT + 1n).toString() })],
    ['failed simulation', quote({}, {}, { simulationSuccess: false })],
    ['too much gas', quote({}, {}, { gas: '400000' })],
    ['not a deposit', quote({}, {}, { data: '0xdeadbeef' })],
    ['approvals', quote({}, { approvalTxns: [{}] })],
    ['route type', quote({}, { crossSwapType: 'anyToBridgeable' })],
    ['expired', quote({}, { quoteExpiryTimestamp: NOW / 1000 + 30 })],
    ['no expiry', quote({}, { quoteExpiryTimestamp: Number.NaN })],
    ['spoke pool', quote({ spokePool: OTHER })],
    ['depositor', quote({ depositor: OTHER })],
    ['recipient', quote({ recipient: OTHER })],
    ['input token', quote({ inputToken: OTHER })],
    ['input amount', quote({ inputAmount: AMOUNT - 1n })],
    ['output token', quote({ outputToken: OTHER })],
    ['output below guarantee', quote({ outputAmount: OUT - 1n })],
    ['destination chain', quote({ destId: 10n })],
    ['extra message', quote({ message: '0x1234' })],
    ['deadline too close', quote({ fillDeadline: NOW / 1000 + 60 })],
  ];
  for (const [what, q] of cases) assert.throws(() => verify(q), BridgeError, what);
  // Recipient mismatch from the user's side (quote is fine, user asked for someone else).
  assert.throws(() => verify(quote(), OTHER), BridgeError);
  // Pays out more than goes in: the quote is wrong.
  assert.throws(() => verify(quote({ outputAmount: AMOUNT }, { minOutputAmount: AMOUNT.toString() })), BridgeError);
});

test('bridge: the signed transaction must match the checked plan exactly', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const plan: PlannedTx = { to: ACROSS.PERIPHERY, data: '0x609ea081ff', value: AMOUNT, gasLimit: 195_000n, maxFee: 40_000_000n };
  const sign = (p: PlannedTx, extra: Record<string, unknown> = {}) =>
    account.signTransaction({ chainId: 4663, type: 'eip1559', to: p.to, data: p.data, value: p.value, gas: p.gasLimit, maxFeePerGas: p.maxFee, maxPriorityFeePerGas: 0n, nonce: 7, ...extra } as never) as Promise<TransactionSerialized>;
  const signed = await sign(plan);
  assert.equal(await signedMismatch(signed, plan, account.address), undefined);
  const changed: [string, PlannedTx, Address][] = [
    ['to', { ...plan, to: OTHER }, account.address],
    ['value', { ...plan, value: plan.value + 1n }, account.address],
    ['calldata', { ...plan, data: '0x609ea081fe' }, account.address],
    ['gas', { ...plan, gasLimit: plan.gasLimit + 1n }, account.address],
    ['fee', { ...plan, maxFee: plan.maxFee + 1n }, account.address],
    ['signer', plan, OTHER],
  ];
  for (const [what, p, from] of changed) {
    const m = await signedMismatch(signed, p, from);
    assert.ok(m && m.startsWith(what), `${what} change not caught (got ${m})`);
  }
  assert.match((await signedMismatch(await sign(plan, { chainId: 1 }), plan, account.address)) ?? '', /^chain/);
  assert.match((await signedMismatch(await sign(plan, { maxPriorityFeePerGas: 1n }), plan, account.address)) ?? '', /^priority fee/);
});

test('bridge: dollar amounts need two prices that agree', () => {
  assert.deepEqual(agreedPrice([2500, 2510]), { usd: 2500, sources: 2 });
  assert.equal(agreedPrice([2500, 2600]), undefined);
  assert.deepEqual(agreedPrice([2500]), { usd: 2500, sources: 1 });
  assert.equal(agreedPrice([]), undefined);
  assert.equal(usdToWei('125', 2500), parseEther('0.05'));
  // Rounded down, never up.
  assert.ok(usdToWei('100', 3000) <= parseEther('0.0333333333333333334'));
});

test('bridge: fee reserve, staleness and display rounding', () => {
  assert.deepEqual(bridgeFee(0n), { maxFee: 20_000_000n, reserve: 400_000n * 20_000_000n });
  assert.equal(bridgeFee(50_000_000n).maxFee, 100_000_000n);
  const q = { quotedAt: NOW, expiresAt: NOW + 300_000 } as BridgeQuote;
  assert.equal(isStale(q, NOW + 60_000), false);
  assert.equal(isStale(q, NOW + 91_000), true);
  assert.equal(isStale({ ...q, expiresAt: NOW + 40_000 }, NOW + 20_000), true);
  assert.equal(formatEthShort(parseEther('0.0123456789')), '0.01234');
  assert.equal(formatEthShort(parseEther('0.0123456789'), 'up'), '0.01235');
  assert.equal(formatEthShort(parseEther('2')), '2.00000');
});

test('bridge: comparison keeps Across even when five others beat it', () => {
  const others = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ name, out: 100n + BigInt(i) }));
  const rows = comparisonRows(50n, others);
  assert.equal(rows.length, 5);
  assert.ok(rows.some((r) => r.name.startsWith('Across')));
  assert.equal(comparisonRows(200n, others)[0].name.startsWith('Across'), true);
});

test('bridge: recipient must be a normal wallet on Ethereum', async () => {
  const code = (c: Hex | undefined) => ({ getCode: async () => c });
  await checkEthereumRecipient(code(undefined), TO);
  await checkEthereumRecipient(code('0x'), TO);
  await checkEthereumRecipient(code('0xef01001234567890123456789012345678901234567890'), TO); // EIP-7702 wallet
  await assert.rejects(checkEthereumRecipient(code('0x6080604052'), TO), BridgeError);
  await assert.rejects(checkEthereumRecipient({ getCode: async () => { throw new Error('down'); } }, TO), BridgeError);
});

test('bridge: tracking follows a deposit to its fill, refund or timeout', async () => {
  const seq = (...answers: (() => unknown)[]) => {
    let i = 0;
    return async () => answers[Math.min(i++, answers.length - 1)]() as never;
  };
  const statuses: string[] = [];
  const filled = await trackDeposit('0xabc', (t) => statuses.push(t), 1_000, 1, seq(
    () => { throw new Error('404'); },
    () => ({ status: 'pending', detail: 'pending' }),
    () => ({ status: 'filled', fillHash: '0xfill' }),
  ));
  assert.equal(filled.status, 'filled');
  assert.equal(statuses.length, 2);
  assert.deepEqual(await trackDeposit('0xabc', () => {}, 1_000, 1, seq(() => ({ status: 'refunded' }))), { status: 'refunded' });
  assert.deepEqual(await trackDeposit('0xabc', () => {}, 20, 5, seq(() => ({ status: 'pending', detail: 'slow' }))), { status: 'timeout' });
  // Never seen by Across at all: a wrong hash, reported as such rather than "still on its way".
  assert.deepEqual(await trackDeposit('0xabc', () => {}, 20, 5, seq(() => ({ status: 'unknown' }))), { status: 'unknown' });
  // Seen once, then the lookups fail: still on its way.
  assert.deepEqual(
    await trackDeposit('0xabc', () => {}, 20, 5, seq(() => ({ status: 'pending', detail: 'pending' }), () => { throw new Error('down'); })),
    { status: 'timeout' }
  );
});

test('bridge: --track takes a transaction hash only', () => {
  const hash = `0x${'ab'.repeat(32)}`;
  assert.equal(parseCli(['--track', hash]).track, hash);
  assert.equal(parseCli([]).track, undefined);
  assert.throws(() => parseCli(['--track', '0x1234']));
});
