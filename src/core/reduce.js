'use strict'

// The Kitty protocol reducer.
//
// A pot is a deterministic state machine folded over the Autobase-linearized
// op sequence. This module is pure: no I/O, no clocks, no crypto beyond the
// commit-reveal hash check. Autobase may truncate and re-apply the view at any
// time, so acceptance may depend ONLY on (op, ctx, current state) — never on
// wall-clock time or local knowledge a remote peer might not share.
//
// ctx = { writer: hex64 (which member's core the op came from — unforgeable,
//         it is the signing key of that Hypercore), seq: 1-based position of
//         the op inside that writer's core }

const { OP, STATUS, REJECT, SNAPSHOT_GRACE_MS, MAX_GOALS } = require('./constants')
const { isValidPrediction, verifyReveal } = require('./commit')
const { isAmountString } = require('./split')
const { isHex } = require('./hash')

function createState () {
  return {
    pot: null,
    writers: {}, // writer -> { name, addedBy, ts }
    stakes: {}, // writer -> { amount, payoutAddress, real, ts }
    commits: {}, // writer -> { commitment, ts, seq }
    snapshots: {}, // writer -> { heads: { writer: length }, ts }
    reveals: {}, // writer -> { prediction, salt, ts }
    votes: {}, // writer -> { score, ts }
    result: null, // { score, confirmations: [writer], finalizedTs }
    payouts: {}, // loser -> { transfers: [{ to, amount, txid }], ts }
    status: null, // op-driven only: open | resolved | settled ('locked' is time-derived, see selectors
    log: [] // audit trail incl. rejections — the UI ledger
  }
}

function isTs (ts) {
  return Number.isInteger(ts) && ts > 0
}

function isName (s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 32
}

function isTxid (s) {
  return typeof s === 'string' && s.length >= 4 && s.length <= 128
}

// ── per-op validators ─────────────────────────────────────────────────────
// Each returns null to accept, or a REJECT reason string.

function validateOpenPot (state, op) {
  if (state.pot) return REJECT.POT_EXISTS
  const ok =
    isHex(op.potId) &&
    typeof op.matchId === 'string' && op.matchId.length >= 1 && op.matchId.length <= 64 &&
    op.teams && isName(op.teams.home) && isName(op.teams.away) &&
    isAmountString(op.buyIn) &&
    isTs(op.kickoffTs) &&
    isName(op.chain) &&
    (op.token === undefined || isName(op.token) || isTxid(op.token)) &&
    (op.quorum === undefined || (Number.isInteger(op.quorum) && op.quorum >= 1)) &&
    (op.witnessRule === undefined || op.witnessRule === 'strict' || op.witnessRule === 'lenient')
  return ok ? null : REJECT.BAD_SHAPE
}

function validateAddWriter (state, op, ctx) {
  if (!state.pot) return REJECT.NO_POT
  if (!state.writers[ctx.writer]) return REJECT.NOT_WRITER
  if (!isHex(op.key, 32)) return REJECT.BAD_SHAPE
  if (!isName(op.name)) return REJECT.BAD_SHAPE
  if (state.writers[op.key]) return REJECT.ALREADY_WRITER
  return null
}

function validateStake (state, op, ctx) {
  if (!state.pot) return REJECT.NO_POT
  if (state.result) return REJECT.AFTER_FINALITY
  if (!state.writers[ctx.writer]) return REJECT.NOT_WRITER
  if (state.stakes[ctx.writer]) return REJECT.ALREADY_STAKED
  if (!isTs(op.ts) || op.ts >= state.pot.kickoffTs) return REJECT.AFTER_KICKOFF
  if (!isAmountString(op.amount) || op.amount !== state.pot.buyIn) return REJECT.WRONG_AMOUNT
  if (!isTxid(op.payoutAddress)) return REJECT.BAD_SHAPE
  return null
}

function validateCommit (state, op, ctx) {
  if (!state.pot) return REJECT.NO_POT
  if (state.result) return REJECT.AFTER_FINALITY
  if (!state.writers[ctx.writer]) return REJECT.NOT_WRITER
  if (!state.stakes[ctx.writer]) return REJECT.NOT_STAKED
  if (state.commits[ctx.writer]) return REJECT.ALREADY_COMMITTED
  if (!isTs(op.ts) || op.ts >= state.pot.kickoffTs) return REJECT.AFTER_KICKOFF
  if (!isHex(op.commitment, 32)) return REJECT.BAD_SHAPE
  return null
}

