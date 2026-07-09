'use strict'

// The responsible-play guardrail, expressed as a real WDK Transaction Policy.
// DENY-wins: the baseline allows everything, the cap rule denies any USD₮
// transfer above the local per-pot limit — evaluated in-wallet, before any
// transaction exists, on this device only.

const POLICY_ID = 'kitty-responsible-play'
const RULE_NAME = 'cap-buy-in'
const DENY_REASON = 'Stake is above your responsible-play cap for this pot'

function buildCapPolicy (maxBuyInBaseUnits) {
  const cap = BigInt(maxBuyInBaseUnits)
  return {
    id: POLICY_ID,
    name: 'Responsible-play buy-in cap',
    scope: 'project',
    rules: [
      { name: 'allow-baseline', operation: '*', action: 'ALLOW', conditions: [] },
      {
        name: RULE_NAME,
        reason: DENY_REASON,
        operation: 'transfer',
        action: 'DENY',
        conditions: [({ params }) => BigInt(params?.amount ?? 0) > cap]
      }
    ]
  }
}

// Dry-run twin of WDK's PolicyViolationError — same identifying triple, so UI
// and tests treat both modes identically.
class LocalPolicyViolationError extends Error {
  constructor ({ policyId, ruleName, reason }) {
    super(`Policy violation: [${policyId}] rule "${ruleName}" — ${reason}`)
    this.name = 'PolicyViolationError'
    this.policyId = policyId
    this.ruleName = ruleName
    this.reason = reason
  }
}

function checkCapLocally (amount, maxBuyInBaseUnits) {
  if (BigInt(amount) > BigInt(maxBuyInBaseUnits)) {
    throw new LocalPolicyViolationError({ policyId: POLICY_ID, ruleName: RULE_NAME, reason: DENY_REASON })
  }
}

function isPolicyViolation (err) {
  return !!err && (err.name === 'PolicyViolationError' || err.constructor?.name === 'PolicyViolationError')
}

module.exports = { buildCapPolicy, checkCapLocally, isPolicyViolation, LocalPolicyViolationError, POLICY_ID, RULE_NAME, DENY_REASON }
