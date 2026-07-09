#!/usr/bin/env node
'use strict'

// The Kitty CLI — the whole flow in two terminals. `create` and `join` start
// a live interactive session (the corestore is single-process, so the session
// IS the app); every protocol action is a command inside it.

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { KittyNode } = require('../src/p2p/node')
const { KittyWallet } = require('../src/wallet/wallet')
const { isPolicyViolation } = require('../src/wallet/policy')
const { parseUnits, formatUnits } = require('../src/core/split')

const G = '\x1b[32m' // USD₮ green
const Y = '\x1b[33m' // pot gold
const R = '\x1b[31m'
const D = '\x1b[2m'
const B = '\x1b[1m'
const X = '\x1b[0m'

const HELP = `
${B}the-kitty${X} — serverless, self-custodial match-prediction pot (no server, no house)

USAGE
  kitty create --dir <dir> --name <you> --match "Brazil vs Argentina" --buy-in 20 --kickoff +10m [--real]
  kitty join <pear://kitty/…> --dir <dir> --name <you> [--real]

Once the session is live, type commands at the ${G}kitty>${X} prompt:

  invite            show the pot invite link (share it with your mates)
  stake             pledge the buy-in (runs the WDK policy check first)
  pick 2-1          seal your prediction (commit — salt never leaves this device)
  snapshot          witness everyone's logs at kickoff (also happens automatically)
  reveal            open your sealed pick (after kickoff)
  result 2-1        vote the final score (quorum of stakers finalizes)
  settle            pay what you owe, peer-to-peer (gasless USD₮ / dry-run)
  status            pot summary: members, pool, picks, result, splits
  ledger            the append-only op log incl. rejected tampering attempts
  balance           wallet address + balance
  help · quit

MODES
  default = dry-run (honest simulation, DRYRUN- tx ids, zero setup)
  --real  = Solana devnet via @tetherto/wdk (needs a funded devnet wallet)

OFFLINE VENUES
  --bootstrap host:port[,host:port]   use a local DHT instead of the public one
  (start one with: node scripts/local_dht.js — demo insurance for hostile wifi)
`

