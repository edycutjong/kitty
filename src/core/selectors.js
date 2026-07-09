'use strict'

// Pure read-model over reducer state. Everything here is a deterministic
// function of state — safe to call on any peer at any time.

const { STATUS } = require('./constants')
const { samePrediction } = require('./commit')
const { dividePool, formatUnits } = require('./split')

// A commit is witnessed when a DIFFERENT member's kickoff snapshot covers it:
// the snapshot claims to have seen the committer's core at a length ≥ the
// commit's position. A commit only its author saw before kickoff proves
// nothing — that is exactly the back-dating hole.
function isWitnessed (state, writer) {
  const commit = state.commits[writer]
  if (!commit) return false
  for (const [snapshotter, snap] of Object.entries(state.snapshots)) {
    if (snapshotter === writer) continue
    const seen = snap.heads[writer]
    if (Number.isInteger(seen) && seen >= commit.seq) return true
  }
  return false
}

function eligibility (state, writer) {
  const staked = !!state.stakes[writer]
  const committed = !!state.commits[writer]
  const strict = !state.pot || state.pot.witnessRule !== 'lenient'
  const witnessed = committed && (strict ? isWitnessed(state, writer) : true)
  const reveal = state.reveals[writer] || null
  const revealed = !!reveal
  const valid = staked && committed && witnessed && revealed
  return { staked, committed, witnessed, revealed, valid, prediction: reveal ? reveal.prediction : null }
}

function allEligibility (state) {
  const out = {}
  for (const w of Object.keys(state.writers)) out[w] = eligibility(state, w)
  return out
}

// Winners exist only after finality: stakers with a valid (witnessed,
// hash-checked) pick that exactly matches the finalized score.
function winners (state) {
  if (!state.result) return []
  const out = []
  for (const w of Object.keys(state.stakes)) {
    const e = eligibility(state, w)
    if (e.valid && samePrediction(e.prediction, state.result.score)) out.push(w)
  }
  return out.sort()
}

// Gross split of the whole pool among winners (bigint Map), or refund.
function computeSplit (state) {
  const stakers = Object.keys(state.stakes).sort()
  let pool = 0n
  for (const w of stakers) pool += BigInt(state.stakes[w].amount)
  if (!state.result) return { mode: 'pending', pool, entries: new Map() }
  const win = winners(state)
  if (win.length === 0) {
    const entries = new Map()
    for (const w of stakers) entries.set(w, BigInt(state.stakes[w].amount))
    return { mode: 'refund', pool, entries }
  }
  return { mode: 'win', pool, entries: dividePool(pool, win) }
}

// Σ payouts == Σ stakes — the accounting invariant, checked everywhere.
function verifyAccounting (state) {
  const split = computeSplit(state)
  let paid = 0n
  for (const v of split.entries.values()) paid += v
  return { holds: paid === split.pool, paid, pool: split.pool }
}

// The deterministic loser→winner transfer plan (pledge settlement).
// Winner w must end up with gross[w]; they already hold their own stake, so
// their net receivable is gross[w] − stake[w]. Losers each owe exactly their
// stake. A waterfall over key-sorted losers/winners assigns exact amounts —
// identical on every peer.
function settlementPlan (state) {
  if (!state.result) return { mode: 'pending', owes: [], receives: {} }
  const split = computeSplit(state)
  if (split.mode === 'refund') return { mode: 'refund', owes: [], receives: {} }

  const win = winners(state)
  const winSet = new Set(win)
  const losers = Object.keys(state.stakes).filter(w => !winSet.has(w)).sort()

  const need = new Map() // winner -> net receivable
  for (const w of win) need.set(w, split.entries.get(w) - BigInt(state.stakes[w].amount))

  const owes = []
  let wi = 0
  for (const loser of losers) {
    let give = BigInt(state.stakes[loser].amount)
    while (give > 0n && wi < win.length) {
      const w = win[wi]
      const n = need.get(w)
      /* c8 ignore next -- defensive: a break-even winner (gross==stake) is skipped; unreachable with equal buy-ins (nStakers==nWinners ⇒ no losers ⇒ no waterfall) */
      if (n === 0n) { wi++; continue }
      const amt = give < n ? give : n
      owes.push({ from: loser, to: w, amount: amt.toString(), toAddress: state.stakes[w].payoutAddress })
      need.set(w, n - amt)
      give -= amt
      if (need.get(w) === 0n) wi++
    }
  }

  const receives = {}
  for (const w of win) receives[w] = (split.entries.get(w) - BigInt(state.stakes[w].amount)).toString()
  return { mode: 'win', owes, receives, winners: win }
}

function owedBy (state, writer) {
  return settlementPlan(state).owes.filter(t => t.from === writer)
}

// Display status: 'locked' is derived from the clock (never stored — the
// reducer must stay clock-free), everything else is op-driven.
function statusOf (state, now = Date.now()) {
  if (!state.pot) return 'no-pot'
  if (state.status === STATUS.SETTLED) return STATUS.SETTLED
  if (state.status === STATUS.RESOLVED) return STATUS.RESOLVED
  return now >= state.pot.kickoffTs ? STATUS.LOCKED : STATUS.OPEN
}

function summarize (state, now = Date.now()) {
  if (!state.pot) return { status: 'no-pot' }
  const elig = allEligibility(state)
  const split = computeSplit(state)
  const acct = verifyAccounting(state)
  const decimals = 6
  return {
    status: statusOf(state, now),
    pot: state.pot,
    members: Object.entries(state.writers).map(([key, w]) => ({
      key,
      name: w.name,
      ...elig[key],
      voted: !!state.votes[key],
      paid: !!state.payouts[key]
    })),
    pool: split.pool.toString(),
    poolPretty: `${formatUnits(split.pool, decimals)} USD₮`,
    result: state.result,
    quorum: require('./reduce').quorumFor(state),
    splitMode: split.mode,
    splits: [...split.entries.entries()].map(([w, amt]) => ({ writer: w, amount: amt.toString(), pretty: formatUnits(amt, decimals) })),
    accounting: { holds: acct.holds, paid: acct.paid.toString(), pool: acct.pool.toString() },
    settlement: settlementPlan(state),
    rejected: state.log.filter(l => !l.accepted).length,
    logLength: state.log.length
  }
}

module.exports = {
  isWitnessed,
  eligibility,
  allEligibility,
  winners,
  computeSplit,
  verifyAccounting,
  settlementPlan,
  owedBy,
  statusOf,
  summarize
}
