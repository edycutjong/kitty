'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { KittyNode } = require('../../src/p2p/node')
const { OP } = require('../../src/core/constants')
const { tmpDir, replicate, eventually, waitUntil } = require('./helpers')

const BUY_IN = '20000000'

async function makeCreator (name = 'ana') {
  const node = new KittyNode(tmpDir(), { name })
  await node.ready()
  return node
}

async function makeJoiner (invite, name) {
  const node = new KittyNode(tmpDir(), { invite, name })
  await node.ready()
  return node
}

test('two peers converge on identical pot state over a replicated stream', async (t) => {
  const ana = await makeCreator()
  const ben = await makeJoiner(ana.invite, 'ben')
  t.after(async () => { await ana.close(); await ben.close() })

  const stop = replicate(ana.store, ben.store)
  t.after(stop)

  await ana.openPot({
    matchId: 'wc2026-final',
    teams: { home: 'Brazil', away: 'Argentina' },
    buyIn: BUY_IN,
    kickoffTs: Date.now() + 3600_000
  })

  // creator admits ben (over the wire this comes from the pairing channel)
  await ana.append({ type: OP.ADD_WRITER, key: ben.writerKey, name: 'ben' })

  await eventually(async () => {
    await ben.pot.update()
    return ben.writable
  })

  const [sa, sb] = [await ana.state(), await ben.state()]
  assert.equal(sa.pot.matchId, 'wc2026-final')
  assert.deepEqual(sa.pot, sb.pot)
  assert.deepEqual(Object.keys(sb.writers).sort(), [ana.writerKey, ben.writerKey].sort())
})

test('writes from both sides merge into one deterministic view', async (t) => {
  const ana = await makeCreator()
  const ben = await makeJoiner(ana.invite, 'ben')
  t.after(async () => { await ana.close(); await ben.close() })
  const stop = replicate(ana.store, ben.store)
  t.after(stop)

  await ana.openPot({
    matchId: 'm1',
    teams: { home: 'BRA', away: 'ARG' },
    buyIn: BUY_IN,
    kickoffTs: Date.now() + 3600_000
  })
  await ana.append({ type: OP.ADD_WRITER, key: ben.writerKey, name: 'ben' })
  await eventually(async () => { await ben.pot.update(); return ben.writable })

  await ana.stake({ amount: BUY_IN, payoutAddress: 'addr-ana' })
  await ben.stake({ amount: BUY_IN, payoutAddress: 'addr-ben' })

  await eventually(async () => {
    const [sa, sb] = [await ana.state(), await ben.state()]
    return Object.keys(sa.stakes).length === 2 && Object.keys(sb.stakes).length === 2
  })

  const [sa, sb] = [await ana.state(), await ben.state()]
  assert.deepEqual(sa.stakes, sb.stakes)
  assert.deepEqual(sa.log.length, sb.log.length)
})

test('a non-admitted stranger cannot write into the pot', async (t) => {
  const ana = await makeCreator()
  const eve = await makeJoiner(ana.invite, 'eve')
  t.after(async () => { await ana.close(); await eve.close() })
  const stop = replicate(ana.store, eve.store)
  t.after(stop)

  await ana.openPot({
    matchId: 'm2',
    teams: { home: 'BRA', away: 'ARG' },
    buyIn: BUY_IN,
    kickoffTs: Date.now() + 3600_000
  })

  await eventually(async () => {
    const s = await eve.state()
    return s.pot !== null
  })

  // eve replicates and can READ the pot, but has never been admitted
  assert.equal(eve.writable, false)
  await assert.rejects(eve.stake({ amount: BUY_IN, payoutAddress: 'addr-eve' }))
})

test('a second pick on the same device is refused before it can damage the sealed salt', async (t) => {
  const ana = await makeCreator()
  t.after(async () => { await ana.close() })
  await ana.openPot({
    matchId: 'm3',
    teams: { home: 'BRA', away: 'ARG' },
    buyIn: BUY_IN,
    kickoffTs: Date.now() + 3600_000
  })
  await ana.stake({ amount: BUY_IN, payoutAddress: 'addr-ana' })
  const first = await ana.commitPick({ home: 2, away: 1 })
  assert.ok(first.accepted)
  // retyping `pick` must NOT overwrite the salt of the accepted commitment —
  // that would make the original commitment unrevealable forever
  await assert.rejects(ana.commitPick({ home: 0, away: 0 }), /already sealed|already exists/)
  const secret = ana._loadSecret()
  assert.equal(secret.commitment, first.commitment)
  assert.deepEqual(secret.prediction, { home: 2, away: 1 })
})

