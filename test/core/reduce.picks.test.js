'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TestPot, writerKey, KICKOFF, AFTER, saltFor } = require('../helpers')
const { REJECT } = require('../../src/core/constants')
const { commitmentFor } = require('../../src/core/commit')

const A = writerKey(0)
const B = writerKey(1)
const PICK = { home: 2, away: 1 }

function stakedPot () {
  const pot = new TestPot()
  pot.open(A)
  pot.addWriter(A, B, 'ben')
  pot.stake(A)
  pot.stake(B)
  return pot
}

// ── commit (seal the pick) ────────────────────────────────────────────────

test('a staked member seals a pick before kickoff', () => {
  const pot = stakedPot()
  const res = pot.commit(B, PICK, saltFor(1))
  assert.ok(res.accepted)
  assert.ok(pot.state.commits[B].commitment)
  assert.ok(pot.state.commits[B].seq >= 1)
})

test('committing without staking first is rejected', () => {
  const pot = new TestPot()
  pot.open(A)
  pot.addWriter(A, B, 'ben')
  assert.equal(pot.commit(B, PICK, saltFor(1)).reason, REJECT.NOT_STAKED)
})

test('a second commit from the same member is rejected — picks are immutable', () => {
  const pot = stakedPot()
  pot.commit(B, PICK, saltFor(1))
  const res = pot.commit(B, { home: 3, away: 0 }, saltFor(2))
  assert.equal(res.reason, REJECT.ALREADY_COMMITTED)
})

test('committing at or after kickoff is rejected — the lock', () => {
  const pot = stakedPot()
  assert.equal(pot.commit(B, PICK, saltFor(1), { ts: KICKOFF }).reason, REJECT.AFTER_KICKOFF)
  assert.equal(pot.commit(B, PICK, saltFor(1), { ts: KICKOFF + 5000 }).reason, REJECT.AFTER_KICKOFF)
})

test('commit one millisecond before kickoff still counts', () => {
  const pot = stakedPot()
  assert.ok(pot.commit(B, PICK, saltFor(1), { ts: KICKOFF - 1 }).accepted)
})

test('commit requires a well-formed 32-byte commitment', () => {
  const pot = stakedPot()
  assert.equal(pot.apply(B, { type: 'commit-pick', commitment: 'abcd', ts: KICKOFF - 1 }).reason, REJECT.BAD_SHAPE)
  assert.equal(pot.apply(B, { type: 'commit-pick', commitment: 123, ts: KICKOFF - 1 }).reason, REJECT.BAD_SHAPE)
})

test('non-members cannot commit', () => {
  const pot = new TestPot()
  pot.open(A)
  assert.equal(pot.commit(B, PICK, saltFor(1)).reason, REJECT.NOT_WRITER)
})

// ── reveal (open the pick) ────────────────────────────────────────────────

function committedPot () {
  const pot = stakedPot()
  pot.commit(A, PICK, saltFor(0))
  pot.commit(B, { home: 0, away: 0 }, saltFor(1))
  pot.snapshotAll(A)
  pot.snapshotAll(B)
  return pot
}

test('a correct reveal after kickoff is accepted', () => {
  const pot = committedPot()
  const res = pot.reveal(B, { home: 0, away: 0 }, saltFor(1))
  assert.ok(res.accepted)
  assert.deepEqual(pot.state.reveals[B].prediction, { home: 0, away: 0 })
})

test('revealing before kickoff is rejected — picks stay sealed', () => {
  const pot = committedPot()
  const res = pot.reveal(B, { home: 0, away: 0 }, saltFor(1), { ts: KICKOFF - 1 })
  assert.equal(res.reason, REJECT.BEFORE_KICKOFF)
})

test('a reveal with the wrong prediction is rejected — you cannot change your pick', () => {
  const pot = committedPot()
  const res = pot.reveal(B, { home: 5, away: 0 }, saltFor(1))
  assert.equal(res.reason, REJECT.BAD_REVEAL)
})

test('a reveal with the wrong salt is rejected', () => {
  const pot = committedPot()
  assert.equal(pot.reveal(B, { home: 0, away: 0 }, 'ff'.repeat(8)).reason, REJECT.BAD_REVEAL)
})

test('revealing without a commit is rejected', () => {
  const pot = stakedPot()
  assert.equal(pot.reveal(B, PICK, saltFor(1)).reason, REJECT.NOT_COMMITTED)
})

test('double reveal is rejected', () => {
  const pot = committedPot()
  pot.reveal(B, { home: 0, away: 0 }, saltFor(1))
  assert.equal(pot.reveal(B, { home: 0, away: 0 }, saltFor(1)).reason, REJECT.ALREADY_REVEALED)
})

test('you cannot open someone else’s commitment as your own', () => {
  // B tries to reveal using A's exact prediction+salt: the commitment binds
  // the writer key, so B's opening never matches B's sealed commitment.
  const pot = stakedPot()
  pot.commit(A, PICK, saltFor(0))
  const stolen = commitmentFor({ potId: pot.state.pot.potId, writer: A, prediction: PICK, salt: saltFor(0) })
  pot.apply(B, { type: 'commit-pick', commitment: stolen, ts: KICKOFF - 1 })
  pot.snapshotAll(A)
  const res = pot.reveal(B, PICK, saltFor(0), { ts: AFTER })
  assert.equal(res.reason, REJECT.BAD_REVEAL)
})

test('a failed reveal can be retried with the right opening', () => {
  const pot = committedPot()
  pot.reveal(B, { home: 9, away: 9 }, saltFor(1)) // wrong — rejected
  const res = pot.reveal(B, { home: 0, away: 0 }, saltFor(1))
  assert.ok(res.accepted)
})
