'use strict'

// Op types — the full protocol surface. Anything else is rejected by the reducer.
const OP = {
  OPEN_POT: 'open-pot',
  ADD_WRITER: 'add-writer',
  STAKE: 'stake',
  COMMIT_PICK: 'commit-pick',
  KICKOFF_SNAPSHOT: 'kickoff-snapshot',
  REVEAL_PICK: 'reveal-pick',
  RESULT_VOTE: 'result-vote',
  PAYOUT: 'payout'
}

const STATUS = {
  OPEN: 'open', // pot created, staking/committing allowed
  LOCKED: 'locked', // kickoff passed — reveals & votes allowed
  RESOLVED: 'resolved', // result finalized — claims allowed
  SETTLED: 'settled' // every winner has claimed
}

// USD₮ uses 6 decimals on every chain WDK supports.
const DECIMALS = 6

// Snapshots are accepted from kickoff-Δ up to kickoff+grace. The grace window
// keeps a briefly-offline honest peer relevant while bounding how late a
// snapshot can arrive and still launder a back-dated commit.
const SNAPSHOT_GRACE_MS = 10 * 60 * 1000

// Sanity bounds — a scoreline, not a basketball game.
const MAX_GOALS = 99

// Reject reasons (stable identifiers — asserted by tests, shown in UI).
const REJECT = {
  UNKNOWN_TYPE: 'unknown-op-type',
  BAD_SHAPE: 'malformed-op',
  POT_EXISTS: 'pot-already-open',
  NO_POT: 'no-pot',
  NOT_CREATOR: 'not-creator',
  NOT_WRITER: 'not-a-member',
  ALREADY_WRITER: 'already-a-member',
  AFTER_KICKOFF: 'after-kickoff',
  BEFORE_KICKOFF: 'before-kickoff',
  ALREADY_STAKED: 'already-staked',
  WRONG_AMOUNT: 'stake-must-equal-buy-in',
  NOT_STAKED: 'not-staked',
  ALREADY_COMMITTED: 'already-committed',
  NOT_COMMITTED: 'no-commit-to-reveal',
  ALREADY_REVEALED: 'already-revealed',
  BAD_REVEAL: 'reveal-does-not-match-commitment',
  ALREADY_SNAPSHOTTED: 'already-snapshotted',
  SNAPSHOT_OUT_OF_WINDOW: 'snapshot-outside-grace-window',
  ALREADY_VOTED: 'already-voted',
  NOT_FINALIZED: 'result-not-finalized',
  AFTER_FINALITY: 'ledger-frozen-after-finality',
  NOTHING_OWED: 'nothing-owed',
  BAD_TRANSFERS: 'transfers-do-not-match-settlement-plan',
  ALREADY_PAID: 'already-settled-payout'
}

module.exports = { OP, STATUS, DECIMALS, SNAPSHOT_GRACE_MS, MAX_GOALS, REJECT }
