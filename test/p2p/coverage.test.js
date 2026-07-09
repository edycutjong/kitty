'use strict'

// P2P surface the convergence/swarm suites don't reach: the discoveryKey
// getter, the re-announce loop, and the on-device sealed-secret conflict guard.
// (The pairing welcome/close methods are reserved and coverage-excluded in
// pairing.js — the live flow admits via the Autobase add-writer op.)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Corestore = require('corestore')

const { KittyPot, applyNodes } = require('../../src/p2p/pot-base')
const { KittyNode } = require('../../src/p2p/node')
const { tmpDir } = require('./helpers')

const BUY_IN = '20000000'

test('pot-base exposes a 32-byte discoveryKey once ready', async () => {
  const store = new Corestore(path.join(tmpDir(), 'store'))
  const pot = new KittyPot(store)
  await pot.ready()
  assert.ok(pot.discoveryKey)
  assert.equal(pot.discoveryKey.length, 32)
  await pot.close()
  await store.close()
})

test('requestJoinAll re-announces on every pairing and swallows a dead one', async (t) => {
  const node = new KittyNode(tmpDir(), { name: 'ana' })
  await node.ready()
  t.after(async () => { await node.close() })

  const seen = []
  node._pairings.add({ requestJoin: (info) => seen.push(info) })
  node._pairings.add({ requestJoin: () => { throw new Error('peer gone') } }) // must be swallowed
  node.requestJoinAll()

  assert.equal(seen.length, 1)
  assert.equal(seen[0].name, 'ana')
  assert.equal(seen[0].key, node.writerKey)
})

test('commitPick refuses when a sealed secret for this pot already exists on the device', async (t) => {
  const node = new KittyNode(tmpDir(), { name: 'ana' })
  await node.ready()
  t.after(async () => { await node.close() })

  const opened = await node.openPot({
    matchId: 'm', teams: { home: 'A', away: 'B' }, buyIn: BUY_IN, kickoffTs: Date.now() + 3600_000
  })
  assert.ok(opened.accepted)
  await node.stake({ amount: BUY_IN, payoutAddress: 'addr' })

  // A sealed secret for THIS pot is already on disk (e.g. still syncing) while
  // state.commits is empty — the device-local guard must refuse a fresh seal.
  node._saveSecret({ potId: node.pot.keyHex, prediction: { home: 1, away: 0 }, salt: 'ab'.repeat(16), commitment: 'cd'.repeat(32) })
  await assert.rejects(node.commitPick({ home: 2, away: 2 }), /already exists/)
})

test('pot-base: applyNodes skips a malformed (non-object) node value', async () => {
  let written = null
  const view = { get: async () => null, put: async (_k, v) => { written = v } }
  await applyNodes([{ value: null, from: { key: Buffer.alloc(32) }, length: 1 }], view, {})
  assert.ok(written && written.pot === null) // fresh state written, bad node skipped
})

test('pot-base: state() returns a fresh state when the view is empty', async () => {
  const store = new Corestore(path.join(tmpDir(), 'store'))
  const pot = new KittyPot(store)
  await pot.ready()
  assert.equal((await pot.state()).pot, null)
  await pot.close()
  await store.close()
})

test('node: commitPick before any pot is open throws', async (t) => {
  const node = new KittyNode(tmpDir(), { name: 'a' })
  await node.ready()
  t.after(async () => { await node.close() })
  await assert.rejects(node.commitPick({ home: 1, away: 0 }), /no pot open/)
})

test('node: revealPick with no sealed secret throws', async (t) => {
  const node = new KittyNode(tmpDir(), { name: 'a' })
  await node.ready()
  t.after(async () => { await node.close() })
  await assert.rejects(node.revealPick(), /no sealed pick/)
})

test('node: _handleJoinRequest guards — non-writable, no-pot, already-member, then admits', async (t) => {
  const creator = new KittyNode(tmpDir(), { name: 'creator' })
  await creator.ready()
  const joiner = new KittyNode(tmpDir(), { invite: creator.invite, name: 'joiner' })
  await joiner.ready()
  t.after(async () => { await creator.close(); await joiner.close() })

  await joiner._handleJoinRequest({ key: 'aa'.repeat(32), name: 'x' }) // non-writable → ignored
  await creator._handleJoinRequest({ key: 'aa'.repeat(32), name: 'x' }) // writable, no pot → ignored
  await creator.openPot({ matchId: 'm', teams: { home: 'A', away: 'B' }, buyIn: BUY_IN, kickoffTs: Date.now() + 3600_000 })
  await creator._handleJoinRequest({ key: creator.writerKey, name: 'dup' }) // already a member → ignored
  const before = Object.keys((await creator.state()).writers).length
  await creator._handleJoinRequest({ key: 'cc'.repeat(32), name: 'newbie' }) // fresh key → admitted
  assert.equal(Object.keys((await creator.state()).writers).length, before + 1)
})
