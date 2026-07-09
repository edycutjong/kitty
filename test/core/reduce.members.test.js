'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TestPot, writerKey, BEFORE, KICKOFF, BUY_IN } = require('../helpers')
const { REJECT } = require('../../src/core/constants')

const A = writerKey(0)
const B = writerKey(1)
const C = writerKey(2)

function openPot () {
  const pot = new TestPot()
  pot.open(A)
  return pot
}

// ── membership ────────────────────────────────────────────────────────────

test('a member can add a new writer', () => {
  const pot = openPot()
  const res = pot.addWriter(A, B, 'ben')
  assert.ok(res.accepted)
  assert.equal(pot.state.writers[B].name, 'ben')
  assert.equal(pot.state.writers[B].addedBy, A)
})

test('an admitted member can admit others (invite chains)', () => {
  const pot = openPot()
  pot.addWriter(A, B, 'ben')
  const res = pot.addWriter(B, C, 'cai')
  assert.ok(res.accepted)
  assert.equal(pot.state.writers[C].addedBy, B)
})

test('a stranger cannot add writers', () => {
  const pot = openPot()
  const res = pot.addWriter(B, C, 'cai')
  assert.equal(res.reason, REJECT.NOT_WRITER)
})

test('adding an existing member is rejected', () => {
  const pot = openPot()
  pot.addWriter(A, B, 'ben')
  assert.equal(pot.addWriter(A, B, 'ben-again').reason, REJECT.ALREADY_WRITER)
})

test('re-adding the creator is rejected', () => {
  const pot = openPot()
  assert.equal(pot.addWriter(A, A, 'ana2').reason, REJECT.ALREADY_WRITER)
})

test('add-writer validates key and name shape', () => {
  const pot = openPot()
  assert.equal(pot.addWriter(A, 'zz', 'ben').reason, REJECT.BAD_SHAPE)
  assert.equal(pot.addWriter(A, B, '').reason, REJECT.BAD_SHAPE)
  assert.equal(pot.addWriter(A, B, 'x'.repeat(33)).reason, REJECT.BAD_SHAPE)
})

test('add-writer before any pot exists is rejected', () => {
  const pot = new TestPot()
  assert.equal(pot.addWriter(A, B, 'ben').reason, REJECT.NO_POT)
})

// ── staking (pledges) ─────────────────────────────────────────────────────

function memberPot () {
  const pot = openPot()
  pot.addWriter(A, B, 'ben')
  return pot
}

test('a member stakes the exact buy-in before kickoff', () => {
  const pot = memberPot()
  const res = pot.stake(B)
  assert.ok(res.accepted)
  assert.equal(pot.state.stakes[B].amount, BUY_IN)
})

test('stake records the payout address for settlement', () => {
  const pot = memberPot()
  pot.stake(B, { payoutAddress: 'So1anaAddressXYZ' })
  assert.equal(pot.state.stakes[B].payoutAddress, 'So1anaAddressXYZ')
})

test('non-members cannot stake', () => {
  const pot = memberPot()
  assert.equal(pot.stake(C).reason, REJECT.NOT_WRITER)
})

test('double staking is rejected', () => {
  const pot = memberPot()
  pot.stake(B)
  assert.equal(pot.stake(B).reason, REJECT.ALREADY_STAKED)
})

test('stake must equal the buy-in exactly — no over- or under-staking', () => {
  const pot = memberPot()
  assert.equal(pot.stake(B, { amount: '19999999' }).reason, REJECT.WRONG_AMOUNT)
  assert.equal(pot.stake(B, { amount: '20000001' }).reason, REJECT.WRONG_AMOUNT)
  assert.equal(pot.stake(B, { amount: 'lots' }).reason, REJECT.WRONG_AMOUNT)
})

test('staking at or after kickoff is rejected', () => {
  const pot = memberPot()
  assert.equal(pot.stake(B, { ts: KICKOFF }).reason, REJECT.AFTER_KICKOFF)
  assert.equal(pot.stake(B, { ts: KICKOFF + 1 }).reason, REJECT.AFTER_KICKOFF)
})

test('stake just before kickoff is accepted', () => {
  const pot = memberPot()
  assert.ok(pot.stake(B, { ts: KICKOFF - 1 }).accepted)
})

test('stake requires a plausible payout address', () => {
  const pot = memberPot()
  assert.equal(pot.stake(B, { payoutAddress: '' }).reason, REJECT.BAD_SHAPE)
  assert.equal(pot.stake(B, { payoutAddress: 42 }).reason, REJECT.BAD_SHAPE)
})

test('stake without a pot is rejected', () => {
  const pot = new TestPot()
  assert.equal(pot.stake(B).reason, REJECT.NO_POT)
})

test('every rejection lands in the audit log with its reason', () => {
  const pot = memberPot()
  pot.stake(C) // not a member
  const last = pot.state.log.at(-1)
  assert.equal(last.accepted, false)
  assert.equal(last.reason, REJECT.NOT_WRITER)
  assert.equal(last.writer, C)
})

test('accepted ops land in the audit log with summaries', () => {
  const pot = memberPot()
  pot.stake(B, { ts: BEFORE })
  const last = pot.state.log.at(-1)
  assert.ok(last.accepted)
  assert.match(last.summary, /pledged/)
})
