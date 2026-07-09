'use strict'

// Reproducible benchmark — the numbers judges can re-run:
//   A. peer connect over a local DHT testnet (Hyperswarm discovery → first connection)
//   B. Autobase op convergence between two live peers (append → remote state reflects it)
//   C. partition recovery (peer offline while K ops land → reconnect → converged)
//
// No external network is used: the DHT testnet runs in-process, so results
// measure the stack, not your ISP. Run: npm run bench [-- --runs 20]

const fs = require('fs')
const os = require('os')
const path = require('path')
const createTestnet = require('hyperdht/testnet')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const b4a = require('b4a')

const { KittyPot } = require('../src/p2p/pot-base')
const { OP } = require('../src/core/constants')

const RUNS = Number(process.argv.includes('--runs') ? process.argv[process.argv.indexOf('--runs') + 1] : 10)
const BUY_IN = '20000000'

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kitty-bench-'))
}

function pct (sorted, p) {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, i)]
}

function stats (samples) {
  const s = [...samples].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return {
    n: s.length,
    p50: +pct(s, 50).toFixed(1),
    p95: +pct(s, 95).toFixed(1),
    mean: +mean.toFixed(1),
    min: +s[0].toFixed(1),
    max: +s[s.length - 1].toFixed(1)
  }
}

async function eventually (fn, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('bench: condition not met')
}

async function benchConnect (bootstrap) {
  const samples = []
  for (let i = 0; i < RUNS; i++) {
    const topic = b4a.alloc(32, i + 1)
    const a = new Hyperswarm({ bootstrap })
    const b = new Hyperswarm({ bootstrap })
    a.on('connection', c => c.on('error', () => {}))
    const connected = new Promise(resolve => b.once('connection', (c) => { c.on('error', () => {}); resolve() }))
    const t0 = process.hrtime.bigint()
    const disc = a.join(topic, { server: true, client: false })
    await disc.flushed()
    b.join(topic, { server: false, client: true })
    await connected
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
    await a.destroy()
    await b.destroy()
  }
  return stats(samples)
}

async function makePair () {
  const storeA = new Corestore(tmp())
  const storeB = new Corestore(tmp())
  const potA = await new KittyPot(storeA).ready()
  const potB = await new KittyPot(storeB, { bootstrap: potA.key }).ready()

  const connect = () => {
    const s1 = storeA.replicate(true)
    const s2 = storeB.replicate(false)
    s1.pipe(s2).pipe(s1)
    s1.on('error', () => {})
    s2.on('error', () => {})
    return () => { s1.destroy(); s2.destroy() }
  }

  let stop = connect()
  await potA.append({
    type: OP.OPEN_POT,
    potId: potA.keyHex,
    matchId: 'bench',
    teams: { home: 'BRA', away: 'ARG' },
    buyIn: BUY_IN,
    kickoffTs: Date.now() + 3600_000,
    chain: 'bench',
    ts: Date.now()
  })
  await potA.append({ type: OP.ADD_WRITER, key: potB.localKeyHex, name: 'peer-b', ts: Date.now() })
  await eventually(async () => { await potB.update(); return potB.writable })

  return {
    potA,
    potB,
    reconnect: () => { stop = connect() },
    disconnect: () => stop(),
    close: async () => { stop(); await potA.close(); await potB.close(); await storeA.close(); await storeB.close() }
  }
}

async function benchConvergence () {
  const pair = await makePair()
  const samples = []
  for (let i = 0; i < RUNS * 3; i++) {
    const marker = `bench-op-${i}`
    const t0 = process.hrtime.bigint()
    await pair.potA.append({ type: OP.ADD_WRITER, key: 'ff'.repeat(31) + (i % 100).toString(16).padStart(2, '0'), name: marker, ts: Date.now() })
    await eventually(async () => {
      const s = await pair.potB.state()
      return s.log.some(l => l.summary.startsWith(marker))
    })
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  await pair.close()
  return stats(samples)
}

async function benchPartitionRecovery () {
  const samples = []
  for (let i = 0; i < Math.max(3, Math.floor(RUNS / 2)); i++) {
    const pair = await makePair()
    pair.disconnect()
    for (let k = 0; k < 10; k++) {
      await pair.potA.append({ type: OP.ADD_WRITER, key: 'ee'.repeat(31) + k.toString(16).padStart(2, '0'), name: `offline-${i}-${k}`, ts: Date.now() })
    }
    const t0 = process.hrtime.bigint()
    pair.reconnect()
    await eventually(async () => {
      const [sa, sb] = [await pair.potA.state(), await pair.potB.state()]
      return sb.log.length === sa.log.length
    })
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6)
    await pair.close()
  }
  return stats(samples)
}

function printRow (name, s) {
  console.log(
    `${name.padEnd(34)} n=${String(s.n).padEnd(4)} p50=${String(s.p50).padStart(8)}ms  p95=${String(s.p95).padStart(8)}ms  mean=${String(s.mean).padStart(8)}ms  min=${s.min}ms  max=${s.max}ms`
  )
}

async function main () {
  console.log(`the-kitty bench — ${RUNS} base runs · node ${process.version} · ${os.platform()}/${os.arch()}`)
  console.log('local in-process DHT testnet; zero external network\n')

  const testnet = await createTestnet(3)
  const connect = await benchConnect(testnet.bootstrap)
  printRow('peer connect (swarm topic)', connect)

  const conv = await benchConvergence()
  printRow('autobase op convergence', conv)

  const part = await benchPartitionRecovery()
  printRow('partition recovery (10 ops)', part)

  await testnet.destroy()

  const results = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${os.platform()}/${os.arch()}`,
    runs: RUNS,
    peerConnectMs: connect,
    convergenceMs: conv,
    partitionRecoveryMs: part
  }
  fs.writeFileSync(path.join(__dirname, '..', 'bench-results.json'), JSON.stringify(results, null, 2))
  console.log('\nwrote bench-results.json')

  const pass = conv.p95 < 1000
  console.log(pass ? '✓ convergence p95 < 1s — PRD target met' : '✗ convergence p95 over 1s target')
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
