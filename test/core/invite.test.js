'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const { encodeInvite, decodeInvite, topicFor, PREFIX } = require('../../src/core/invite')

const KEY = 'ab'.repeat(32)

test('invite encodes to a pear://kitty/ link', () => {
  const invite = encodeInvite(KEY)
  assert.ok(invite.startsWith(PREFIX))
})

test('invite round-trips back to the bootstrap key', () => {
  assert.equal(decodeInvite(encodeInvite(KEY)), KEY)
})

test('decode accepts the bare z32 without the prefix', () => {
  const invite = encodeInvite(KEY)
  assert.equal(decodeInvite(invite.slice(PREFIX.length)), KEY)
})

test('decode trims whitespace (copy-paste friendliness)', () => {
  const invite = encodeInvite(KEY)
  assert.equal(decodeInvite(`  ${invite}\n`), KEY)
})

test('encode accepts a 32-byte buffer', () => {
  const invite = encodeInvite(b4a.from(KEY, 'hex'))
  assert.equal(decodeInvite(invite), KEY)
})

test('encode rejects wrong-length keys', () => {
  assert.throws(() => encodeInvite('abcd'))
})

test('decode rejects junk', () => {
  assert.throws(() => decodeInvite('pear://kitty/!!!!'))
  assert.throws(() => decodeInvite(12345))
})

test('topic is 32 bytes and differs from the bootstrap key (rendezvous privacy)', () => {
  const topic = topicFor(KEY)
  assert.equal(topic.length, 32)
  assert.notEqual(b4a.toString(topic, 'hex'), KEY)
})

test('topic derivation is deterministic', () => {
  assert.deepEqual(topicFor(KEY), topicFor(KEY))
})

test('different pots land on different topics', () => {
  assert.notDeepEqual(topicFor(KEY), topicFor('cd'.repeat(32)))
})
