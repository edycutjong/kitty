'use strict'

const { hashHex, randomHex, isHex } = require('./hash')
const { MAX_GOALS } = require('./constants')

const DOMAIN = 'kitty-pick:v1'

function isValidPrediction (p) {
  return (
    p !== null && typeof p === 'object' &&
    Number.isInteger(p.home) && Number.isInteger(p.away) &&
    p.home >= 0 && p.away >= 0 &&
    p.home <= MAX_GOALS && p.away <= MAX_GOALS
  )
}

function canonicalPrediction (p) {
  if (!isValidPrediction(p)) throw new Error('invalid prediction')
  return `${p.home}-${p.away}`
}

function samePrediction (a, b) {
  return isValidPrediction(a) && isValidPrediction(b) && a.home === b.home && a.away === b.away
}

function makeSalt () {
  return randomHex(16)
}

// Domain-separated commitment. Binding potId + writer prevents replaying a
// commitment across pots or claiming someone else's sealed pick as your own.
function commitmentFor ({ potId, writer, prediction, salt }) {
  if (!isHex(potId)) throw new Error('invalid potId')
  if (!isHex(writer)) throw new Error('invalid writer key')
  if (!isHex(salt) || salt.length < 16) throw new Error('salt must be ≥8 random bytes hex')
  return hashHex(`${DOMAIN}:${potId}:${writer}:${canonicalPrediction(prediction)}:${salt}`)
}

function verifyReveal ({ potId, writer, prediction, salt, commitment }) {
  if (!isValidPrediction(prediction)) return false
  if (!isHex(salt) || salt.length < 16) return false
  if (!isHex(commitment, 32)) return false
  try {
    return commitmentFor({ potId, writer, prediction, salt }) === commitment
  } catch {
    return false
  }
}

module.exports = { DOMAIN, isValidPrediction, canonicalPrediction, samePrediction, makeSalt, commitmentFor, verifyReveal }