function validateSnapshot (state, op, ctx) {
  if (!state.pot) return REJECT.NO_POT
  if (state.result) return REJECT.AFTER_FINALITY
  if (!state.writers[ctx.writer]) return REJECT.NOT_WRITER
  if (state.snapshots[ctx.writer]) return REJECT.ALREADY_SNAPSHOTTED
  if (!isTs(op.ts) || op.ts > state.pot.kickoffTs + SNAPSHOT_GRACE_MS) return REJECT.SNAPSHOT_OUT_OF_WINDOW
  if (!op.heads || typeof op.heads !== 'object' || Array.isArray(op.heads)) return REJECT.BAD_SHAPE
  const entries = Object.entries(op.heads)
  if (entries.length > 64) return REJECT.BAD_SHAPE
  for (const [k, v] of entries) {
    if (!isHex(k, 32) || !Number.isInteger(v) || v < 0) return REJECT.BAD_SHAPE
  }
  return null
}

function validateReveal (state, op, ctx) {
  if (!state.pot) return REJECT.NO_POT
  if (state.result) return REJECT.AFTER_FINALITY
  if (!state.writers[ctx.writer]) return REJECT.NOT_WRITER
  const commit = state.commits[ctx.writer]
  if (!commit) return REJECT.NOT_COMMITTED
  if (state.reveals[ctx.writer]) return REJECT.ALREADY_REVEALED
  if (!isTs(op.ts) || op.ts < state.pot.kickoffTs) return REJECT.BEFORE_KICKOFF
  const ok = verifyReveal({
    potId: state.pot.potId,
    writer: ctx.writer,
    prediction: op.prediction,
    salt: op.salt,
    commitment: commit.commitment
  })
  return ok ? null : REJECT.BAD_REVEAL
}

function validateVote (state, op, ctx) {
  if (!state.pot) return REJECT.NO_POT
  if (state.result) return REJECT.AFTER_FINALITY
  if (!state.writers[ctx.writer]) return REJECT.NOT_WRITER
  if (!state.stakes[ctx.writer]) return REJECT.NOT_STAKED
  if (state.votes[ctx.writer]) return REJECT.ALREADY_VOTED
  if (!isTs(op.ts) || op.ts < state.pot.kickoffTs) return REJECT.BEFORE_KICKOFF
  if (!isValidPrediction(op.score) || op.score.home > MAX_GOALS || op.score.away > MAX_GOALS) return REJECT.BAD_SHAPE
  return null
}

function validatePayout (state, op, ctx, selectors) {
  if (!state.pot) return REJECT.NO_POT
  if (!state.result) return REJECT.NOT_FINALIZED
  if (!state.writers[ctx.writer]) return REJECT.NOT_WRITER
  if (state.payouts[ctx.writer]) return REJECT.ALREADY_PAID
  const plan = selectors.settlementPlan(state)
  const owed = plan.owes.filter(t => t.from === ctx.writer)
  if (owed.length === 0) return REJECT.NOTHING_OWED
  if (!Array.isArray(op.transfers) || op.transfers.length !== owed.length) return REJECT.BAD_TRANSFERS
  // Exact multiset match against the deterministic plan, txid required per leg.
  const want = new Map(owed.map(t => [`${t.to}:${t.amount}`, true]))
  for (const t of op.transfers) {
    if (!t || !isHex(t.to, 32) || !isAmountString(t.amount) || !isTxid(t.txid)) return REJECT.BAD_TRANSFERS
    const key = `${t.to}:${t.amount}`
    if (!want.has(key)) return REJECT.BAD_TRANSFERS
    want.delete(key)
  }
  /* c8 ignore next -- defensive: for a single payer the plan legs have unique (to,amount) keys, so `want` drains fully once the leg count matches */
  if (want.size !== 0) return REJECT.BAD_TRANSFERS
  return null
}

// ── quorum ────────────────────────────────────────────────────────────────

function quorumFor (state) {
  const staked = Object.keys(state.stakes).length
  if (state.pot && Number.isInteger(state.pot.quorum)) return Math.min(state.pot.quorum, staked || 1)
  return Math.floor(staked / 2) + 1
}

function tallyAndMaybeFinalize (state, ts) {
  const q = quorumFor(state)
  const counts = new Map()
  for (const [w, v] of Object.entries(state.votes)) {
    const key = `${v.score.home}-${v.score.away}`
    if (!counts.has(key)) counts.set(key, [])
    counts.get(key).push(w)
  }
  for (const [key, voters] of counts) {
    if (voters.length >= q) {
      const [home, away] = key.split('-').map(Number)
      state.result = { score: { home, away }, confirmations: voters.sort(), finalizedTs: ts, quorum: q }
      state.status = STATUS.RESOLVED
      return true
    }
  }
  return false
}

// ── apply ─────────────────────────────────────────────────────────────────

function summarizeOp (op) {
  switch (op.type) {
    case OP.OPEN_POT: return `${op.teams?.home} v ${op.teams?.away} · buy-in ${op.buyIn}`
    case OP.ADD_WRITER: return `${op.name} (${String(op.key).slice(0, 8)}…)`
    case OP.STAKE: return `pledged ${op.amount}`
    case OP.COMMIT_PICK: return `sealed pick ${String(op.commitment).slice(0, 12)}…`
    case OP.KICKOFF_SNAPSHOT: return `witnessed ${Object.keys(op.heads || {}).length} logs`
    case OP.REVEAL_PICK: return op.prediction ? `revealed ${op.prediction.home}–${op.prediction.away}` : 'revealed'
    case OP.RESULT_VOTE: return op.score ? `voted ${op.score.home}–${op.score.away}` : 'voted'
    case OP.PAYOUT: return `settled ${Array.isArray(op.transfers) ? op.transfers.length : 0} transfer(s)`
    default: return op.type
  }
}

