'use strict'

// Branch/edge coverage for the pure core modules — the deterministic logic
// every peer runs. These target the specific rejection and formatting paths
// the happy-path suites don't reach, so the protocol's guards are all proven.

const { test } = require('node:test')
const assert = require('node:assert/strict')

const commit = require('../../src/core/commit')
const invite = require('../../src/core/invite')
const split = require('../../src/core/split')
const selectors = require('../../src/core/selectors')
const { buildCapPolicy } = require('../../src/wallet/policy')
const b4a = require('b4a')

const HEX32 = 'ab'.repeat(32)
const SALT = '0123456789abcdef0123456789abcdef'

// ── commit.js ───────────────────────────────────────────────────────────────

test('commit: verifyReveal returns false on every malformed input', () => {
  const good = { potId: HEX32, writer: HEX32, prediction: { home: 1, away: 0 }, salt: SALT }
  const commitment = commit.commitmentFor(good)
  // sanity: the honest reveal verifies
  assert.equal(commit.verifyReveal({ ...good, commitment }), true)
  // invalid prediction shape
  assert.equal(commit.verifyReveal({ ...good, prediction: { home: -1, away: 0 }, commitment }), false)
  // bad salt (too short / non-hex)
  assert.equal(commit.verifyReveal({ ...good, salt: 'xyz', commitment }), false)
  // bad commitment format (not 32-byte hex)
  assert.equal(commit.verifyReveal({ ...good, commitment: 'deadbeef' }), false)
})

test('commit: verifyReveal swallows a throw from a non-hex potId/writer', () => {
  // valid prediction/salt/commitment format, but potId is not hex → commitmentFor
  // throws inside verifyReveal and the catch returns false (never leaks).
  const commitment = 'cd'.repeat(32)
  assert.equal(
    commit.verifyReveal({ potId: 'not-hex', writer: HEX32, prediction: { home: 2, away: 2 }, salt: SALT, commitment }),
    false
  )
})

test('commit: canonicalPrediction throws and samePrediction guards invalids', () => {
  assert.throws(() => commit.canonicalPrediction({ home: 1 }), /invalid prediction/)
  assert.equal(commit.samePrediction({ home: 1, away: 1 }, { home: 1, away: 1 }), true)
  assert.equal(commit.samePrediction({ home: 1, away: 1 }, { home: 1, away: 2 }), false)
  assert.equal(commit.samePrediction(null, { home: 1, away: 1 }), false)
  assert.equal(commit.isValidPrediction({ home: 0, away: 100 }), false) // > MAX_GOALS (99)
  assert.match(commit.makeSalt(), /^[0-9a-f]{32}$/)
})

test('commit: commitmentFor rejects a short salt', () => {
  assert.throws(() => commit.commitmentFor({ potId: HEX32, writer: HEX32, prediction: { home: 1, away: 0 }, salt: 'aa' }), /salt/)
})

// ── invite.js ─────────────────────────────────────────────────────────────

test('invite: encode accepts a Buffer or a hex string, rejects wrong length', () => {
  const key = b4a.from(HEX32, 'hex')
  const fromBuf = invite.encodeInvite(key)
  const fromHex = invite.encodeInvite(HEX32)
  assert.equal(fromBuf, fromHex)
  assert.ok(fromBuf.startsWith(invite.PREFIX))
  assert.throws(() => invite.encodeInvite(b4a.from('00', 'hex')), /32 bytes/)
})

test('invite: decode round-trips with and without the pear:// prefix', () => {
  const encoded = invite.encodeInvite(HEX32)
  const bare = encoded.slice(invite.PREFIX.length)
  assert.equal(invite.decodeInvite(encoded), HEX32)
  assert.equal(invite.decodeInvite(bare), HEX32)
  assert.equal(invite.decodeInvite('  ' + encoded + '  '), HEX32) // trims
})

test('invite: decode rejects non-strings and wrong-length payloads', () => {
  assert.throws(() => invite.decodeInvite(42), /must be a string/)
  const shortZ32 = invite.PREFIX + require('z32').encode(b4a.from('0011', 'hex'))
  assert.throws(() => invite.decodeInvite(shortZ32), /invalid invite/)
})

test('invite: topicFor requires a 32-byte hex key', () => {
  assert.ok(b4a.isBuffer(invite.topicFor(HEX32)))
  assert.throws(() => invite.topicFor('short'), /invalid bootstrap key/)
})

// ── split.js ────────────────────────────────────────────────────────────────