function parseArgs (argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        args[key] = true
      } else {
        args[key] = next
        i++
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

function parseKickoff (spec) {
  if (!spec) return Date.now() + 10 * 60_000
  const rel = /^\+(\d+)([smh])$/.exec(spec)
  if (rel) {
    const mult = { s: 1000, m: 60_000, h: 3600_000 }[rel[2]]
    return Date.now() + Number(rel[1]) * mult
  }
  const abs = Date.parse(spec)
  if (Number.isNaN(abs)) throw new Error(`cannot parse kickoff time: ${spec}`)
  return abs
}

function parseScore (str) {
  const m = /^(\d{1,2})[-:](\d{1,2})$/.exec(String(str).trim())
  if (!m) throw new Error('score must look like 2-1')
  return { home: Number(m[1]), away: Number(m[2]) }
}

function shortKey (hex) {
  return hex.slice(0, 8) + '…'
}

async function loadWallet (dir, real, maxBuyIn) {
  const seedPath = path.join(dir, 'wallet-seed.txt')
  let seed
  if (fs.existsSync(seedPath)) {
    seed = fs.readFileSync(seedPath, 'utf-8').trim()
  } else {
    seed = await KittyWallet.randomSeedPhrase()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(seedPath, seed + '\n', { mode: 0o600 })
  }
  const wallet = new KittyWallet({
    mode: real ? 'real' : 'dry-run',
    seedPhrase: seed,
    rpcUrl: process.env.KITTY_RPC_URL || undefined,
    token: process.env.KITTY_TOKEN_MINT || null,
    maxBuyIn: maxBuyIn || process.env.KITTY_MAX_BUY_IN || '100000000'
  })
  await wallet.ready()
  return wallet
}

function printSummary (sum) {
  if (!sum.pot) {
    console.log(`${D}no pot yet${X}`)
    return
  }
  const k = sum.pot
  console.log(`\n${B}${k.teams.home} v ${k.teams.away}${X}  ${D}(${k.matchId})${X}`)
  console.log(`status ${B}${sum.status}${X} · kickoff ${new Date(k.kickoffTs).toLocaleTimeString()} · buy-in ${Y}${formatUnits(k.buyIn)} USD₮${X} · pool ${Y}${sum.poolPretty}${X} · quorum ${sum.quorum}`)
  console.log(`${D}pot ${k.potId.slice(0, 12)}… · chain ${k.chain} · witnessing ${k.witnessRule}${X}`)
  for (const m of sum.members) {
    const flags = [
      m.staked ? `${G}staked${X}` : `${D}unstaked${X}`,
      m.committed ? (m.witnessed ? `${G}sealed✓${X}` : `${Y}sealed?unwitnessed${X}`) : `${D}no pick${X}`,
      m.revealed ? `${G}revealed${X}` : '',
      m.voted ? 'voted' : '',
      m.paid ? `${G}paid${X}` : ''
    ].filter(Boolean).join(' · ')
    const pick = m.prediction ? ` ${B}${m.prediction.home}–${m.prediction.away}${X}` : ''
    console.log(`  ${m.name.padEnd(12)} ${D}${shortKey(m.key)}${X}${pick}  ${flags}`)
  }
  if (sum.result) {
    console.log(`result ${B}${sum.result.score.home}–${sum.result.score.away}${X} (${sum.result.confirmations.length} confirmations)`)
    console.log(`split mode ${B}${sum.splitMode}${X} · ${G}Σ paid ${formatUnits(sum.accounting.paid)} == Σ staked ${formatUnits(sum.accounting.pool)} ${sum.accounting.holds ? '✓' : '✗ BROKEN'}${X}`)
    for (const s of sum.splits) console.log(`  ${shortKey(s.writer)} receives ${Y}${s.pretty} USD₮${X}`)
    for (const t of sum.settlement.owes || []) console.log(`  ${D}${shortKey(t.from)} owes ${shortKey(t.to)} ${formatUnits(t.amount)} USD₮${X}`)
  }
  console.log(`${D}ledger: ${sum.logLength} ops, ${sum.rejected} rejected${X}\n`)
}

function printLedger (state) {
  for (const l of state.log) {
    const when = l.ts ? new Date(l.ts).toLocaleTimeString() : '—'
    const line = `${when}  ${shortKey(l.writer)} ${l.type.padEnd(17)} ${l.summary}`
    if (l.accepted) console.log(`  ${G}✓${X} ${line}`)
    else console.log(`  ${R}✗ ${line} ${B}[rejected: ${l.reason}]${X}`)
  }
}

async function main () {
  const [cmd, ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)

  if (!cmd || cmd === 'help' || args.help) {
    console.log(HELP)
    return
  }
  if (cmd !== 'create' && cmd !== 'join') {
    console.log(HELP)
    process.exitCode = 1
    return
  }

  const dir = args.dir || '.kitty'
  const name = args.name || process.env.USER || 'anon'
  const real = !!args.real
  const invite = cmd === 'join' ? args._[0] : null
  if (cmd === 'join' && !invite) throw new Error('join needs an invite: kitty join <pear://kitty/…>')

  console.log(`${D}storage ${dir} · mode ${real ? 'REAL devnet' : 'dry-run'}${X}`)
  const wallet = await loadWallet(dir, real, args['max-buy-in'] && parseUnits(args['max-buy-in']).toString())
  const address = await wallet.getAddress()
  console.log(`wallet ${G}${address}${X} ${wallet.isReal ? '(self-custodial, Solana devnet)' : `${D}(dry-run)${X}`}`)

  const bootstrap = args.bootstrap
    ? String(args.bootstrap).split(',').map(s => {
      const [host, port] = s.trim().split(':')
      return { host, port: Number(port) }
    })
    : null
  if (bootstrap) console.log(`${D}using local DHT bootstrap ${args.bootstrap}${X}`)

  const node = new KittyNode(dir, { invite, name, bootstrap })
  await node.ready()

  node.on('peer-add', n => console.log(`${D}⇄ peer connected (${n} live)${X}`))
  node.on('peer-remove', n => console.log(`${D}⇄ peer left (${n} live)${X}`))
  node.on('admitted', ({ name: who }) => console.log(`${G}+ admitted ${who} to the pot${X}`))
  node.on('update', () => {}) // state converges in the background

  // Relaunching on existing storage RESUMES the pot — never re-opens it.
  const existing = await node.state()
  if (existing.pot) {
    const k = existing.pot
    console.log(`\n${B}resuming pot:${X} ${k.teams.home} v ${k.teams.away} · buy-in ${Y}${formatUnits(k.buyIn)} USD₮${X} · kickoff ${new Date(k.kickoffTs).toLocaleTimeString()}`)
    console.log(`invite your mates:\n  ${G}${node.invite}${X}\n`)
  } else if (cmd === 'create') {
    const [home, away] = String(args.match || 'Home vs Away').split(/\s+vs?\.?\s+/i)
    const buyIn = parseUnits(String(args['buy-in'] || '20')).toString()
    const kickoffTs = parseKickoff(args.kickoff)
    const out = await node.openPot({
      matchId: args['match-id'] || `match-${Date.now()}`,
      teams: { home: home || 'Home', away: away || 'Away' },
      buyIn,
      kickoffTs,
      chain: real ? 'solana-devnet' : 'dry-run',
      quorum: args.quorum ? Number(args.quorum) : undefined,
      witnessRule: args['witness-rule']
    })
    if (!out.accepted) throw new Error(`could not open pot: ${out.reason}`)
    console.log(`\n${B}pot open:${X} ${home} v ${away} · buy-in ${Y}${formatUnits(buyIn)} USD₮${X} · kickoff ${new Date(kickoffTs).toLocaleTimeString()}`)
    console.log(`invite your mates:\n  ${G}${node.invite}${X}\n`)
  } else {
    console.log(`joining pot ${D}${invite.slice(0, 40)}…${X}`)
  }

  await node.joinSwarm()
  console.log(`${D}swarm joined — no server anywhere, peers find each other by topic${X}`)

  if (cmd === 'join' && !node.writable) {
    node.requestJoinAll()
    const t = setInterval(() => { if (!node.writable) node.requestJoinAll() }, 1000)
    const wait = setInterval(async () => {
      await node.pot.update()
      if (node.writable) {
        clearInterval(t)
        clearInterval(wait)
        console.log(`${G}you're in — a member admitted your key${X}`)
      }
    }, 300)
  }

  // honest-client behavior: witness everyone automatically at kickoff
  let snapshotTimer = null
  const armSnapshot = async () => {
    const state = await node.state()
    if (!state.pot || snapshotTimer) return
    const delay = Math.max(0, state.pot.kickoffTs - Date.now()) + 500
    snapshotTimer = setTimeout(async () => {
      try {
        const s = await node.state()
        if (!s.snapshots[node.writerKey] && !s.result) {
          await node.snapshot()
          console.log(`${G}🔒 kickoff — picks locked; you witnessed ${Object.keys(s.writers).length} member logs${X}`)
        }
      } catch {}
    }, delay)
  }
  await armSnapshot()
  node.on('update', armSnapshot)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${G}kitty>${X} ` })
  rl.prompt()

  // Commands run strictly one-at-a-time: protocol actions must apply in the
  // order they were typed, even when input arrives faster than a human types
  // (pipes, pastes) — concurrent handlers could interleave appends.
  let queue = Promise.resolve()
  rl.on('line', (line) => {
    queue = queue.then(() => handleCommand(line)).then(() => { try { rl.prompt() } catch {} })
  })

  async function handleCommand (line) {
    const [c, ...a] = line.trim().split(/\s+/)
    try {
      switch (c) {
        case '': break
        case 'invite':
          console.log(`  ${G}${node.invite}${X}`)
          break
        case 'stake': {
          const state = await node.state()
          if (!state.pot) throw new Error('no pot yet — wait for sync')
          const amount = state.pot.buyIn
          const verdict = await wallet.simulateStake(amount)
          if (verdict.decision === 'DENY') {
            console.log(`  ${R}✗ PolicyViolationError — ${verdict.reason} [${verdict.policyId}/${verdict.ruleName}]${X}`)
            break
          }
          console.log(`  ${G}✓ Transaction Policy: ALLOW (cap respected)${X}`)
          const out = await node.stake({ amount, payoutAddress: address, real: wallet.isReal })
          if (!out.accepted) { console.log(`  ${R}✗ rejected: ${out.reason}${X}`); break }
          console.log(`  ${Y}pledged ${formatUnits(amount)} USD₮${X} — settles peer-to-peer at full-time`)
          break
        }
        case 'pick': {
          const prediction = parseScore(a[0])
          const out = await node.commitPick(prediction)
          if (!out.accepted) { console.log(`  ${R}✗ rejected: ${out.reason}${X}`); break }
          console.log(`  ${G}pick sealed${X} ${D}${out.commitment.slice(0, 16)}… (salt stays on this device until reveal)${X}`)
          break
        }
        case 'snapshot': {
          const out = await node.snapshot()
          if (!out.accepted) { console.log(`  ${R}✗ rejected: ${out.reason}${X}`); break }
          console.log(`  ${G}witnessed ${Object.keys(out.heads).length} member logs at kickoff${X}`)
          break
        }
        case 'reveal': {
          const out = await node.revealPick()
          if (!out.accepted) { console.log(`  ${R}✗ rejected: ${out.reason}${X}`); break }
          console.log(`  ${G}revealed ${out.prediction.home}–${out.prediction.away}${X} — hash-checked against your sealed commitment`)
          break
        }
        case 'result': {
          const score = parseScore(a[0])
          const out = await node.voteResult(score)
          if (!out.accepted) { console.log(`  ${R}✗ rejected: ${out.reason}${X}`); break }
          console.log(`  voted ${score.home}–${score.away} — finalizes at quorum of stakers`)
          break
        }
        case 'settle': {
          const owed = await node.owed()
          if (owed.length === 0) {
            console.log(`  ${D}nothing owed — you won, broke even, or already settled${X}`)
            break
          }
          const transfers = await wallet.settlePlan(owed)
          const out = await node.settle(transfers)
          if (!out.accepted) { console.log(`  ${R}✗ rejected: ${out.reason}${X}`); break }
          for (const t of transfers) {
            const link = wallet.explorerLink(t.txid)
            console.log(`  ${Y}paid ${formatUnits(t.amount)} USD₮${X} → ${shortKey(t.to)}  tx ${t.txid}${link ? `\n    ${D}${link}${X}` : ''}`)
          }
          break
        }
        case 'status':
          printSummary(await node.summary())
          break
        case 'ledger':
          printLedger(await node.state())
          break
        case 'balance': {
          const b = await wallet.getBalance()
          console.log(`  ${address}\n  native ${b.native} · token ${b.token ?? '—'} ${b.real ? '' : `${D}(dry-run)${X}`}`)
          break
        }
        case 'help':
          console.log(HELP)
          break
        case 'quit':
        case 'exit':
          rl.close()
          return
        default:
          console.log(`  ${D}unknown command "${c}" — try help${X}`)
      }
    } catch (err) {
      if (isPolicyViolation(err)) {
        console.log(`  ${R}✗ PolicyViolationError — ${err.reason}${X}`)
      } else {
        console.log(`  ${R}✗ ${err.message}${X}`)
      }
    }
  }

  rl.on('close', async () => {
    console.log(`${D}closing session…${X}`)
    if (snapshotTimer) clearTimeout(snapshotTimer)
    await node.close()
    wallet.dispose()
    process.exit(0)
  })
}

main().catch(err => {
  console.error(`${R}${err.message}${X}`)
  process.exit(1)
})