// applyOp mutates `state` and returns { accepted, reason }. `selectors` is
// injected lazily to avoid a require cycle (payout validation needs the plan).
function applyOp (state, op, ctx, selectors = require('./selectors')) {
  const entry = {
    i: state.log.length,
    writer: ctx.writer,
    seq: ctx.seq,
    type: op && op.type,
    ts: op && op.ts,
    summary: op ? summarizeOp(op) : 'invalid',
    accepted: false,
    reason: null
  }

  let reason
  if (!op || typeof op !== 'object' || typeof op.type !== 'string' || !isHex(ctx.writer, 32) || !Number.isInteger(ctx.seq) || ctx.seq < 1) {
    reason = REJECT.BAD_SHAPE
  } else {
    switch (op.type) {
      case OP.OPEN_POT: reason = validateOpenPot(state, op, ctx); break
      case OP.ADD_WRITER: reason = validateAddWriter(state, op, ctx); break
      case OP.STAKE: reason = validateStake(state, op, ctx); break
      case OP.COMMIT_PICK: reason = validateCommit(state, op, ctx); break
      case OP.KICKOFF_SNAPSHOT: reason = validateSnapshot(state, op, ctx); break
      case OP.REVEAL_PICK: reason = validateReveal(state, op, ctx); break
      case OP.RESULT_VOTE: reason = validateVote(state, op, ctx); break
      case OP.PAYOUT: reason = validatePayout(state, op, ctx, selectors); break
      default: reason = REJECT.UNKNOWN_TYPE
    }
  }

  if (reason) {
    entry.reason = reason
    state.log.push(entry)
    return { accepted: false, reason }
  }

  switch (op.type) {
    case OP.OPEN_POT: {
      state.pot = {
        potId: op.potId,
        matchId: op.matchId,
        teams: { home: op.teams.home, away: op.teams.away },
        buyIn: op.buyIn,
        kickoffTs: op.kickoffTs,
        chain: op.chain,
        token: op.token || 'USDT',
        quorum: op.quorum ?? null,
        witnessRule: op.witnessRule || 'strict',
        creator: ctx.writer,
        createdTs: op.ts
      }
      state.writers[ctx.writer] = { name: isName(op.creatorName) ? op.creatorName : 'creator', addedBy: null, ts: op.ts }
      state.status = STATUS.OPEN
      break
    }
    case OP.ADD_WRITER: {
      state.writers[op.key] = { name: op.name, addedBy: ctx.writer, ts: op.ts }
      break
    }
    case OP.STAKE: {
      state.stakes[ctx.writer] = { amount: op.amount, payoutAddress: op.payoutAddress, real: op.real === true, ts: op.ts }
      break
    }
    case OP.COMMIT_PICK: {
      state.commits[ctx.writer] = { commitment: op.commitment, ts: op.ts, seq: ctx.seq }
      break
    }
    case OP.KICKOFF_SNAPSHOT: {
      state.snapshots[ctx.writer] = { heads: { ...op.heads }, ts: op.ts }
      break
    }
    case OP.REVEAL_PICK: {
      state.reveals[ctx.writer] = { prediction: { ...op.prediction }, salt: op.salt, ts: op.ts }
      break
    }
    case OP.RESULT_VOTE: {
      state.votes[ctx.writer] = { score: { ...op.score }, ts: op.ts }
      const finalized = tallyAndMaybeFinalize(state, op.ts)
      if (finalized && selectors.settlementPlan(state).owes.length === 0) {
        // Refund mode or everyone-won: nothing moves, the pot is settled as-is.
        state.status = STATUS.SETTLED
      }
      break
    }
    case OP.PAYOUT: {
      state.payouts[ctx.writer] = { transfers: op.transfers.map(t => ({ to: t.to, amount: t.amount, txid: t.txid })), ts: op.ts }
      const plan = selectors.settlementPlan(state)
      const owingWriters = new Set(plan.owes.map(t => t.from))
      const allPaid = [...owingWriters].every(w => state.payouts[w])
      if (allPaid) state.status = STATUS.SETTLED
      break
    }
  }

  entry.accepted = true
  state.log.push(entry)
  return { accepted: true, reason: null }
}

// Fold a full linearized history: entries = [{ op, writer, seq }]
function reduce (entries, state = createState()) {
  for (const { op, writer, seq } of entries) applyOp(state, op, { writer, seq })
  return state
}

module.exports = { createState, applyOp, reduce, quorumFor }
