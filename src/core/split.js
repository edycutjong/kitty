'use strict'

// Deterministic zero-sum pot division in USD₮ base units (bigint).
// Every peer computes the identical result from the identical inputs.

function isAmountString (s) {
  return typeof s === 'string' && /^[0-9]+$/.test(s) && BigInt(s) > 0n
}

// winners: array of writer-key hex strings. pool: bigint.
// Returns Map<writer, bigint>. Remainder goes one unit each to the lowest
// writer keys (lexicographic hex order) — arbitrary but identical everywhere.
function dividePool (pool, winners) {
  if (typeof pool !== 'bigint' || pool < 0n) throw new Error('pool must be a non-negative bigint')
  if (!Array.isArray(winners) || winners.length === 0) throw new Error('winners must be non-empty')
  const sorted = [...winners].sort()
  const n = BigInt(sorted.length)
  const base = pool / n
  const rem = pool % n
  const out = new Map()
  sorted.forEach((w, i) => {
    out.set(w, base + (BigInt(i) < rem ? 1n : 0n))
  })
  return out
}

// stakes: { [writer]: { amount } } — winners: writer[] (exact-score matchers).
// mode 'win'    → winners split the whole pool
// mode 'refund' → nobody matched: every staker gets their stake back
// mode 'none'   → nothing staked yet
function computeSplit ({ stakes, winners }) {
  const stakers = Object.keys(stakes).sort()
  if (stakers.length === 0) return { mode: 'none', pool: 0n, entries: new Map() }

  let pool = 0n
  for (const w of stakers) {
    const amt = stakes[w].amount
    if (!isAmountString(amt)) throw new Error(`invalid stake amount for ${w}`)
    pool += BigInt(amt)
  }

  if (Array.isArray(winners) && winners.length > 0) {
    return { mode: 'win', pool, entries: dividePool(pool, winners) }
  }

  const entries = new Map()
  for (const w of stakers) entries.set(w, BigInt(stakes[w].amount))
  return { mode: 'refund', pool, entries }
}

// The accounting invariant: Σ payouts == Σ stakes. Zero-sum, no house cut.
function verifyAccounting (split) {
  let paid = 0n
  for (const amt of split.entries.values()) paid += amt
  return paid === split.pool
}

function formatUnits (amount, decimals = 6) {
  const a = typeof amount === 'bigint' ? amount : BigInt(amount)
  const neg = a < 0n
  const abs = neg ? -a : a
  const d = 10n ** BigInt(decimals)
  const whole = abs / d
  const frac = (abs % d).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`
}

function parseUnits (str, decimals = 6) {
  if (typeof str !== 'string' || !/^[0-9]+(\.[0-9]+)?$/.test(str)) throw new Error('invalid decimal amount')
  const [whole, frac = ''] = str.split('.')
  if (frac.length > decimals) throw new Error(`too many decimal places (max ${decimals})`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

module.exports = { isAmountString, dividePool, computeSplit, verifyAccounting, formatUnits, parseUnits }
