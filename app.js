/** @typedef {import('pear-interface')} */
/* global Pear */
/* eslint-env browser */

// The Kitty — Pear desktop app. Same protocol as the CLI, same core reducer,
// rendered as the floodlit pot. Storage lives in Pear's app storage; the pick
// salt stays in localStorage on THIS device until reveal.

import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'

import potBase from './src/p2p/pot-base.js'
import pairingMod from './src/p2p/pairing.js'
import coreMod from './src/core/index.js'
import walletMod from './src/wallet/index.js'

const { KittyPot } = potBase
const { attachPairing } = pairingMod
const { OP } = coreMod
const { makeSalt, commitmentFor } = coreMod.commit
const { encodeInvite, decodeInvite, topicFor } = coreMod.invite
const { formatUnits, parseUnits } = coreMod.split
const selectors = coreMod.selectors
const { KittyWallet, isPolicyViolation } = walletMod

const { teardown, updates } = Pear
updates(() => Pear.reload())

const $ = (id) => document.getElementById(id)

let store, pot, swarm, wallet, name
let snapshotArmed = false
const pairings = new Set()

// ── helpers ────────────────────────────────────────────────────────────────

function toast (msg, kind = 'ok', ms = 4200) {
  const el = $('toast')
  el.textContent = msg
  el.className = kind
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.add('hidden'), ms)
}

function short (hex) {
  return hex.slice(0, 8) + '…'
}

function secretKeyFor (potId) {
  return `kitty-secret:${potId}`
}

async function getWallet () {
  if (wallet) return wallet
  let seed = localStorage.getItem('kitty-wallet-seed')
  if (!seed) {
    seed = await KittyWallet.randomSeedPhrase()
    localStorage.setItem('kitty-wallet-seed', seed)
  }
  wallet = new KittyWallet({ mode: 'dry-run', seedPhrase: seed })
  await wallet.ready()
  return wallet
}

// ── session ────────────────────────────────────────────────────────────────

async function startSession ({ invite = null } = {}) {
  store = new Corestore(Pear.config.storage + '/store')
  pot = new KittyPot(store, { bootstrap: invite ? b4a.from(decodeInvite(invite), 'hex') : null })
  await pot.ready()
  await getWallet()

  swarm = new Hyperswarm()
  teardown(() => swarm.destroy())

  swarm.on('connection', (conn) => {
    conn.on('error', () => {})
    const pairing = attachPairing(conn, {
      onJoinRequest: async ({ key, name: who }) => {
        if (!pot.writable) return
        const state = await pot.state()
        if (!state.pot || state.writers[key]) return
        await appendOp({ type: OP.ADD_WRITER, key, name: String(who).slice(0, 32) })
        toast(`admitted ${who} to the pot`)
      }
    })
    if (pairing) {
      pairings.add(pairing)
      conn.on('close', () => pairings.delete(pairing))
      if (!pot.writable) pairing.requestJoin({ key: pot.localKeyHex, name })
    }
    store.replicate(conn)
    renderPeers()
    conn.on('close', renderPeers)
  })

  swarm.join(topicFor(pot.keyHex), { server: true, client: true })

  pot.base.on('update', scheduleRender)
  if (invite) {
    const nudge = setInterval(() => {
      if (pot.writable) return clearInterval(nudge)
      for (const p of pairings) { try { p.requestJoin({ key: pot.localKeyHex, name }) } catch {} }
    }, 1500)
  }

  $('setup').classList.add('hidden')
  $('pot').classList.remove('hidden')
  $('my-key').textContent = `you: ${name} · ${short(pot.localKeyHex)}`
  $('invite-box').textContent = encodeInvite(pot.key)
  setInterval(tick, 1000)
  scheduleRender()
}

// Appends and reports the reducer's verdict, so the UI never claims success
// for an op the protocol rejected.
async function appendOp (op) {
  await pot.append({ ts: Date.now(), ...op })
  scheduleRender()
  const state = await pot.state()
  const mine = state.log.filter(l => l.writer === pot.localKeyHex && l.type === op.type)
  const last = mine[mine.length - 1]
  if (last && !last.accepted) throw new Error(`rejected: ${last.reason}`)
  return { accepted: true }
}

// ── actions ────────────────────────────────────────────────────────────────

$('btn-create').onclick = async () => {
  try {
    name = ($('c-name').value || 'ana').trim()
    await startSession({})
    const buyIn = parseUnits($('c-buyin').value || '20').toString()
    const kickoffTs = Date.now() + Math.max(1, Number($('c-mins').value || 10)) * 60_000
    await appendOp({
      type: OP.OPEN_POT,
      potId: pot.keyHex,
      matchId: `match-${Date.now()}`,
      teams: { home: $('c-home').value || 'Brazil', away: $('c-away').value || 'Argentina' },
      buyIn,
      kickoffTs,
      chain: 'dry-run',
      creatorName: name
    })
    localStorage.setItem('kitty-session', JSON.stringify({ name, invite: encodeInvite(pot.key) }))
    toast('pot is open — share the invite from the right rail')
  } catch (err) { toast(err.message, 'error') }
}