test('split: formatUnits handles negatives, whole numbers and trailing zeros', () => {
  assert.equal(split.formatUnits(1500000n), '1.5')
  assert.equal(split.formatUnits(2000000n), '2')
  assert.equal(split.formatUnits(-1500000n), '-1.5')
  assert.equal(split.formatUnits('1000000'), '1')
})

test('split: parseUnits rejects invalid and over-precise strings', () => {
  assert.equal(split.parseUnits('1.5'), 1500000n)
  assert.equal(split.parseUnits('7'), 7000000n)
  assert.throws(() => split.parseUnits('abc'), /invalid decimal/)
  assert.throws(() => split.parseUnits('1.1234567'), /too many decimal/)
})

test('split: dividePool guards its inputs and distributes the remainder', () => {
  assert.throws(() => split.dividePool(-1n, ['a']), /non-negative bigint/)
  assert.throws(() => split.dividePool('5', ['a']), /non-negative bigint/)
  assert.throws(() => split.dividePool(5n, []), /non-empty/)
  const out = split.dividePool(10n, ['bb', 'aa', 'cc']) // 10 / 3 = 3 r1 → lowest key +1
  assert.equal(out.get('aa'), 4n)
  assert.equal(out.get('bb'), 3n)
  assert.equal(out.get('cc'), 3n)
})

test('split: computeSplit covers none, refund and win; verifyAccounting holds', () => {
  assert.equal(split.computeSplit({ stakes: {}, winners: [] }).mode, 'none')
  const stakes = { aa: { amount: '10' }, bb: { amount: '10' } }
  const refund = split.computeSplit({ stakes, winners: [] })
  assert.equal(refund.mode, 'refund')
  assert.equal(split.verifyAccounting(refund), true)
  const win = split.computeSplit({ stakes, winners: ['aa'] })
  assert.equal(win.mode, 'win')
  assert.equal(win.entries.get('aa'), 20n)
  assert.equal(split.verifyAccounting(win), true)
  assert.throws(() => split.computeSplit({ stakes: { aa: { amount: 'nope' } }, winners: [] }), /invalid stake/)
  assert.equal(split.isAmountString('0'), false)
  assert.equal(split.isAmountString(10), false)
})

// ── selectors.js ─────────────────────────────────────────────────────────────

test('selectors: statusOf covers no-pot, open, locked, resolved and settled', () => {
  assert.equal(selectors.statusOf({ }), 'no-pot')
  const base = { pot: { kickoffTs: 1000 }, status: 'open' }
  assert.equal(selectors.statusOf(base, 500), 'open')
  assert.equal(selectors.statusOf(base, 2000), 'locked')
  assert.equal(selectors.statusOf({ pot: { kickoffTs: 1000 }, status: 'resolved' }, 2000), 'resolved')
  assert.equal(selectors.statusOf({ pot: { kickoffTs: 1000 }, status: 'settled' }, 2000), 'settled')
})

test('selectors: summarize short-circuits when there is no pot', () => {
  assert.deepEqual(selectors.summarize({}), { status: 'no-pot' })
})

test('selectors: lenient witness rule skips the cross-witness requirement', () => {
  const writer = HEX32
  const state = {
    pot: { witnessRule: 'lenient', kickoffTs: 0 },
    writers: { [writer]: { name: 'a' } },
    stakes: { [writer]: { amount: '10' } },
    commits: { [writer]: { seq: 1 } },
    snapshots: {},
    reveals: { [writer]: { prediction: { home: 1, away: 0 } } },
    votes: {},
    payouts: {},
    result: null,
    log: []
  }
  const e = selectors.eligibility(state, writer)
  assert.equal(e.witnessed, true) // lenient → witnessed without any snapshot
  assert.equal(e.valid, true)
  // strict (default) would NOT be witnessed with no snapshot
  const strict = selectors.eligibility({ ...state, pot: { kickoffTs: 0 } }, writer)
  assert.equal(strict.witnessed, false)
  // isWitnessed with no commit is false
  assert.equal(selectors.isWitnessed(state, 'ff'.repeat(32)), false)
})

// ── policy.js (the cap condition's nullish-amount branch) ────────────────────

test('policy: cap condition treats a missing amount as zero (never denies)', () => {
  const rule = buildCapPolicy('100').rules[1]
  assert.equal(rule.conditions[0]({}), false) // no params → amount ?? 0
  assert.equal(rule.conditions[0]({ params: {} }), false) // params, no amount
  assert.equal(rule.conditions[0]({ params: { amount: 101n } }), true)
})
