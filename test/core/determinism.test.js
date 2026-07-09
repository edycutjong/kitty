'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { playedPot, writerKey, saltFor, KICKOFF, BEFORE, AFTER, POT_ID, BUY_IN } = require('../helpers')
const { createState, applyOp, reduce } = require('../../src/core/reduce')
const { summarize } = require('../../src/core/selectors')
const { commitmentFor } = require('../../src/core/commit')
const { OP } = require('../../src/core/constants')

const A = writerKey(0)
const B = writerKey(1)
const C = writerKey(2)

// Build one canonical op history (what Autobase would linearize) as
// [{ op, writer, seq }] entries.
function history () {
  const entries = []
  const seqs = {}
  const push = (writer, op) => {
    seqs[writer] = (seqs[writer] || 0) + 1
    entries.push({ op, writer, seq: seqs[writer] })
  }
  push(A, { type: OP.OPEN_POT, potId: POT_ID, matchId: 'm', teams: { home: 'BRA', away: 'ARG' }, buyIn: BUY_IN, kickoffTs: KICKOFF, chain: 'solana-devnet', ts: BEFORE - 1000 })
  push(A, { type: OP.ADD_WRITER, key: B, name: 'ben', ts: BEFORE - 900 })
  push(A, { type: OP.ADD_WRITER, key: C, name: 'cai', ts: BEFORE - 800 })
  push(A, { type: OP.STAKE, amount: BUY_IN, payoutAddress: 'addr-a', ts: BEFORE })
  push(B, { type: OP.STAKE, amount: BUY_IN, payoutAddress: 'addr-b', ts: BEFORE })
  push(C, { type: OP.STAKE, amount: BUY_IN, payoutAddress: 'addr-c', ts: BEFORE })
  push(A, { type: OP.COMMIT_PICK, commitment: commitmentFor({ potId: POT_ID, writer: A, prediction: { home: 2, away: 1 }, salt: saltFor(0) }), ts: BEFORE + 1 })
  push(B, { type: OP.COMMIT_PICK, commitment: commitmentFor({ potId: POT_ID, writer: B, prediction: { home: 0, away: 0 }, salt: saltFor(1) }), ts: BEFORE + 2 })
  push(A, { type: OP.KICKOFF_SNAPSHOT, heads: { [A]: 5, [B]: 2, [C]: 1 }, ts: KICKOFF })
  push(B, { type: OP.KICKOFF_SNAPSHOT, heads: { [A]: 5, [B]: 2, [C]: 1 }, ts: KICKOFF })
  push(A, { type: OP.REVEAL_PICK, prediction: { home: 2, away: 1 }, salt: saltFor(0), ts: AFTER })
  push(B, { type: OP.REVEAL_PICK, prediction: { home: 0, away: 0 }, salt: saltFor(1), ts: AFTER })
  push(A, { type: OP.RESULT_VOTE, score: { home: 2, away: 1 }, ts: AFTER + 100 })
  push(B, { type: OP.RESULT_VOTE, score: { home: 2, away: 1 }, ts: AFTER + 101 })
  return entries
}

test('the same linearized history reduces to the identical state, every time', () => {
  const s1 = reduce(history())
  const s2 = reduce(history())
  assert.deepEqual(s1, s2)
})

test('incremental application equals batch application (Autobase re-apply safety)', () => {
  const entries = history()
  const batch = reduce(entries)
  const incremental = createState()
  for (const { op, writer, seq } of entries) applyOp(incremental, op, { writer, seq })
  assert.deepEqual(batch, incremental)
})

test('replaying from scratch after truncation converges (view rebuild)', () => {
  const entries = history()
  const full = reduce(entries)
  // simulate: peer applied a prefix, Autobase truncates, re-applies everything
  reduce(entries.slice(0, 7)) // discarded prefix state
  const rebuilt = reduce(entries)
  assert.deepEqual(full, rebuilt)
})

test('summaries derived from equal states are equal (fixed clock)', () => {
  const now = AFTER + 500
  const a = summarize(reduce(history()), now)
  const b = summarize(reduce(history()), now)
  assert.deepEqual(a, b)
})

test('stake order between different writers does not change the split', () => {
  const entries = history()
  // find the three stake entries and rotate their order
  const idx = entries.map((e, i) => (e.op.type === OP.STAKE ? i : -1)).filter(i => i >= 0)
  const swapped = [...entries]
  ;[swapped[idx[0]], swapped[idx[1]], swapped[idx[2]]] = [entries[idx[2]], entries[idx[0]], entries[idx[1]]]
  const s1 = reduce(entries)
  const s2 = reduce(swapped)
  assert.deepEqual(s1.stakes, s2.stakes)
  assert.deepEqual(summarize(s1, AFTER).splits, summarize(s2, AFTER).splits)
})

test('a full played pot is JSON-serializable (Hyperbee view safety)', () => {
  const { pot } = playedPot()
  const json = JSON.stringify(pot.state)
  const back = JSON.parse(json)
  assert.deepEqual(back, pot.state)
})
