'use strict'

// Branch coverage for the reducer + selectors edge paths the happy-path suites
// don't reach: every validator's early guard, explicit-quorum, the summarize
// fallbacks, and the split/settlement pending arms. All via direct applyOp /
// pure calls — no network, no money.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createState, applyOp, quorumFor } = require('../../src/core/reduce')
const { OP } = require('../../src/core/constants')
const { TestPot, playedPot, writerKey } = require('../helpers')
const selectors = require('../../src/core/selectors')
const split = require('../../src/core/split')
const commit = require('../../src/core/commit')

const W = writerKey(0)
const STRANGER = 'ee'.repeat(32)

// ── barrels (pure re-export modules) ─────────────────────────────────────────

test('barrel modules re-export their members', () => {
  assert.ok(require('../../src/core').reduce)
  assert.ok(require('../../src/p2p').KittyNode)
  assert.ok(require('../../src/wallet').KittyWallet)
})

// ── reducer: shape + no-pot guards + summarize fallbacks ─────────────────────

test('reduce: a null/garbage/unknown op is rejected and summarized as invalid', () => {
  const s = createState()
  const r = applyOp(s, null, { writer: W, seq: 1 })
  assert.equal(r.accepted, false)
  assert.equal(s.log[0].summary, 'invalid')
  assert.equal(applyOp(s, { type: 'nope', ts: 1 }, { writer: W, seq: 2 }).accepted, false)
})

test('reduce: every op type rejects on a pot-less state', () => {
  for (const type of [OP.ADD_WRITER, OP.STAKE, OP.COMMIT_PICK, OP.KICKOFF_SNAPSHOT, OP.REVEAL_PICK, OP.RESULT_VOTE, OP.PAYOUT]) {
    const s = createState()
    assert.equal(applyOp(s, { type, ts: 1 }, { writer: W, seq: 1 }).accepted, false)
  }
})

test('reduce: ops from a non-member writer are rejected (vote + payout)', () => {
  const { pot } = playedPot()
  assert.equal(pot.apply(STRANGER, { type: OP.RESULT_VOTE, score: { home: 1, away: 0 }, ts: 1780000060000 }).accepted, false)
  // payout not-writer needs finality first
  pot.vote(writerKey(0), { home: 2, away: 1 })
  pot.vote(writerKey(1), { home: 2, away: 1 })
  assert.ok(pot.state.result)
  assert.equal(pot.apply(STRANGER, { type: OP.PAYOUT, transfers: [{ to: writerKey(0), amount: '1', txid: 'SIMTX' }], ts: 1780000080000 }).accepted, false)
})

test('reduce: summarizeOp handles ops missing their payload', () => {
  const { pot, A } = playedPot()
  pot.apply(A, { type: OP.REVEAL_PICK, salt: 'x', ts: 1 }) // no prediction → "revealed"
  pot.apply(A, { type: OP.RESULT_VOTE, ts: 1 }) // no score → "voted"
  pot.apply(A, { type: OP.PAYOUT, ts: 1 }) // no transfers → "settled 0 transfer(s)"
  const summaries = pot.state.log.map(l => l.summary)
  assert.ok(summaries.includes('revealed'))
  assert.ok(summaries.includes('voted'))
  assert.ok(summaries.some(s => /settled 0 transfer/.test(s)))
})

test('reduce: an explicit pot quorum overrides the default majority', () => {
  const A = writerKey(0)
  const pot = new TestPot()
  pot.open(A, { quorum: 2 })
  pot.addWriter(A, writerKey(1), 'b')
  pot.addWriter(A, writerKey(2), 'c')
  pot.stake(A); pot.stake(writerKey(1)); pot.stake(writerKey(2))
  assert.equal(quorumFor(pot.state), 2) // explicit 2, not floor(3/2)+1 = 2 either — capped to staked
  // explicit quorum capped to staker count
  const solo = new TestPot()
  solo.open(A, { quorum: 5 })
  solo.stake(A)
  assert.equal(quorumFor(solo.state), 1)
})

// ── selectors: pending arms + waterfall skip ─────────────────────────────────

test('selectors: computeSplit + settlementPlan report pending before a result', () => {
  const { pot } = playedPot()
  assert.equal(selectors.computeSplit(pot.state).mode, 'pending')
  assert.equal(selectors.settlementPlan(pot.state).mode, 'pending')
})

test('selectors: a single winner collects from every loser (waterfall advances)', () => {
  const picks = { 0: { home: 2, away: 1 }, 1: { home: 0, away: 0 }, 2: { home: 1, away: 1 } }
  const { pot } = playedPot(picks)
  pot.vote(writerKey(0), { home: 2, away: 1 })
  pot.vote(writerKey(1), { home: 2, away: 1 })
  const plan = selectors.settlementPlan(pot.state)
  assert.equal(plan.mode, 'win')
  assert.ok(plan.owes.every(t => t.to === writerKey(0)))
})

// ── split + commit small branches ────────────────────────────────────────────

test('split: parseUnits with zero decimals hits the empty-fraction arm', () => {
  assert.equal(split.parseUnits('5', 0), 5n)
})

test('commit: commitmentFor rejects a non-hex writer key', () => {
  assert.throws(
    () => commit.commitmentFor({ potId: 'ab'.repeat(32), writer: 'not-hex', prediction: { home: 1, away: 0 }, salt: '0'.repeat(16) }),
    /writer/
  )
})

// ── reducer: openPot token arms, oversize snapshot, reveal guard, default quorum ─

test('reduce: openPot accepts named or txid-shaped tokens, rejects blank/oversize', () => {
  const A = writerKey(0)
  assert.ok(new TestPot().open(A, { token: 'USDC' }).accepted) // isName arm
  assert.ok(new TestPot().open(A, { token: 'a'.repeat(40) }).accepted) // isTxid arm
  assert.equal(new TestPot().open(A, { token: '' }).accepted, false) // neither
  assert.equal(new TestPot().open(A, { token: 'x'.repeat(200) }).accepted, false) // neither
})

test('reduce: a kickoff snapshot with more than 64 heads is rejected', () => {
  const A = writerKey(0)
  const pot = new TestPot()
  pot.open(A)
  const heads = {}
  for (let i = 0; i < 65; i++) heads['k' + i] = 1
  assert.equal(pot.snapshot(A, heads, { ts: 1780000000000 }).accepted, false)
})

test('reduce: a reveal from a non-member writer is rejected', () => {
  const { pot } = playedPot()
  assert.equal(pot.apply(STRANGER, { type: OP.REVEAL_PICK, prediction: { home: 1, away: 0 }, salt: '0'.repeat(16), ts: 1780000060000 }).accepted, false)
})

test('reduce: quorumFor on a pot-less state falls back to the default majority', () => {
  assert.equal(quorumFor(createState()), 1)
})

test('reduce: quorumFor caps an explicit quorum to at least 1 with no stakers', () => {
  const p = new TestPot()
  p.open(writerKey(0), { quorum: 3 })
  assert.equal(quorumFor(p.state), 1) // Math.min(3, 0 || 1)
})
