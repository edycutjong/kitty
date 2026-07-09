'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { isValidPrediction, canonicalPrediction, samePrediction, makeSalt, commitmentFor, verifyReveal } = require('../../src/core/commit')

const POT = 'ab'.repeat(32)
const W = 'cd'.repeat(32)
const SALT = '0123456789abcdef'
const PICK = { home: 2, away: 1 }

test('isValidPrediction accepts sane scorelines', () => {
  assert.ok(isValidPrediction({ home: 0, away: 0 }))
  assert.ok(isValidPrediction({ home: 99, away: 99 }))
})

test('isValidPrediction rejects negatives, floats, missing fields, junk', () => {
  assert.equal(isValidPrediction({ home: -1, away: 0 }), false)
  assert.equal(isValidPrediction({ home: 1.5, away: 0 }), false)
  assert.equal(isValidPrediction({ home: 1 }), false)
  assert.equal(isValidPrediction({ home: 100, away: 0 }), false)
  assert.equal(isValidPrediction(null), false)
  assert.equal(isValidPrediction('2-1'), false)
})

test('canonicalPrediction formats home-away', () => {
  assert.equal(canonicalPrediction(PICK), '2-1')
})

test('canonicalPrediction throws on invalid prediction', () => {
  assert.throws(() => canonicalPrediction({ home: -1, away: 2 }))
})

test('samePrediction compares by value', () => {
  assert.ok(samePrediction({ home: 2, away: 1 }, { home: 2, away: 1 }))
  assert.equal(samePrediction({ home: 2, away: 1 }, { home: 1, away: 2 }), false)
  assert.equal(samePrediction({ home: 2, away: 1 }, null), false)
})

test('makeSalt returns 16 bytes of hex, unique per call', () => {
  const s = makeSalt()
  assert.equal(s.length, 32)
  assert.notEqual(s, makeSalt())
})

test('commitmentFor is deterministic', () => {
  const a = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  const b = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  assert.equal(a, b)
  assert.equal(a.length, 64)
})

test('commitment changes when the prediction changes', () => {
  const a = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  const b = commitmentFor({ potId: POT, writer: W, prediction: { home: 1, away: 1 }, salt: SALT })
  assert.notEqual(a, b)
})

test('commitment changes when the salt changes (hiding)', () => {
  const a = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  const b = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: 'ffffffffffffffff' })
  assert.notEqual(a, b)
})

test('commitment is domain-separated by pot (no cross-pot replay)', () => {
  const a = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  const b = commitmentFor({ potId: 'ee'.repeat(32), writer: W, prediction: PICK, salt: SALT })
  assert.notEqual(a, b)
})

test('commitment is bound to the writer (no stealing a sealed pick)', () => {
  const a = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  const b = commitmentFor({ potId: POT, writer: 'ee'.repeat(32), prediction: PICK, salt: SALT })
  assert.notEqual(a, b)
})

test('commitmentFor rejects short salts', () => {
  assert.throws(() => commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: 'abcd' }))
})

test('verifyReveal accepts a correct opening', () => {
  const commitment = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  assert.ok(verifyReveal({ potId: POT, writer: W, prediction: PICK, salt: SALT, commitment }))
})

test('verifyReveal rejects a different prediction', () => {
  const commitment = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  assert.equal(verifyReveal({ potId: POT, writer: W, prediction: { home: 3, away: 1 }, salt: SALT, commitment }), false)
})

test('verifyReveal rejects a wrong salt', () => {
  const commitment = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  assert.equal(verifyReveal({ potId: POT, writer: W, prediction: PICK, salt: 'ffffffffffffffff', commitment }), false)
})

test('verifyReveal rejects another writer opening your commitment', () => {
  const commitment = commitmentFor({ potId: POT, writer: W, prediction: PICK, salt: SALT })
  assert.equal(verifyReveal({ potId: POT, writer: 'ee'.repeat(32), prediction: PICK, salt: SALT, commitment }), false)
})

test('verifyReveal never throws on malformed inputs', () => {
  assert.equal(verifyReveal({ potId: POT, writer: W, prediction: null, salt: SALT, commitment: 'ab' }), false)
  assert.equal(verifyReveal({ potId: POT, writer: W, prediction: PICK, salt: null, commitment: 'ab'.repeat(32) }), false)
  assert.equal(verifyReveal({}), false)
})
