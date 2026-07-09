'use strict'

// Real Hyperswarm path over an in-process DHT testnet (no external network):
// invite → topic discovery → pairing channel → auto-admission → convergence.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const createTestnet = require('hyperdht/testnet')
const { KittyNode } = require('../../src/p2p/node')
const { tmpDir, eventually } = require('./helpers')

const BUY_IN = '5000000'

test('invite + swarm + pairing admits a joiner with zero manual steps', async (t) => {
  const testnet = await createTestnet(3)
  t.after(() => testnet.destroy())

  const ana = new KittyNode(tmpDir(), { name: 'ana', bootstrap: testnet.bootstrap })
  await ana.ready()
  await ana.openPot({
    matchId: 'swarm-match',
    teams: { home: 'BRA', away: 'ARG' },
    buyIn: BUY_IN,
    kickoffTs: Date.now() + 3600_000
  })
  await ana.joinSwarm()

  const ben = new KittyNode(tmpDir(), { invite: ana.invite, name: 'ben', bootstrap: testnet.bootstrap })
  await ben.ready()
  await ben.joinSwarm()

  t.after(async () => { await ana.close(); await ben.close() })

  // pairing channel does the admission automatically
  await eventually(async () => {
    await ben.pot.update()
    return ben.writable
  }, { timeout: 30000 })

  const sb = await ben.state()
  assert.equal(sb.pot.matchId, 'swarm-match')
  assert.ok(sb.writers[ben.writerKey])
  assert.equal(sb.writers[ben.writerKey].name, 'ben')

  // and the admitted member can write straight away
  await ben.stake({ amount: BUY_IN, payoutAddress: 'addr-ben' })
  await eventually(async () => {
    const sa = await ana.state()
    return sa.stakes[ben.writerKey]
  }, { timeout: 30000 })

  assert.ok(ana.connections >= 1)
  assert.ok(ben.connections >= 1)
})
