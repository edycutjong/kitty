'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isAmountString, dividePool, computeSplit, verifyAccounting, formatUnits, parseUnits } = require('../../src/core/split')

test('isAmountString accepts positive integer strings only', () => {
  assert.ok(isAmountString('1'))
  assert.ok(isAmountString('20000000'))
  assert.equal(isAmountString('0'), false)
  assert.equal(isAmountString('-5'), false)
  assert.equal(isAmountString('1.5'), false)
  assert.equal(isAmountString('1e6'), false)
  assert.equal(isAmountString(20), false)
  assert.equal(isAmountString(''), false)
})

test('dividePool splits evenly when divisible', () => {
  const out = dividePool(60n, ['aa', 'bb', 'cc'])
  assert.equal(out.get('aa'), 20n)
  assert.equal(out.get('bb'), 20n)
  assert.equal(out.get('cc'), 20n)
})

test('dividePool gives the remainder to the lowest keys, one unit each', () => {
  const out = dividePool(61n, ['cc', 'aa', 'bb'])
  assert.equal(out.get('aa'), 21n)
  assert.equal(out.get('bb'), 20n)
  assert.equal(out.get('cc'), 20n)
})

test('dividePool result is independent of input order', () => {
  const a = dividePool(100n, ['x1', 'x2', 'x3'])
  const b = dividePool(100n, ['x3', 'x1', 'x2'])
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort())
})

test('dividePool total always equals the pool (Σ==Σ)', () => {
  for (const [pool, n] of [[100n, 3], [7n, 5], [1n, 1], [999999999999n, 7]]) {
    const winners = Array.from({ length: n }, (_, i) => `w${i}`)
    const out = dividePool(pool, winners)
    let sum = 0n
    for (const v of out.values()) sum += v
    assert.equal(sum, pool)
  }
})

test('dividePool single winner takes all', () => {
  const out = dividePool(12345n, ['solo'])
  assert.equal(out.get('solo'), 12345n)
})

test('dividePool rejects bad inputs', () => {
  assert.throws(() => dividePool(10, ['a']))
  assert.throws(() => dividePool(-1n, ['a']))
  assert.throws(() => dividePool(10n, []))
})

test('computeSplit win mode divides pool among winners', () => {
  const stakes = { a: { amount: '10' }, b: { amount: '10' }, c: { amount: '10' } }
  const s = computeSplit({ stakes, winners: ['b'] })
  assert.equal(s.mode, 'win')
  assert.equal(s.pool, 30n)
  assert.equal(s.entries.get('b'), 30n)
})

test('computeSplit refund mode returns every stake exactly', () => {
  const stakes = { a: { amount: '10' }, b: { amount: '10' } }
  const s = computeSplit({ stakes, winners: [] })
  assert.equal(s.mode, 'refund')
  assert.equal(s.entries.get('a'), 10n)
  assert.equal(s.entries.get('b'), 10n)
})

test('computeSplit none mode when nothing staked', () => {
  const s = computeSplit({ stakes: {}, winners: [] })
  assert.equal(s.mode, 'none')
  assert.equal(s.pool, 0n)
})

test('computeSplit throws on malformed stake amounts', () => {
  assert.throws(() => computeSplit({ stakes: { a: { amount: '1.5' } }, winners: [] }))
})

test('verifyAccounting holds for win and refund splits', () => {
  const stakes = { a: { amount: '7' }, b: { amount: '7' }, c: { amount: '7' } }
  assert.ok(verifyAccounting(computeSplit({ stakes, winners: ['a', 'c'] })))
  assert.ok(verifyAccounting(computeSplit({ stakes, winners: [] })))
})

test('formatUnits renders 6-decimal USD₮ base units', () => {
  assert.equal(formatUnits(20000000n), '20')
  assert.equal(formatUnits(20500000n), '20.5')
  assert.equal(formatUnits(1n), '0.000001')
  assert.equal(formatUnits(0n), '0')
})

test('formatUnits handles string input and negatives', () => {
  assert.equal(formatUnits('1500000'), '1.5')
  assert.equal(formatUnits(-1500000n), '-1.5')
})

test('parseUnits parses whole and fractional amounts', () => {
  assert.equal(parseUnits('20'), 20000000n)
  assert.equal(parseUnits('20.5'), 20500000n)
  assert.equal(parseUnits('0.000001'), 1n)
})

test('parseUnits ↔ formatUnits round-trips', () => {
  for (const v of ['1', '20.5', '0.000001', '123456.654321']) {
    assert.equal(formatUnits(parseUnits(v)), v)
  }
})

test('parseUnits rejects junk and excess precision', () => {
  assert.throws(() => parseUnits('1.2345678'))
  assert.throws(() => parseUnits('abc'))
  assert.throws(() => parseUnits('-5'))
  assert.throws(() => parseUnits(''))
})
