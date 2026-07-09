'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TestPot, playedPot, writerKey, saltFor, BUY_IN } = require('../helpers')
const { REJECT, STATUS } = require('../../src/core/constants')
const { winners, computeSplit, verifyAccounting, settlementPlan, owedBy, statusOf } = require('../../src/core/selectors')

const A = writerKey(0)
const B = writerKey(1)
const C = writerKey(2)

function resolvedPot () {
  // A and B picked 2–1 (winners), C picked 0–0 (loser). Result 2–1.
  const r = playedPot()
  r.pot.vote(r.A, { home: 2, away: 1 })
  r.pot.vote(r.B, { home: 2, away: 1 })
  return r
}

// ── winners & split ───────────────────────────────────────────────────────

test('winners are stakers with valid picks matching the exact score', () => {
  const { pot } = resolvedPot()
  assert.deepEqual(winners(pot.state), [A, B].sort())
})

test('no winners before finality', () => {
  const { pot } = playedPot()
  assert.deepEqual(winners(pot.state), [])
})

test('split divides the whole pool among winners', () => {
  const { pot } = resolvedPot()
  const split = computeSplit(pot.state)
  assert.equal(split.mode, 'win')
  assert.equal(split.pool, 3n * BigInt(BUY_IN))
  assert.equal(split.entries.get(A) + split.entries.get(B), split.pool)
})

test('Σ payouts == Σ stakes holds after resolution', () => {
  const { pot } = resolvedPot()
  const acct = verifyAccounting(pot.state)
  assert.ok(acct.holds)
  assert.equal(acct.paid, acct.pool)
})

test('refund mode when nobody matched the score', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 7, away: 7 })
  pot.vote(B, { home: 7, away: 7 })
  const split = computeSplit(pot.state)
  assert.equal(split.mode, 'refund')
  assert.equal(split.entries.get(C), BigInt(BUY_IN))
  assert.ok(verifyAccounting(pot.state).holds)
})

test('refund mode settles the pot immediately — nothing moves', () => {
  const { pot } = playedPot()
  pot.vote(A, { home: 7, away: 7 })
  pot.vote(B, { home: 7, away: 7 })
  assert.equal(pot.state.status, STATUS.SETTLED)
  assert.deepEqual(settlementPlan(pot.state).owes, [])
})

test('an unwitnessed "winner" gets nothing — the cheat cannot profit', () => {
  // C sneaks a back-dated 2–1 commit that nobody witnessed.
  const picks = { 0: { home: 0, away: 0 }, 1: { home: 1, away: 1 }, 2: { home: 2, away: 1 } }
  const pot = new TestPot()
  pot.open(A)
  pot.addWriter(A, B, 'ben')
  pot.addWriter(A, C, 'cai')
  for (const [i, w] of [[0, A], [1, B]]) { pot.stake(w); pot.commit(w, picks[i], saltFor(i)) }
  pot.stake(C)
  pot.snapshotAll(A) // snapshots taken before C ever commits
  pot.snapshotAll(B)
  pot.commit(C, picks[2], saltFor(2)) // "back-dated" — accepted into log, unwitnessed
  for (const [i, w] of [[0, A], [1, B], [2, C]]) pot.reveal(w, picks[i], saltFor(i))
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 2, away: 1 })
  // C matched the score but was never witnessed ⇒ refund mode, C profits nothing
  assert.deepEqual(winners(pot.state), [])
  assert.equal(computeSplit(pot.state).mode, 'refund')
})

// ── settlement plan (loser → winner transfers) ────────────────────────────

test('losers owe exactly their stake, winners receive exactly their net', () => {
  const { pot } = resolvedPot()
  const plan = settlementPlan(pot.state)
  assert.equal(plan.mode, 'win')
  const fromC = plan.owes.filter(t => t.from === C)
  let total = 0n
  for (const t of fromC) total += BigInt(t.amount)
  assert.equal(total, BigInt(BUY_IN)) // C pays out exactly the buy-in
  // A and B each net half of C's stake
  assert.equal(plan.receives[A], (BigInt(BUY_IN) / 2n).toString())
  assert.equal(plan.receives[B], (BigInt(BUY_IN) / 2n).toString())
})

test('plan transfers carry the winner payout addresses', () => {
  const { pot } = resolvedPot()
  for (const t of settlementPlan(pot.state).owes) {
    assert.equal(t.toAddress, pot.state.stakes[t.to].payoutAddress)
  }
})

test('single winner takes every loser stake', () => {
  const picks = { 0: { home: 2, away: 1 }, 1: { home: 0, away: 0 }, 2: { home: 1, away: 1 } }
  const { pot } = playedPot(picks)
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 2, away: 1 })
  const plan = settlementPlan(pot.state)
  let toA = 0n
  for (const t of plan.owes) {
    assert.equal(t.to, A)
    toA += BigInt(t.amount)
  }
  assert.equal(toA, 2n * BigInt(BUY_IN))
})

