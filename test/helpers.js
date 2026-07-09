'use strict'

// Deterministic test harness for the pure protocol core. No I/O, no clocks —
// fixed timestamps so every run of the suite tells the identical story.

const { createState, applyOp } = require('../src/core/reduce')
const { OP } = require('../src/core/constants')
const { commitmentFor } = require('../src/core/commit')

const KICKOFF = 1780000000000 // fixed epoch ms
const BEFORE = KICKOFF - 60_000
const AFTER = KICKOFF + 60_000
const POT_ID = 'f0'.repeat(32)
const BUY_IN = '20000000' // 20 USD₮ in base units (6 decimals)

function writerKey (i) {
  // valid 32-byte hex, lexicographically ordered by index
  return (i + 1).toString(16).padStart(2, '0').repeat(32).slice(0, 64)
}

class TestPot {
  constructor () {
    this.state = createState()
    this.seqs = {}
  }

  next (writer) {
    this.seqs[writer] = (this.seqs[writer] || 0) + 1
    return this.seqs[writer]
  }

  apply (writer, op) {
    return applyOp(this.state, op, { writer, seq: this.next(writer) })
  }

  open (writer, overrides = {}) {
    return this.apply(writer, {
      type: OP.OPEN_POT,
      potId: POT_ID,
      matchId: 'wc2026-final',
      teams: { home: 'Brazil', away: 'Argentina' },
      buyIn: BUY_IN,
      kickoffTs: KICKOFF,
      chain: 'solana-devnet',
      creatorName: 'ana',
      ts: BEFORE - 3600_000,
      ...overrides
    })
  }

  addWriter (byWriter, key, name = 'mate', overrides = {}) {
    return this.apply(byWriter, { type: OP.ADD_WRITER, key, name, ts: BEFORE - 1800_000, ...overrides })
  }

  stake (writer, overrides = {}) {
    return this.apply(writer, {
      type: OP.STAKE,
      amount: BUY_IN,
      payoutAddress: `addr-${writer.slice(0, 8)}`,
      real: false,
      ts: BEFORE,
      ...overrides
    })
  }

  commit (writer, prediction, salt, overrides = {}) {
    const commitment = commitmentFor({ potId: this.state.pot.potId, writer, prediction, salt })
    return this.apply(writer, { type: OP.COMMIT_PICK, commitment, ts: BEFORE, ...overrides })
  }

  snapshot (writer, heads, overrides = {}) {
    return this.apply(writer, { type: OP.KICKOFF_SNAPSHOT, heads, ts: KICKOFF, ...overrides })
  }

  // Snapshot that covers every writer's current core length — what an honest
  // online client does automatically at kickoff.
  snapshotAll (writer, overrides = {}) {
    const heads = {}
    for (const [w, seq] of Object.entries(this.seqs)) heads[w] = seq
    return this.snapshot(writer, heads, overrides)
  }

  reveal (writer, prediction, salt, overrides = {}) {
    return this.apply(writer, { type: OP.REVEAL_PICK, prediction, salt, ts: AFTER, ...overrides })
  }

  vote (writer, score, overrides = {}) {
    return this.apply(writer, { type: OP.RESULT_VOTE, score, ts: AFTER + 7200_000, ...overrides })
  }

  payout (writer, transfers, overrides = {}) {
    return this.apply(writer, { type: OP.PAYOUT, transfers, ts: AFTER + 7300_000, ...overrides })
  }
}

// A fully-played 3-member pot up to (not including) result votes.
// picks: { [writerIndex]: {home,away} } — salts are fixed per index.
function playedPot (picks = { 0: { home: 2, away: 1 }, 1: { home: 2, away: 1 }, 2: { home: 0, away: 0 } }) {
  const pot = new TestPot()
  const A = writerKey(0)
  const B = writerKey(1)
  const C = writerKey(2)
  pot.open(A)
  pot.addWriter(A, B, 'ben')
  pot.addWriter(A, C, 'cai')
  for (const [i, w] of [[0, A], [1, B], [2, C]]) {
    pot.stake(w)
    if (picks[i]) pot.commit(w, picks[i], saltFor(i))
  }
  // every member witnesses everyone at kickoff
  pot.snapshotAll(A)
  pot.snapshotAll(B)
  pot.snapshotAll(C)
  for (const [i, w] of [[0, A], [1, B], [2, C]]) {
    if (picks[i]) pot.reveal(w, picks[i], saltFor(i))
  }
  return { pot, A, B, C }
}

function saltFor (i) {
  return `${(i + 10).toString(16)}b`.repeat(8) // 16 hex chars
}

module.exports = { TestPot, playedPot, writerKey, saltFor, KICKOFF, BEFORE, AFTER, POT_ID, BUY_IN }
