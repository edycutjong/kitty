'use strict'

// The "there is no server" proof. Spins up THREE independent peers on an
// in-process DHT testnet, streams every network + Autobase event live to
// stdout, plays the whole flow — including one tampering attempt that gets
// rejected on screen — and asserts every protocol invariant at the end.
//
// Run: npm run verify:p2p

const fs = require('fs')
const os = require('os')
const path = require('path')
const createTestnet = require('hyperdht/testnet')
const { KittyNode } = require('../src/p2p/node')
const { KittyWallet } = require('../src/wallet/wallet')
const { OP } = require('../src/core/constants')
const selectors = require('../src/core/selectors')
const { formatUnits } = require('../src/core/split')

const BUY_IN = '20000000'
const t0 = Date.now()

function log (tag, msg) {
  const t = ((Date.now() - t0) / 1000).toFixed(2).padStart(6)
  console.log(`[${t}s] ${tag.padEnd(10)} ${msg}`)
}

function tmp (name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kitty-verify-${name}-`))
}

async function eventually (fn, timeout = 30000, what = 'condition') {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  throw new Error(`timeout waiting for ${what}`)
}

function wire (node, tag) {
  node.on('peer-add', n => log(tag, `⇄ connection open (${n} live) — Hyperswarm, no signaling server`))
  node.on('peer-remove', n => log(tag, `⇄ connection closed (${n} live)`))
  node.on('admitted', ({ name }) => log(tag, `+ admitted "${name}" via pairing channel`))
  node.on('append', type => log(tag, `→ append ${type} (signed into own Hypercore)`))
  node.on('update', () => log(tag, '⟳ autobase merge — view re-linearized'))
}

async function main () {
  console.log('the-kitty verify_p2p — 3 real peers, in-process DHT, zero servers, zero cloud\n')

  const testnet = await createTestnet(3)
  log('testnet', 'local DHT bootstrap up (in-process)')

  const ana = new KittyNode(tmp('ana'), { name: 'ana', bootstrap: testnet.bootstrap })
  await ana.ready()
  wire(ana, 'ana')

  const kickoffTs = Date.now() + 6000
  await ana.openPot({
    matchId: 'wc2026-final',
    teams: { home: 'Brazil', away: 'Argentina' },
    buyIn: BUY_IN,
    kickoffTs,
    chain: 'dry-run'
  })
  log('ana', `pot open — Brazil v Argentina, buy-in ${formatUnits(BUY_IN)} USD₮, kickoff T+6s`)
  log('ana', `invite: ${ana.invite}`)
  await ana.joinSwarm()

  const ben = new KittyNode(tmp('ben'), { invite: ana.invite, name: 'ben', bootstrap: testnet.bootstrap })
  await ben.ready()
  wire(ben, 'ben')
  await ben.joinSwarm()

  const cai = new KittyNode(tmp('cai'), { invite: ana.invite, name: 'cai', bootstrap: testnet.bootstrap })
  await cai.ready()
  wire(cai, 'cai')
  await cai.joinSwarm()

  await eventually(async () => { await ben.pot.update(); return ben.writable }, 30000, 'ben admission')
  await eventually(async () => { await cai.pot.update(); return cai.writable }, 30000, 'cai admission')
  log('verify', '✓ both joiners admitted with zero manual steps')

  // stakes: policy-checked pledges
  const wallets = {}
  for (const [node, tag] of [[ana, 'ana'], [ben, 'ben'], [cai, 'cai']]) {
    wallets[tag] = await new KittyWallet({ seedPhrase: `${tag} `.repeat(11) + tag, maxBuyIn: '100000000' }).ready()
    const verdict = await wallets[tag].simulateStake(BUY_IN)
    log(tag, `WDK Transaction Policy verdict: ${verdict.decision}`)
    await node.stake({ amount: BUY_IN, payoutAddress: await wallets[tag].getAddress(), real: false })
  }

  // sealed picks — ana wins later, ben misses, cai "forgets" (tests refunds path? no: 2 picks + late cheat)
  await ana.commitPick({ home: 2, away: 1 })
  log('ana', 'pick sealed (commit — salt stays on device)')
  await ben.commitPick({ home: 0, away: 0 })
  log('ben', 'pick sealed')

  await eventually(async () => {
    const [sa, sb, sc] = await Promise.all([ana.state(), ben.state(), cai.state()])
    return [sa, sb, sc].every(s => Object.keys(s.commits).length === 2 && Object.keys(s.stakes).length === 3)
  }, 30000, 'pre-kickoff convergence')
  log('verify', '✓ all 3 peers converged on identical pre-kickoff state')

  const wait = kickoffTs - Date.now()
  if (wait > 0) {
    log('clock', `waiting ${(wait / 1000).toFixed(1)}s for kickoff…`)
    await new Promise(resolve => setTimeout(resolve, wait + 300))
  }

  await ana.snapshot()
  await ben.snapshot()
  await cai.snapshot()
  log('verify', '🔒 kickoff — members witnessed each other\'s logs (back-dating defence armed)')

  // cai tries to sneak a back-dated winning pick AFTER kickoff
  await cai.append({ type: OP.COMMIT_PICK, commitment: 'ab'.repeat(32), ts: kickoffTs - 1 })
  log('cai', '⚠ tampering attempt: back-dated commit appended after kickoff')

  await ana.revealPick()
  await ben.revealPick()
  log('verify', 'picks revealed and hash-checked against sealed commitments')

  await ana.voteResult({ home: 2, away: 1 })
  await ben.voteResult({ home: 2, away: 1 })
  await eventually(async () => (await cai.state()).result, 30000, 'quorum finality')
  log('verify', '✓ result 2–1 finalized by quorum (2 of 3 stakers)')

  // settle: losers pay winners directly
  for (const [node, tag] of [[ben, 'ben'], [cai, 'cai']]) {
    const owed = await node.owed()
    if (owed.length === 0) continue
    const transfers = await wallets[tag].settlePlan(owed)
    await node.settle(transfers)
    for (const tr of transfers) log(tag, `paid ${formatUnits(tr.amount)} USD₮ → ${tr.to.slice(0, 8)}… tx ${tr.txid.slice(0, 18)}…`)
  }

  await eventually(async () => (await ana.state()).status === 'settled', 30000, 'settlement')

  // ── invariant assertions ──
  const states = await Promise.all([ana.state(), ben.state(), cai.state()])
  const sums = states.map(s => JSON.stringify(selectors.summarize(s, kickoffTs + 60000)))
  const identical = sums.every(x => x === sums[0])
  const s = states[0]
  const acct = selectors.verifyAccounting(s)
  const winners = selectors.winners(s)
  const caiKey = cai.writerKey
  const caiRejected = s.log.some(l => l.writer === caiKey && l.type === OP.COMMIT_PICK && !l.accepted) ||
    !selectors.eligibility(s, caiKey).witnessed

  console.log('\n══ INVARIANT REPORT ═══════════════════════════════')
  console.log(`  identical state on all 3 peers      ${identical ? '✓' : '✗'}`)
  console.log(`  Σ payouts == Σ stakes (${formatUnits(acct.paid)} == ${formatUnits(acct.pool)})  ${acct.holds ? '✓' : '✗'}`)
  console.log(`  winner set == [ana]                 ${winners.length === 1 && winners[0] === ana.writerKey ? '✓' : '✗'}`)
  console.log(`  back-dated pick neutralized         ${caiRejected ? '✓' : '✗'}`)
  console.log(`  pot settled, peer-to-peer           ${s.status === 'settled' ? '✓' : '✗'}`)
  console.log('═══════════════════════════════════════════════════')

  const ok = identical && acct.holds && winners.length === 1 && winners[0] === ana.writerKey && caiRejected && s.status === 'settled'

  await ana.close(); await ben.close(); await cai.close()
  await testnet.destroy()

  console.log(ok ? '\nALL INVARIANTS HELD — no server was harmed (or used) in this demo.' : '\nINVARIANT VIOLATION — see report above')
  process.exit(ok ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
