'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TestPot, writerKey, KICKOFF, saltFor } = require('../helpers')
const { REJECT, SNAPSHOT_GRACE_MS } = require('../../src/core/constants')
const { isWitnessed, eligibility } = require('../../src/core/selectors')

const A = writerKey(0)
const B = writerKey(1)
const C = writerKey(2)
const PICK = { home: 2, away: 1 }

function stakedPot (witnessRule) {
  const pot = new TestPot()
  pot.open(A, witnessRule ? { witnessRule } : {})
  pot.addWriter(A, B, 'ben')
  pot.addWriter(A, C, 'cai')
  pot.stake(A)
  pot.stake(B)
  pot.stake(C)
  return pot
}

// ── snapshot op validation ────────────────────────────────────────────────

test('a member appends one kickoff snapshot', () => {
  const pot = stakedPot()
  const res = pot.snapshotAll(A)
  assert.ok(res.accepted)
  assert.ok(pot.state.snapshots[A])
})

test('a second snapshot from the same member is rejected', () => {
  const pot = stakedPot()
  pot.snapshotAll(A)
  assert.equal(pot.snapshotAll(A).reason, REJECT.ALREADY_SNAPSHOTTED)
})

test('snapshots inside the grace window are accepted', () => {
  const pot = stakedPot()
  assert.ok(pot.snapshot(A, { [B]: 2 }, { ts: KICKOFF + SNAPSHOT_GRACE_MS }).accepted)
})

test('snapshots after the grace window are rejected — no late laundering', () => {
  const pot = stakedPot()
  const res = pot.snapshot(A, { [B]: 2 }, { ts: KICKOFF + SNAPSHOT_GRACE_MS + 1 })
  assert.equal(res.reason, REJECT.SNAPSHOT_OUT_OF_WINDOW)
})

test('snapshot heads must map hex keys to non-negative integers', () => {
  const pot = stakedPot()
  assert.equal(pot.snapshot(A, { nope: 2 }).reason, REJECT.BAD_SHAPE)
  assert.equal(pot.snapshot(A, { [B]: -1 }).reason, REJECT.BAD_SHAPE)
  assert.equal(pot.snapshot(A, { [B]: 1.5 }).reason, REJECT.BAD_SHAPE)
  assert.equal(pot.snapshot(A, [1, 2]).reason, REJECT.BAD_SHAPE)
  assert.equal(pot.snapshot(A, null).reason, REJECT.BAD_SHAPE)
})

test('non-members cannot snapshot', () => {
  const pot = stakedPot()
  const D = writerKey(3)
  assert.equal(pot.snapshot(D, { [B]: 1 }).reason, REJECT.NOT_WRITER)
})

// ── witnessing (the back-dating defence) ──────────────────────────────────

test('a commit covered by another member’s snapshot is witnessed', () => {
  const pot = stakedPot()
  pot.commit(B, PICK, saltFor(1))
  pot.snapshotAll(A) // A saw B's core incl. the commit
  assert.ok(isWitnessed(pot.state, B))
})

test('a commit nobody else saw before kickoff is NOT witnessed', () => {
  const pot = stakedPot()
  pot.snapshotAll(A) // A snapshots BEFORE B commits
  pot.commit(B, PICK, saltFor(1)) // B's commit has a higher seq than A saw
  assert.equal(isWitnessed(pot.state, B), false)
})

test('your own snapshot cannot witness your own commit', () => {
  const pot = stakedPot()
  pot.commit(B, PICK, saltFor(1))
  pot.snapshotAll(B) // B vouching for B proves nothing
  assert.equal(isWitnessed(pot.state, B), false)
})

test('witnessing requires coverage of the commit seq, not just any entry', () => {
  const pot = stakedPot()
  pot.commit(B, PICK, saltFor(1))
  const commitSeq = pot.state.commits[B].seq
  pot.snapshot(A, { [B]: commitSeq - 1 }) // saw B's log but only up to before the commit
  assert.equal(isWitnessed(pot.state, B), false)
})

test('exact-seq coverage witnesses the commit', () => {
  const pot = stakedPot()
  pot.commit(B, PICK, saltFor(1))
  const commitSeq = pot.state.commits[B].seq
  pot.snapshot(A, { [B]: commitSeq })
  assert.ok(isWitnessed(pot.state, B))
})

test('strict mode: unwitnessed commit ⇒ pick is not valid', () => {
  const pot = stakedPot() // strict by default
  pot.commit(B, PICK, saltFor(1))
  // nobody snapshots B's coverage
  pot.reveal(B, PICK, saltFor(1))
  const e = eligibility(pot.state, B)
  assert.ok(e.staked && e.committed && e.revealed)
  assert.equal(e.witnessed, false)
  assert.equal(e.valid, false)
})

test('lenient mode: timestamp alone is enough (documented weaker setting)', () => {
  const pot = stakedPot('lenient')
  pot.commit(B, PICK, saltFor(1))
  pot.reveal(B, PICK, saltFor(1))
  const e = eligibility(pot.state, B)
  assert.ok(e.witnessed)
  assert.ok(e.valid)
})

test('the demo money-shot: a back-dated commit merging after kickoff is dead on arrival', () => {
  // C was "offline" at kickoff. A and B snapshot at kickoff without seeing any
  // commit from C. C then appends a commit with a forged pre-kickoff ts.
  const pot = stakedPot()
  pot.commit(A, PICK, saltFor(0))
  pot.commit(B, { home: 0, away: 0 }, saltFor(1))
  pot.snapshotAll(A)
  pot.snapshotAll(B)
  // forged ts passes the naive clock check…
  const res = pot.commit(C, { home: 2, away: 1 }, saltFor(2), { ts: KICKOFF - 1 })
  assert.ok(res.accepted) // the op itself lands in the log (append-only!)
  pot.reveal(A, PICK, saltFor(0))
  pot.reveal(B, { home: 0, away: 0 }, saltFor(1))
  pot.reveal(C, { home: 2, away: 1 }, saltFor(2))
  // …but no other member's kickoff snapshot covers it ⇒ never eligible.
  const e = eligibility(pot.state, C)
  assert.equal(e.witnessed, false)
  assert.equal(e.valid, false)
  // honest members stay eligible
  assert.ok(eligibility(pot.state, A).valid)
  assert.ok(eligibility(pot.state, B).valid)
})