$('btn-join').onclick = async () => {
  try {
    name = ($('j-name').value || 'ben').trim()
    const invite = $('j-invite').value
    await startSession({ invite })
    localStorage.setItem('kitty-session', JSON.stringify({ name, invite: encodeInvite(pot.key) }))
    toast('searching the swarm — a member will admit you automatically')
  } catch (err) { toast(err.message, 'error') }
}

// Relaunching the app resumes the saved pot session — no setup form, no
// duplicate open-pot, same storage, same keys.
const savedSession = JSON.parse(localStorage.getItem('kitty-session') || 'null')
if (savedSession && savedSession.invite) {
  name = savedSession.name || 'anon'
  startSession({ invite: savedSession.invite })
    .then(() => toast(`resumed session as ${name}`))
    .catch(err => toast(err.message, 'error'))
}

$('invite-box').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('invite-box').textContent)
    toast('invite copied')
  } catch {}
}

$('btn-stake').onclick = async () => {
  try {
    const state = await pot.state()
    if (!state.pot) throw new Error('no pot yet')
    const verdict = await wallet.simulateStake(state.pot.buyIn)
    if (verdict.decision === 'DENY') {
      toast(`PolicyViolationError — ${verdict.reason}`, 'error', 6000)
      return
    }
    await appendOp({ type: OP.STAKE, amount: state.pot.buyIn, payoutAddress: await wallet.getAddress(), real: wallet.isReal })
    toast(`pledged ${formatUnits(state.pot.buyIn)} USD₮ — Transaction Policy: ALLOW ✓`)
  } catch (err) { toast(err.message, 'error') }
}

$('btn-pick').onclick = async () => {
  try {
    const prediction = { home: Number($('pick-h').value), away: Number($('pick-a').value) }
    const state = await pot.state()
    if (!state.pot) throw new Error('no pot yet')
    if (state.commits[pot.localKeyHex]) throw new Error('pick already sealed — picks are immutable')
    if (localStorage.getItem(secretKeyFor(state.pot.potId))) throw new Error('a sealed pick already exists on this device (it may still be syncing) — picks are immutable')
    const salt = makeSalt()
    const commitment = commitmentFor({ potId: state.pot.potId, writer: pot.localKeyHex, prediction, salt })
    localStorage.setItem(secretKeyFor(state.pot.potId), JSON.stringify({ prediction, salt }))
    await appendOp({ type: OP.COMMIT_PICK, commitment })
    toast(`pick sealed 🔒 ${commitment.slice(0, 14)}… — salt stays on this device`)
  } catch (err) { toast(err.message, 'error') }
}

$('btn-reveal').onclick = async () => {
  try {
    const state = await pot.state()
    const secret = JSON.parse(localStorage.getItem(secretKeyFor(state.pot.potId)) || 'null')
    if (!secret) throw new Error('no sealed pick on this device')
    await appendOp({ type: OP.REVEAL_PICK, prediction: secret.prediction, salt: secret.salt })
    toast(`revealed ${secret.prediction.home}–${secret.prediction.away} — hash-checked`)
  } catch (err) { toast(err.message, 'error') }
}

$('btn-result').onclick = async () => {
  try {
    const score = { home: Number($('res-h').value), away: Number($('res-a').value) }
    await appendOp({ type: OP.RESULT_VOTE, score })
    toast(`voted ${score.home}–${score.away} — finalizes at quorum`)
  } catch (err) { toast(err.message, 'error') }
}

$('btn-settle').onclick = async () => {
  try {
    const state = await pot.state()
    const owed = selectors.owedBy(state, pot.localKeyHex)
    if (owed.length === 0) { toast('nothing owed — you won, broke even, or already settled'); return }
    const transfers = await wallet.settlePlan(owed)
    await appendOp({ type: OP.PAYOUT, transfers })
    toast(`settled ${transfers.length} transfer(s), peer-to-peer`)
  } catch (err) {
    if (isPolicyViolation(err)) toast(`PolicyViolationError — ${err.reason}`, 'error', 6000)
    else toast(err.message, 'error')
  }
}

// ── render ─────────────────────────────────────────────────────────────────

let renderQueued = false
function scheduleRender () {
  if (renderQueued) return
  renderQueued = true
  setTimeout(async () => {
    renderQueued = false
    try { await render() } catch {}
  }, 60)
}

