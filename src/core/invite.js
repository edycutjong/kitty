'use strict'

const z32 = require('z32')
const b4a = require('b4a')
const { hash, isHex } = require('./hash')

const PREFIX = 'pear://kitty/'

function encodeInvite (bootstrapKey) {
  const buf = b4a.isBuffer(bootstrapKey) ? bootstrapKey : b4a.from(bootstrapKey, 'hex')
  if (buf.length !== 32) throw new Error('bootstrap key must be 32 bytes')
  return PREFIX + z32.encode(buf)
}

function decodeInvite (invite) {
  if (typeof invite !== 'string') throw new Error('invite must be a string')
  const trimmed = invite.trim()
  const raw = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed
  const buf = z32.decode(raw)
  if (buf.length !== 32) throw new Error('invalid invite')
  return b4a.toString(buf, 'hex')
}

// Swarm topic is a hash of the bootstrap key, not the key itself — peers on
// the DHT learn a rendezvous point, never the pot's actual Autobase key.
function topicFor (bootstrapKeyHex) {
  if (!isHex(bootstrapKeyHex, 32)) throw new Error('invalid bootstrap key')
  return hash(`the-kitty/topic:${bootstrapKeyHex}`)
}

module.exports = { encodeInvite, decodeInvite, topicFor, PREFIX }