test('everyone-wins ⇒ nobody owes, pot settles at finality', () => {
  const picks = { 0: { home: 2, away: 1 }, 1: { home: 2, away: 1 }, 2: { home: 2, away: 1 } }
  const { pot } = playedPot(picks)
  pot.vote(A, { home: 2, away: 1 })
  pot.vote(B, { home: 2, away: 1 })
  const plan = settlementPlan(pot.state)
  assert.deepEqual(plan.owes, [])
  assert.equal(pot.state.status, STATUS.SETTLED)
})

test('waterfall conservation: Σ owed == Σ received across random pot sizes', () => {
  // 5 members, 2 winners — amounts must conserve exactly.
  const pot = new TestPot()
  const keys = Array.from({ length: 5 }, (_, i) => writerKey(i))
  pot.open(keys[0])
  for (let i = 1; i < 5; i++) pot.addWriter(keys[0], keys[i], `m${i}`)
  const picks = [{ home: 1, away: 0 }, { home: 1, away: 0 }, { home: 0, away: 0 }, { home: 2, away: 2 }, { home: 3, away: 0 }]
  keys.forEach((w, i) => { pot.stake(w); pot.commit(w, picks[i], saltFor(i)) })
  for (const w of keys) pot.snapshotAll(w)
  keys.forEach((w, i) => pot.reveal(w, picks[i], saltFor(i)))
  pot.vote(keys[0], { home: 1, away: 0 })
  pot.vote(keys[1], { home: 1, away: 0 })
  pot.vote(keys[2], { home: 1, away: 0 })
  const plan = settlementPlan(pot.state)
  let owed = 0n
  for (const t of plan.owes) owed += BigInt(t.amount)
  let recv = 0n
  for (const v of Object.values(plan.receives)) recv += BigInt(v)
  assert.equal(owed, recv)
  assert.equal(owed, 3n * BigInt(BUY_IN)) // 3 losers × buy-in
})

// ── payout ops ────────────────────────────────────────────────────────────

function txFor (owes, i = 0) {
  return owes.map((t, idx) => ({ to: t.to, amount: t.amount, txid: `SIMTX-${i}-${idx}` }))
}

test('a loser settles with transfers exactly matching the plan', () => {
  const { pot } = resolvedPot()
  const owes = owedBy(pot.state, C)
  const res = pot.payout(C, txFor(owes))
  assert.ok(res.accepted)
  assert.ok(pot.state.payouts[C])
})

test('the pot reaches settled when every loser has paid', () => {
  const { pot } = resolvedPot()
  pot.payout(C, txFor(owedBy(pot.state, C)))
  assert.equal(pot.state.status, STATUS.SETTLED)
  assert.equal(statusOf(pot.state), STATUS.SETTLED)
})

test('payout before finality is rejected', () => {
  const { pot } = playedPot()
  assert.equal(pot.payout(C, [{ to: A, amount: '1', txid: 'SIMTX' }]).reason, REJECT.NOT_FINALIZED)
})

test('a winner has nothing to settle', () => {
  const { pot } = resolvedPot()
  assert.equal(pot.payout(A, [{ to: B, amount: '1', txid: 'SIMTX' }]).reason, REJECT.NOTHING_OWED)
})

test('wrong transfer amounts are rejected', () => {
  const { pot } = resolvedPot()
  const owes = owedBy(pot.state, C)
  const bad = owes.map(t => ({ to: t.to, amount: '1', txid: 'SIMTX' }))
  assert.equal(pot.payout(C, bad).reason, REJECT.BAD_TRANSFERS)
})

test('wrong destinations are rejected', () => {
  const { pot } = resolvedPot()
  const owes = owedBy(pot.state, C)
  const bad = owes.map(t => ({ to: C, amount: t.amount, txid: 'SIMTX' }))
  assert.equal(pot.payout(C, bad).reason, REJECT.BAD_TRANSFERS)
})

test('missing tx ids are rejected', () => {
  const { pot } = resolvedPot()
  const owes = owedBy(pot.state, C)
  const bad = owes.map(t => ({ to: t.to, amount: t.amount }))
  assert.equal(pot.payout(C, bad).reason, REJECT.BAD_TRANSFERS)
})

test('missing or extra transfer legs are rejected', () => {
  const { pot } = resolvedPot()
  const owes = owedBy(pot.state, C)
  assert.equal(pot.payout(C, []).reason, REJECT.BAD_TRANSFERS)
  const extra = [...txFor(owes), { to: A, amount: '1', txid: 'SIMTX-x' }]
  assert.equal(pot.payout(C, extra).reason, REJECT.BAD_TRANSFERS)
})

test('double payout is rejected', () => {
  const { pot } = resolvedPot()
  pot.payout(C, txFor(owedBy(pot.state, C)))
  assert.equal(pot.payout(C, txFor(owedBy(pot.state, C), 2)).reason, REJECT.ALREADY_PAID)
})

test('statusOf derives locked from the clock and settled from ops', () => {
  const { pot } = playedPot()
  const kickoff = pot.state.pot.kickoffTs
  assert.equal(statusOf(pot.state, kickoff - 1000), STATUS.OPEN)
  assert.equal(statusOf(pot.state, kickoff + 1000), STATUS.LOCKED)
})
