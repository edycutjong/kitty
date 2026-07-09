'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TestPot, writerKey, BUY_IN } = require('../helpers')
const { REJECT, STATUS } = require('../../src/core/constants')

const A = writerKey(0)
const B = writerKey(1)

test('open-pot is accepted and seeds pot state', () => {
  const pot = new TestPot()
  const res = pot.open(A)
  assert.ok(res.accepted)
  assert.equal(pot.state.pot.matchId, 'wc2026-final')
  assert.equal(pot.state.pot.buyIn, BUY_IN)
  assert.equal(pot.state.pot.creator, A)
  assert.equal(pot.state.status, STATUS.OPEN)
})

test('creator becomes the first member with their name', () => {
  const pot = new TestPot()
  pot.open(A)
  assert.ok(pot.state.writers[A])
  assert.equal(pot.state.writers[A].name, 'ana')
})

test('a second open-pot is rejected — even by the creator', () => {
  const pot = new TestPot()
  pot.open(A)
  const res = pot.open(A)
  assert.equal(res.accepted, false)
  assert.equal(res.reason, REJECT.POT_EXISTS)
})

test('a second open-pot from another writer is rejected', () => {
  const pot = new TestPot()
  pot.open(A)
  const res = pot.open(B)
  assert.equal(res.accepted, false)
  assert.equal(res.reason, REJECT.POT_EXISTS)
})

test('open-pot rejects a non-hex potId', () => {
  const pot = new TestPot()
  const res = pot.open(A, { potId: 'not-hex!' })
  assert.equal(res.reason, REJECT.BAD_SHAPE)
})

test('open-pot rejects a zero or malformed buy-in', () => {
  const pot = new TestPot()
  assert.equal(pot.open(A, { buyIn: '0' }).reason, REJECT.BAD_SHAPE)
  const pot2 = new TestPot()
  assert.equal(pot2.open(A, { buyIn: '1.5' }).reason, REJECT.BAD_SHAPE)
  const pot3 = new TestPot()
  assert.equal(pot3.open(A, { buyIn: 20 }).reason, REJECT.BAD_SHAPE)
})

test('open-pot rejects missing or oversized team names', () => {
  const pot = new TestPot()
  assert.equal(pot.open(A, { teams: { home: '', away: 'Argentina' } }).reason, REJECT.BAD_SHAPE)
  const pot2 = new TestPot()
  assert.equal(pot2.open(A, { teams: { home: 'x'.repeat(33), away: 'y' } }).reason, REJECT.BAD_SHAPE)
  const pot3 = new TestPot()
  assert.equal(pot3.open(A, { teams: null }).reason, REJECT.BAD_SHAPE)
})

test('open-pot rejects an invalid kickoff timestamp', () => {
  const pot = new TestPot()
  assert.equal(pot.open(A, { kickoffTs: 'soon' }).reason, REJECT.BAD_SHAPE)
  const pot2 = new TestPot()
  assert.equal(pot2.open(A, { kickoffTs: -5 }).reason, REJECT.BAD_SHAPE)
})

test('open-pot rejects an invalid quorum override', () => {
  const pot = new TestPot()
  assert.equal(pot.open(A, { quorum: 0 }).reason, REJECT.BAD_SHAPE)
  const pot2 = new TestPot()
  assert.equal(pot2.open(A, { quorum: 'all' }).reason, REJECT.BAD_SHAPE)
})

test('open-pot rejects an unknown witnessRule', () => {
  const pot = new TestPot()
  assert.equal(pot.open(A, { witnessRule: 'vibes' }).reason, REJECT.BAD_SHAPE)
})

test('witnessRule defaults to strict', () => {
  const pot = new TestPot()
  pot.open(A)
  assert.equal(pot.state.pot.witnessRule, 'strict')
})

test('rejected open leaves state empty and is logged', () => {
  const pot = new TestPot()
  pot.open(A, { buyIn: '0' })
  assert.equal(pot.state.pot, null)
  assert.equal(pot.state.log.length, 1)
  assert.equal(pot.state.log[0].accepted, false)
})

test('unknown op types are rejected and logged', () => {
  const pot = new TestPot()
  pot.open(A)
  const res = pot.apply(A, { type: 'rug-pull', ts: 1 })
  assert.equal(res.reason, REJECT.UNKNOWN_TYPE)
})

test('ops with a malformed writer context are rejected', () => {
  const pot = new TestPot()
  const { applyOp } = require('../../src/core/reduce')
  const res = applyOp(pot.state, { type: 'open-pot', ts: 1 }, { writer: 'nope', seq: 1 })
  assert.equal(res.reason, REJECT.BAD_SHAPE)
})