test('concurrent pick attempts cannot interleave — exactly one seals, salt survives', async (t) => {
  const ana = await makeCreator()
  t.after(async () => { await ana.close() })
  await ana.openPot({
    matchId: 'm4',
    teams: { home: 'BRA', away: 'ARG' },
    buyIn: BUY_IN,
    kickoffTs: Date.now() + 3600_000
  })
  await ana.stake({ amount: BUY_IN, payoutAddress: 'addr-ana' })
  // a double-click / piped-input race: both fired before either applied
  const results = await Promise.allSettled([
    ana.commitPick({ home: 2, away: 1 }),
    ana.commitPick({ home: 0, away: 0 })
  ])
  const ok = results.filter(r => r.status === 'fulfilled' && r.value.accepted)
  assert.equal(ok.length, 1, 'exactly one pick seals')
  const state = await ana.state()
  const secret = ana._loadSecret()
  assert.equal(state.commits[ana.writerKey].commitment, ok[0].value.commitment)
  assert.equal(secret.commitment, ok[0].value.commitment, 'stored salt matches the accepted commitment')
})

test('full flow across two live peers: stake → seal → lock → reveal → quorum → settle plan', async (t) => {
  const ana = await makeCreator()
  const ben = await makeJoiner(ana.invite, 'ben')
  t.after(async () => { await ana.close(); await ben.close() })
  const stop = replicate(ana.store, ben.store)
  t.after(stop)

  const kickoffTs = Date.now() + 2500
  await ana.openPot({
    matchId: 'wc2026-final',
    teams: { home: 'Brazil', away: 'Argentina' },
    buyIn: BUY_IN,
    kickoffTs
  })
  await ana.append({ type: OP.ADD_WRITER, key: ben.writerKey, name: 'ben' })
  await eventually(async () => { await ben.pot.update(); return ben.writable })

  await ana.stake({ amount: BUY_IN, payoutAddress: 'addr-ana' })
  await ben.stake({ amount: BUY_IN, payoutAddress: 'addr-ben' })
  await ana.commitPick({ home: 2, away: 1 }) // ana will win
  await ben.commitPick({ home: 0, away: 0 })

  // both sides must SEE both sealed picks before kickoff for witnessing
  await eventually(async () => {
    const [sa, sb] = [await ana.state(), await ben.state()]
    return Object.keys(sa.commits).length === 2 && Object.keys(sb.commits).length === 2
  })

  await waitUntil(kickoffTs) // ⏱ kickoff — picks lock

  await ana.snapshot()
  await ben.snapshot()

  // the money shot: post-kickoff commit attempt is rejected by the reducer
  await ben.append({ type: OP.COMMIT_PICK, commitment: 'ab'.repeat(32) })
  await eventually(async () => {
    const s = await ana.state()
    return s.log.some(l => l.writer === ben.writerKey && l.type === OP.COMMIT_PICK && !l.accepted)
  })

  await ana.revealPick()
  await ben.revealPick()
  await ana.voteResult({ home: 2, away: 1 })
  await ben.voteResult({ home: 2, away: 1 })

  await eventually(async () => {
    const [sa, sb] = [await ana.state(), await ben.state()]
    return sa.result && sb.result
  })

  const [suma, sumb] = [await ana.summary(), await ben.summary()]
  assert.deepEqual(suma.result.score, { home: 2, away: 1 })
  assert.deepEqual(suma.splits, sumb.splits)
  assert.ok(suma.accounting.holds, 'Σ payouts == Σ stakes')

  // settlement plan: ben (loser) owes ana (winner) exactly the buy-in
  const owed = await ben.owed()
  assert.equal(owed.length, 1)
  assert.equal(owed[0].to, ana.writerKey)
  assert.equal(owed[0].amount, BUY_IN)

  await ben.settle(owed.map((o, i) => ({ to: o.to, amount: o.amount, txid: `SIMTX-${i}` })))
  await eventually(async () => {
    const s = await ana.state()
    return s.status === 'settled'
  })
  assert.equal((await ben.state()).status, 'settled')
})