function renderPeers () {
  $('peers').textContent = swarm ? swarm.connections.size : 0
}

async function tick () {
  const state = await pot.state()
  if (!state.pot) return
  const left = state.pot.kickoffTs - Date.now()
  const el = $('countdown')
  if (state.result) {
    el.textContent = 'FULL-TIME'
    el.classList.add('locked')
  } else if (left <= 0) {
    el.textContent = '🔒 PICKS LOCKED'
    el.classList.add('locked')
    await armSnapshot(state)
  } else {
    const m = Math.floor(left / 60000); const s = Math.floor((left % 60000) / 1000)
    el.textContent = `PICKS LOCK IN ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
}

async function armSnapshot (state) {
  if (snapshotArmed || !pot.writable || state.result) return
  if (state.snapshots[pot.localKeyHex]) { snapshotArmed = true; return }
  snapshotArmed = true
  try {
    const heads = await pot.observedHeads()
    await appendOp({ type: OP.KICKOFF_SNAPSHOT, heads })
    toast(`kickoff — you witnessed ${Object.keys(heads).length} member logs`)
  } catch { snapshotArmed = false }
}

async function render () {
  const state = await pot.state()
  renderPeers()
  if (!state.pot) return
  const sum = selectors.summarize(state)
  const k = sum.pot

  $('m-home').textContent = k.teams.home
  $('m-away').textContent = k.teams.away
  $('pool').textContent = formatUnits(sum.pool)
  $('stake-amt').textContent = formatUnits(k.buyIn)
  $('pot-status').textContent = `status ${sum.status} · quorum ${sum.quorum} · witnessing ${k.witnessRule} · ${sum.rejected} tamper attempt(s) rejected`
  $('mode-note').textContent = k.chain === 'dry-run'
    ? 'dry-run mode — tx ids are simulations, clearly labelled'
    : `chain ${k.chain} — real self-custodial transfers`

  $('members').innerHTML = sum.members.map(m => {
    const chips = [
      m.staked ? '<span class="chip gold">staked</span>' : '<span class="chip">unstaked</span>',
      m.committed ? (m.witnessed ? '<span class="chip ok">sealed ✓</span>' : '<span class="chip warn">sealed · unwitnessed</span>') : '',
      m.revealed && m.prediction ? `<span class="chip ok">${m.prediction.home}–${m.prediction.away}</span>` : '',
      m.voted ? '<span class="chip">voted</span>' : '',
      m.paid ? '<span class="chip ok">paid</span>' : ''
    ].filter(Boolean).join('')
    return `<div class="member"><div class="name">${m.name}</div><div class="key mono">${short(m.key)}</div><div class="chips">${chips}</div></div>`
  }).join('')

  const ledger = state.log.slice(-60).reverse().map(l => {
    const t = l.ts ? new Date(l.ts).toLocaleTimeString() : '—'
    const cls = l.accepted ? 'op' : 'op rejected'
    const flag = l.accepted ? '✓' : `✗ ${l.reason}`
    return `<div class="${cls}"><span class="sum">${short(l.writer)} · ${l.type} · ${l.summary}</span><div class="meta">${t} · sig ✓ · ${flag}</div></div>`
  }).join('')
  $('ledger').innerHTML = ledger

  if (sum.result) {
    $('settlement').classList.remove('hidden')
    $('proof-result').textContent = `Result ${sum.result.score.home}–${sum.result.score.away} (${sum.result.confirmations.length} confirmations)`
    $('proof-sum').textContent = `Σ paid ${formatUnits(sum.accounting.paid)} = Σ staked ${formatUnits(sum.accounting.pool)} ${sum.accounting.holds ? '✓' : '✗'}`
    const owes = sum.settlement.owes || []
    const paidLegs = Object.entries(state.payouts).flatMap(([from, p]) => p.transfers.map(t => ({ from, ...t })))
    $('payouts').innerHTML = [
      ...sum.splits.map(s => `<div class="payout-row"><span>${short(s.writer)} receives</span><b style="color:var(--accent)">${s.pretty} USD₮</b></div>`),
      ...paidLegs.map(t => {
        const link = wallet.explorerLink(t.txid)
        return `<div class="payout-row"><span class="mono">${short(t.from)} → ${short(t.to)} · ${t.txid.slice(0, 22)}…</span>${link ? `<a href="${link}" target="_blank">view on explorer</a>` : '<span class="chip">dry-run</span>'}</div>`
      }),
      ...owes.filter(o => !paidLegs.some(p => p.from === o.from && p.to === o.to)).map(o =>
        `<div class="payout-row"><span>${short(o.from)} still owes ${short(o.to)}</span><b>${formatUnits(o.amount)} USD₮</b></div>`)
    ].join('')
  }
}
