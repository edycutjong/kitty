'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { hash, hashHex, randomHex, isHex } = require('../../src/core/hash')

test('hashHex is deterministic for the same input', () => {
  assert.equal(hashHex('the-kitty'), hashHex('the-kitty'))
})

test('hashHex produces 32-byte (64-char) hex', () => {
  const h = hashHex('anything')
  assert.equal(h.length, 64)
  assert.match(h, /^[0-9a-f]+$/)
})

test('different inputs produce different hashes', () => {
  assert.notEqual(hashHex('pick:2-1'), hashHex('pick:1-2'))
})

test('hash accepts buffers and strings equivalently', () => {
  const b4a = require('b4a')
  assert.deepEqual(hash('x'), hash(b4a.from('x', 'utf-8')))
})

test('empty string hashes fine and differs from non-empty', () => {
  assert.equal(hashHex('').length, 64)
  assert.notEqual(hashHex(''), hashHex(' '))
})

test('randomHex returns requested byte length as hex', () => {
  assert.equal(randomHex(16).length, 32)
  assert.equal(randomHex(4).length, 8)
})

test('randomHex output is hex and non-repeating across calls', () => {
  const a = randomHex(16)
  const b = randomHex(16)
  assert.match(a, /^[0-9a-f]+$/)
  assert.notEqual(a, b)
})

test('isHex accepts lowercase hex of even length', () => {
  assert.ok(isHex('deadbeef'))
  assert.ok(isHex('00'))
})

test('isHex rejects odd length, uppercase, non-hex, empty, non-string', () => {
  assert.equal(isHex('abc'), false)
  assert.equal(isHex('DEADBEEF'), false)
  assert.equal(isHex('zz'), false)
  assert.equal(isHex(''), false)
  assert.equal(isHex(null), false)
  assert.equal(isHex(42), false)
})

test('isHex enforces exact byte length when given', () => {
  assert.ok(isHex('ab'.repeat(32), 32))
  assert.equal(isHex('ab'.repeat(31), 32), false)
  assert.equal(isHex('ab'.repeat(33), 32), false)
})
