import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Address, encodeFunctionData, getAddress, Hex, pad, parseEther, TransactionSerialized } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ACROSS, BRIDGE_ROUTES, BridgeRoute } from '../src/constants.js';
import { AcrossQuote, BridgeError, PERIPHERY_ABI, PlannedTx, agreedPrice, signedMismatch, usdToWei, verifyQuote } from '../src/bridge/across.js';
import { bridgeFee, checkRecipient, isStale, priorityFeeFor, trackDeposit, BridgeQuote } from '../src/actions/bridge.js';
import { formatEthShort } from '../src/ui/format.js';
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
const ROUTES: [string, BridgeRoute][] = [['Robinhood -> Ethereum', BRIDGE_ROUTES.toEthereum], ['Ethereum -> Robinhood', BRIDGE_ROUTES.toRobinhood]];
const goodFor = (route: BridgeRoute): Args => ({
  spokePool: route.from.spokePool, depositor: FROM, recipient: TO, inputToken: route.from.weth, inputAmount: AMOUNT,
  outputToken: route.to.weth, outputAmount: OUT, destId: BigInt(route.to.id), fillDeadline: NOW / 1000 + 3600, message: '0x',
});

function quote(route: BridgeRoute, args: Partial<Args> = {}, top: Partial<AcrossQuote> = {}, tx: Partial<AcrossQuote['swapTx']> = {}): AcrossQuote {
  const a = { ...goodFor(route), ...args };
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
    swapTx: { chainId: route.from.id, to: ACROSS.PERIPHERY, data, value: AMOUNT.toString(), gas: 150_000, simulationSuccess: true, ...tx },
    ...top,
  };
}

for (const [name, route] of ROUTES) {
const verify = (q: AcrossQuote, recipient = TO) => verifyQuote(route, q, AMOUNT, FROM, recipient, NOW);
const other = route === BRIDGE_ROUTES.toEthereum ? BRIDGE_ROUTES.toRobinhood : BRIDGE_ROUTES.toEthereum;

test(`bridge ${name}: a correct Across deposit passes and returns the guarantee`, () => {
  const { guaranteed, gasLimit } = verify(quote(route));
  assert.equal(guaranteed, OUT);
  assert.equal(gasLimit, 195_000n);
});

test(`bridge ${name}: a deposit built for the other direction is refused`, () => {
  assert.throws(() => verify(quote(other)), BridgeError);
});

test(`bridge ${name}: every tampered quote is refused before signing`, () => {
  const quoteR = (args: Partial<Args> = {}, top: Partial<AcrossQuote> = {}, tx: Partial<AcrossQuote['swapTx']> = {}) => quote(route, args, top, tx);
  const cases: [string, AcrossQuote][] = [
    ['other contract', quoteR({}, {}, { to: OTHER })],
    ['other chain', quoteR({}, {}, { chainId: 10 })],
    ['other value', quoteR({}, {}, { value: (AMOUNT + 1n).toString() })],
    ['failed simulation', quoteR({}, {}, { simulationSuccess: false })],
    ['too much gas', quoteR({}, {}, { gas: '400000' })],
    ['not a deposit', quoteR({}, {}, { data: '0xdeadbeef' })],
    ['approvals', quoteR({}, { approvalTxns: [{}] })],
    ['route type', quoteR({}, { crossSwapType: 'anyToBridgeable' })],
    ['expired', quoteR({}, { quoteExpiryTimestamp: NOW / 1000 + 30 })],
    ['no expiry', quoteR({}, { quoteExpiryTimestamp: Number.NaN })],
    ['spoke pool', quoteR({ spokePool: OTHER })],
    ['depositor', quoteR({ depositor: OTHER })],
    ['recipient', quoteR({ recipient: OTHER })],
    ['input token', quoteR({ inputToken: OTHER })],
    ['input amount', quoteR({ inputAmount: AMOUNT - 1n })],
    ['output token', quoteR({ outputToken: OTHER })],
    ['output below guarantee', quoteR({ outputAmount: OUT - 1n })],
    ['destination chain', quoteR({ destId: 10n })],
    ['same chain', quoteR({ destId: BigInt(route.from.id) })],
    ['extra message', quoteR({ message: '0x1234' })],
    ['deadline too close', quoteR({ fillDeadline: NOW / 1000 + 60 })],
  ];
  for (const [what, q] of cases) assert.throws(() => verify(q), BridgeError, what);
  // Recipient mismatch from the user's side (quote is fine, user asked for someone else).
  assert.throws(() => verify(quoteR(), OTHER), BridgeError);
  // Pays out more than goes in: the quote is wrong.
  assert.throws(() => verify(quoteR({ outputAmount: AMOUNT }, { minOutputAmount: AMOUNT.toString() })), BridgeError);
});
}

