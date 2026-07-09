'use strict'

const sodium = require('sodium-universal')
const b4a = require('b4a')

// BLAKE2b-256 via sodium — identical bytes under Node and Bare, no node:crypto.
function hash (input) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.isBuffer(input) ? input : b4a.from(input, 'utf-8'))
  return out
}

function hashHex (input) {
  return b4a.toString(hash(input), 'hex')
}

function randomHex (bytes = 16) {
  const buf = b4a.alloc(bytes)
  sodium.randombytes_buf(buf)
  return b4a.toString(buf, 'hex')
}

const HEX_RE = /^[0-9a-f]+$/

function isHex (str, bytes = null) {
  if (typeof str !== 'string' || str.length === 0 || str.length % 2 !== 0) return false
  if (!HEX_RE.test(str)) return false
  if (bytes !== null && str.length !== bytes * 2) return false
  return true
}

module.exports = { hash, hashHex, randomHex, isHex }
