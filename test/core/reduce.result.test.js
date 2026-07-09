'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TestPot, playedPot, writerKey, KICKOFF, saltFor } = require('../helpers')
const { REJECT, STATUS } = require('../../src/core/constants')
const { quorumFor } = require('../../src/core/reduce')

const A = writerKey(0)
const B = writerKey(1)
const C = writerKey(2)
const D = writerKey(3)

// ── voting ────────────────────────────────────────────────────────────────

test('a staked member votes a score after kickoff', () => {
  const { pot } = playedPot()
  const res = pot.vote(A, { home: 2, away: 1 })
  assert.ok(res.accepted)
  assert.deepEqual(pot.state.votes[A].score, { home: 2, away: 1 })
})

test('voting before kickoff is rejected', () => {
  const { pot } = playedPot()
  assert.equal(pot.vote(A, { home: 2, away: 1 }, { ts: KICKOFF - 1 }).reason, REJECT.BEFORE_KICKOFF)
})

test('non-staked members cannot vote on the result', () => {
  const pot = new TestPot()
  pot.open(A)
  pot.addWriter(A, B, 'ben')
  pot.stake(A)
  assert.equal(pot.vote(B, { home: 1, away: 0 }).reason, REJECT.NOT_STAKED)
})

test('double voting is rejected — first vote is binding', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 2, away: 1 })
  assert.equal(pot.vote(A, { home: 0, away: 0 }).reason, REJECT.ALREADY_VOTED)
})

test('a malformed score is rejected', () => {
  const { pot } = playedPot()
  assert.equal(pot.vote(A, { home: -1, away: 0 }).reason, REJECT.BAD_SHAPE)
  assert.equal(pot.vote(B, '2-1').reason, REJECT.BAD_SHAPE)
})

// ── quorum & finality ─────────────────────────────────────────────────────

test('quorum for 3 stakers is 2 (strict majority)', () => {
  const { pot } = playedPot()
  assert.equal(quorumFor(pot.state), 2)
})

test('one vote does not finalize with 3 stakers', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 2, away: 1 })
  assert.equal(pot.state.result, null)
})

test('quorum of matching votes finalizes the result', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 2, away: 1 })
  assert.ok(pot.state.result)
  assert.deepEqual(pot.state.result.score, { home: 2, away: 1 })
  assert.deepEqual(pot.state.result.confirmations, [A, B].sort())
  assert.equal(pot.state.status, STATUS.RESOLVED)
})

test('split votes do not finalize', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 0, away: 0 })
  assert.equal(pot.state.result, null)
})

test('a third vote breaking the tie finalizes deterministically', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 0, away: 0 })
  pot.vote(C, { home: 2, away: 1 })
  assert.deepEqual(pot.state.result.score, { home: 2, away: 1 })
})

test('quorum for 4 stakers is 3', () => {
  const pot = new TestPot()
  pot.open(A)
  for (const [w, n] of [[B, 'ben'], [C, 'cai'], [D, 'dan']]) pot.addWriter(A, w, n)
  for (const w of [A, B, C, D]) pot.stake(w)
  assert.equal(quorumFor(pot.state), 3)
  pot.vote(A, { home: 1, away: 0 })
  pot.vote(B, { home: 1, away: 0 })
  assert.equal(pot.state.result, null) // 2 of 4 is not enough
  pot.vote(C, { home: 1, away: 0 })
  assert.ok(pot.state.result)
})

test('an explicit quorum override is respected', () => {
  const pot = new TestPot()
  pot.open(A, { quorum: 1 })
  pot.stake(A)
  pot.commit(A, { home: 2, away: 1 }, saltFor(0))
  pot.vote(A, { home: 2, away: 1 })
  assert.ok(pot.state.result) // single-vote finality when configured
})

test('votes after finality are rejected', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 2, away: 1 })
  assert.equal(pot.vote(C, { home: 2, away: 1 }).reason, REJECT.AFTER_FINALITY)
})

// ── the ledger freeze ─────────────────────────────────────────────────────

test('finality freezes stakes, commits, snapshots and reveals', () => {
  const picks = { 0: { home: 2, away: 1 }, 1: { home: 2, away: 1 }, 2: null }
  const { pot, C: late } = (() => {
    const r = playedPot(picks)
    return r
  })()
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 2, away: 1 })
  assert.ok(pot.state.result)
  // late-merging ops from a partitioned peer — all valid ts-wise, all frozen out
  assert.equal(pot.commit(late, { home: 2, away: 1 }, saltFor(9), { ts: KICKOFF - 1 }).reason, REJECT.AFTER_FINALITY)
  assert.equal(pot.snapshot(late, { [A]: 1 }, { ts: KICKOFF }).reason, REJECT.AFTER_FINALITY)
  assert.equal(pot.reveal(late, { home: 2, away: 1 }, saltFor(9)).reason, REJECT.AFTER_FINALITY)
})

test('a stake merging after finality is rejected (split is immutable)', () => {
  const pot = new TestPot()
  pot.open(A)
  pot.addWriter(A, B, 'ben')
  pot.addWriter(A, C, 'cai')
  pot.stake(A)
  pot.stake(B)
  pot.commit(A, { home: 1, away: 1 }, saltFor(0))
  pot.snapshotAll(A)
  pot.snapshotAll(B)
  pot.reveal(A, { home: 1, away: 1 }, saltFor(0))
  pot.vote(A, { home: 1, away: 1 })
  pot.vote(B, { home: 1, away: 1 })
  assert.ok(pot.state.result)
  assert.equal(pot.stake(C).reason, REJECT.AFTER_FINALITY)
})
