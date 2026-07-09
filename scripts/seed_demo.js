'use strict'

// Deterministic demo story — the exact same pot every run, engineered around
// one devastating beat: Cai's post-kickoff "back-dated" pick is caught and
// neutralized while the honest winner gets paid.
//
//   Ana  seals 2–1  (the final score — she wins)
//   Ben  seals 0–0  (honest loser)
//   Cai  stakes, then tries to sneak a winning pick in AFTER kickoff
//
// Output: demo/seed-state.json + a printed summary for screenshots.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { KittyNode } = require('../src/p2p/node')
const { KittyWallet } = require('../src/wallet/wallet')
const { OP } = require('../src/core/constants')
const selectors = require('../src/core/selectors')
const { formatUnits } = require('../src/core/split')

const BUY_IN = '20000000'

function tmp (name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kitty-seed-${name}-`))
}

function replicate (a, b) {
  const s1 = a.store.replicate(true)
  const s2 = b.store.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
}

async function eventually (fn, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  throw new Error('seed: condition not met')
}

async function main () {
  const ana = await new KittyNode(tmp('ana'), { name: 'ana' }).ready()
  const ben = await new KittyNode(tmp('ben'), { invite: ana.invite, name: 'ben' }).ready()
  const cai = await new KittyNode(tmp('cai'), { invite: ana.invite, name: 'cai' }).ready()
  replicate(ana, ben)
  replicate(ana, cai)
  replicate(ben, cai)

  const kickoffTs = Date.now() + 1500
  await ana.openPot({ matchId: 'wc2026-final', teams: { home: 'Brazil', away: 'Argentina' }, buyIn: BUY_IN, kickoffTs, chain: 'dry-run' })
  await ana.append({ type: OP.ADD_WRITER, key: ben.writerKey, name: 'ben' })
  await ana.append({ type: OP.ADD_WRITER, key: cai.writerKey, name: 'cai' })
  await eventually(async () => { await ben.pot.update(); await cai.pot.update(); return ben.writable && cai.writable })

  const seeds = {
    ana: 'ana '.repeat(11) + 'ana',
    ben: 'ben '.repeat(11) + 'ben',
    cai: 'cai '.repeat(11) + 'cai'
  }
  const wallets = {}
  for (const [node, tag] of [[ana, 'ana'], [ben, 'ben'], [cai, 'cai']]) {
    wallets[tag] = await new KittyWallet({ seedPhrase: seeds[tag] }).ready()
    await node.stake({ amount: BUY_IN, payoutAddress: await wallets[tag].getAddress(), real: false })
  }

  await ana.commitPick({ home: 2, away: 1 })
  await ben.commitPick({ home: 0, away: 0 })
  await eventually(async () => {
    const s = await cai.state()
    return Object.keys(s.commits).length === 2 && Object.keys(s.stakes).length === 3
  })

  await new Promise(resolve => setTimeout(resolve, Math.max(0, kickoffTs - Date.now()) + 200))
  await ana.snapshot()
  await ben.snapshot()
  await cai.snapshot()

  // the cheat: back-dated commit after kickoff (unwitnessed ⇒ neutralized)
  await cai.append({ type: OP.COMMIT_PICK, commitment: 'ab'.repeat(32), ts: kickoffTs - 1 })

  await ana.revealPick()
  await ben.revealPick()
  await ana.voteResult({ home: 2, away: 1 })
  await ben.voteResult({ home: 2, away: 1 })
  await eventually(async () => (await cai.state()).result)

  for (const [node, tag] of [[ben, 'ben'], [cai, 'cai']]) {
    const owed = await node.owed()
    if (owed.length === 0) continue
    const transfers = await wallets[tag].settlePlan(owed)
    await node.settle(transfers)
  }
  await eventually(async () => (await ana.state()).status === 'settled')

  const state = await ana.state()
  const sum = selectors.summarize(state)

  fs.mkdirSync(path.join(__dirname, '..', 'demo'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '..', 'demo', 'seed-state.json'), JSON.stringify({ state, summary: sum }, null, 2))

  console.log('demo pot seeded — the canonical story:')
  console.log(`  pool     ${sum.poolPretty}`)
  console.log(`  result   ${sum.result.score.home}–${sum.result.score.away} (quorum ${sum.quorum})`)
  console.log(`  winner   ana → receives ${formatUnits(sum.splits.find(s => s.writer === ana.writerKey).amount)} USD₮`)
  console.log(`  cheat    cai's back-dated pick: witnessed=${selectors.eligibility(state, cai.writerKey).witnessed} ⇒ not eligible`)
  console.log(`  Σ check  ${formatUnits(sum.accounting.paid)} == ${formatUnits(sum.accounting.pool)} ${sum.accounting.holds ? '✓' : '✗'}`)
  console.log(`  status   ${state.status}`)
  console.log('\nwrote demo/seed-state.json')

  await ana.close(); await ben.close(); await cai.close()
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