test('bridge: the signed transaction must match the checked plan exactly', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const plan: PlannedTx = { to: ACROSS.PERIPHERY, data: '0x609ea081ff', value: AMOUNT, gasLimit: 195_000n, maxFee: 40_000_000n, priorityFee: 0n };
  const sign = (p: PlannedTx, extra: Record<string, unknown> = {}) =>
    account.signTransaction({ chainId: 4663, type: 'eip1559', to: p.to, data: p.data, value: p.value, gas: p.gasLimit, maxFeePerGas: p.maxFee, maxPriorityFeePerGas: p.priorityFee, nonce: 7, ...extra } as never) as Promise<TransactionSerialized>;
  const signed = await sign(plan);
  assert.equal(await signedMismatch(signed, plan, account.address, 4663), undefined);
  const changed: [string, PlannedTx, Address][] = [
    ['to', { ...plan, to: OTHER }, account.address],
    ['value', { ...plan, value: plan.value + 1n }, account.address],
    ['calldata', { ...plan, data: '0x609ea081fe' }, account.address],
    ['gas', { ...plan, gasLimit: plan.gasLimit + 1n }, account.address],
    ['fee', { ...plan, maxFee: plan.maxFee + 1n }, account.address],
    ['signer', plan, OTHER],
  ];
  for (const [what, p, from] of changed) {
    const m = await signedMismatch(signed, p, from, 4663);
    assert.ok(m && m.startsWith(what), `${what} change not caught (got ${m})`);
  }
  assert.match((await signedMismatch(await sign(plan, { chainId: 1 }), plan, account.address, 4663)) ?? '', /^chain/);
  assert.match((await signedMismatch(await sign(plan, { maxPriorityFeePerGas: 1n }), plan, account.address, 4663)) ?? '', /^priority fee/);
  // Ethereum: the planned tip is part of the plan, on chain 1.
  const eth: PlannedTx = { ...plan, maxFee: 300_000_000n, priorityFee: 50_000_000n };
  const ethSigned = await sign(eth, { chainId: 1 });
  assert.equal(await signedMismatch(ethSigned, eth, account.address, 1), undefined);
  assert.match((await signedMismatch(ethSigned, { ...eth, priorityFee: 0n }, account.address, 1)) ?? '', /^priority fee/);
  assert.match((await signedMismatch(ethSigned, eth, account.address, 4663)) ?? '', /^chain/);
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
  assert.deepEqual(bridgeFee(0n), { maxFee: 20_000_000n, priorityFee: 0n, reserve: 400_000n * 20_000_000n });
  assert.equal(bridgeFee(50_000_000n).maxFee, 100_000_000n);
  // The tip is paid on top of the base-fee allowance.
  assert.equal(bridgeFee(100_000_000n, 50_000_000n).maxFee, 250_000_000n);
  // Ethereum gets 3x headroom on the base fee (it can rise ~12.5% a block before inclusion).
  assert.equal(bridgeFee(100_000_000n, 50_000_000n, 3n).maxFee, 350_000_000n);
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

test('bridge: recipient must be a normal wallet on the destination chain', async () => {
  const code = (c: Hex | undefined) => ({ getCode: async () => c });
  await checkRecipient(code(undefined), 'Ethereum', TO);
  await checkRecipient(code('0x'), 'Ethereum', TO);
  await checkRecipient(code('0xef01001234567890123456789012345678901234567890'), 'Ethereum', TO); // EIP-7702 wallet
  await assert.rejects(checkRecipient(code('0x6080604052'), 'Robinhood Chain', TO), /smart contract on Robinhood Chain/);
  await assert.rejects(checkRecipient({ getCode: async () => { throw new Error('down'); } }, 'Ethereum', TO), BridgeError);
});

test('bridge: no tip on Robinhood Chain; on Ethereum the suggested tip, kept within bounds', async () => {
  const suggest = (tip: bigint | Error) => ({ estimateMaxPriorityFeePerGas: async () => { if (tip instanceof Error) throw tip; return tip; } });
  assert.equal(await priorityFeeFor(BRIDGE_ROUTES.toEthereum, suggest(5_000_000_000n)), 0n);
  assert.equal(await priorityFeeFor(BRIDGE_ROUTES.toRobinhood, suggest(100_000_000n)), 100_000_000n);
  assert.equal(await priorityFeeFor(BRIDGE_ROUTES.toRobinhood, suggest(1n)), 50_000_000n);
  assert.equal(await priorityFeeFor(BRIDGE_ROUTES.toRobinhood, suggest(90_000_000_000n)), 2_000_000_000n);
  assert.equal(await priorityFeeFor(BRIDGE_ROUTES.toRobinhood, suggest(new Error('down'))), 50_000_000n);
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
