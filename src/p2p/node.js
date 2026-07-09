'use strict'

// KittyNode — one member's live session: storage, autobase, swarm, and the
// op helpers the CLI / desktop UI / scripts drive. No servers anywhere.

const EventEmitter = require('events')
const fs = require('fs')
const path = require('path')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const b4a = require('b4a')

const { KittyPot } = require('./pot-base')
const { attachPairing } = require('./pairing')
const { OP } = require('../core/constants')
const { makeSalt, commitmentFor } = require('../core/commit')
const { encodeInvite, decodeInvite, topicFor } = require('../core/invite')
const selectors = require('../core/selectors')

const SECRETS_FILE = 'kitty-local-secrets.json'

class KittyNode extends EventEmitter {
  constructor (storageDir, { invite = null, name = 'anon', swarm = null, bootstrap = null } = {}) {
    super()
    this.storageDir = storageDir
    this.name = name
    this.store = new Corestore(path.join(storageDir, 'store'))
    this.pot = new KittyPot(this.store, {
      bootstrap: invite ? b4a.from(decodeInvite(invite), 'hex') : null
    })
    this.swarm = swarm // may be injected (tests, bench) or created in joinSwarm()
    this._swarmBootstrap = bootstrap // DHT bootstrap override (local testnet)
    this._ownSwarm = false
    this._pairings = new Set()
    this.connections = 0
  }

  async ready () {
    await this.pot.ready()
    this.pot.base.on('update', () => this.emit('update'))
    return this
  }

  get invite () {
    return encodeInvite(this.pot.key)
  }

  get writerKey () {
    return this.pot.localKeyHex
  }

  get writable () {
    return this.pot.writable
  }

  // ── networking ──────────────────────────────────────────────────────────

  async joinSwarm () {
    if (!this.swarm) {
      /* c8 ignore next -- the no-bootstrap arm needs the public DHT; tests exercise this via a local testnet (the bootstrap arm) */
      this.swarm = new Hyperswarm(this._swarmBootstrap ? { bootstrap: this._swarmBootstrap } : {})
      this._ownSwarm = true
    }

    this.swarm.on('connection', (conn) => {
      this.connections++
      this.emit('peer-add', this.connections)
      conn.on('close', () => {
        this.connections--
        this.emit('peer-remove', this.connections)
      })
      /* c8 ignore next -- network error handler: only fires if a live peer errors, not reachable offline */
      conn.on('error', () => {}) // peer went away — swarm will retry

      // Membership channel first, then core replication on the same stream.
      const pairing = attachPairing(conn, {
        onJoinRequest: (msg) => { this._handleJoinRequest(msg) }
      })
      if (pairing) {
        this._pairings.add(pairing)
        conn.on('close', () => this._pairings.delete(pairing))
        if (!this.writable) pairing.requestJoin({ key: this.writerKey, name: this.name })
      }

      this.store.replicate(conn)
    })

    const topic = topicFor(this.pot.keyHex)
    const discovery = this.swarm.join(topic, { server: true, client: true })
    await discovery.flushed()
    this.emit('swarm-joined', b4a.toString(topic, 'hex'))
    return this
  }

  async _handleJoinRequest ({ key, name }) {
    if (!this.writable) return // only members can admit
    const state = await this.pot.state()
    if (!state.pot || state.writers[key]) return // no pot yet, or already in
    await this.append({ type: OP.ADD_WRITER, key, name: String(name).slice(0, 32) })
    this.emit('admitted', { key, name })
  }

  // If we joined before becoming a writer, re-announce on existing pairings.
  requestJoinAll () {
    for (const pairing of this._pairings) {
      try {
        pairing.requestJoin({ key: this.writerKey, name: this.name })
      } catch {}
    }
  }

  // ── op helpers (each stamps the local clock and appends to OUR core) ────
  // Every append reports the reducer's verdict for the op we just wrote, so
  // callers can surface rejections honestly instead of claiming success.

  async append (op) {
    await this.pot.append({ ts: Date.now(), ...op })
    this.emit('append', op.type)
    const state = await this.pot.state()
    const mine = state.log.filter(l => l.writer === this.writerKey && l.type === op.type)
    const last = mine[mine.length - 1]
    /* c8 ignore next -- `last` is always present: append() logs an entry (accepted or rejected) before this read */
    return last ? { accepted: last.accepted, reason: last.reason } : { accepted: false, reason: 'not-applied-yet' }
  }

  async openPot ({ matchId, teams, buyIn, kickoffTs, chain = 'solana-devnet', token = 'USDT', quorum, witnessRule }) {
    return this.append({
      type: OP.OPEN_POT,
      potId: this.pot.keyHex,
      matchId,
      teams,
      buyIn,
      kickoffTs,
      chain,
      token,
      quorum,
      witnessRule,
      creatorName: this.name
    })
  }

  async stake ({ amount, payoutAddress, real = false }) {
    return this.append({ type: OP.STAKE, amount, payoutAddress, real })
  }

  // Seals the pick: the salt stays on THIS device until reveal. One sealed
  // secret per pot, ever — overwriting the salt of an accepted commitment
  // would make it unrevealable, so double-picks and double-clicks are refused
  // BEFORE the stored secret can be touched (including concurrent calls).
  async commitPick (prediction) {
    if (this._committing) throw new Error('a pick is already being sealed — one at a time')
    this._committing = true
    try {
      const state = await this.state()
      if (!state.pot) throw new Error('no pot open yet')
      if (state.commits[this.writerKey]) throw new Error('pick already sealed — picks are immutable')
      const existing = this._loadSecret()
      if (existing && existing.potId === state.pot.potId) {
        throw new Error('a sealed pick already exists on this device (it may still be syncing) — picks are immutable')
      }
      const salt = makeSalt()
      const commitment = commitmentFor({
        potId: state.pot.potId,
        writer: this.writerKey,
        prediction,
        salt
      })
      this._saveSecret({ potId: state.pot.potId, prediction, salt, commitment })
      const outcome = await this.append({ type: OP.COMMIT_PICK, commitment })
      return { commitment, ...outcome }
    } finally {
      this._committing = false
    }
  }

  async snapshot () {
    const heads = await this.pot.observedHeads()
    const outcome = await this.append({ type: OP.KICKOFF_SNAPSHOT, heads })
    return { heads, ...outcome }
  }

  async revealPick () {
    const secret = this._loadSecret()
    if (!secret) throw new Error('no sealed pick on this device')
    const outcome = await this.append({ type: OP.REVEAL_PICK, prediction: secret.prediction, salt: secret.salt })
    return { prediction: secret.prediction, ...outcome }
  }

  async voteResult (score) {
    return this.append({ type: OP.RESULT_VOTE, score })
  }

  async settle (transfers) {
    return this.append({ type: OP.PAYOUT, transfers })
  }

  // ── reads ───────────────────────────────────────────────────────────────

  async state () {
    return this.pot.state()
  }

  async summary (now = Date.now()) {
    return selectors.summarize(await this.state(), now)
  }

  async owed () {
    return selectors.owedBy(await this.state(), this.writerKey)
  }

  // ── local sealed-pick secret ────────────────────────────────────────────

  get _secretsPath () {
    return path.join(this.storageDir, SECRETS_FILE)
  }

  _saveSecret (secret) {
    fs.mkdirSync(this.storageDir, { recursive: true })
    fs.writeFileSync(this._secretsPath, JSON.stringify(secret, null, 2))
  }

  _loadSecret () {
    try {
      return JSON.parse(fs.readFileSync(this._secretsPath, 'utf-8'))
    } catch {
      return null
    }
  }

  async close () {
    if (this.swarm && this._ownSwarm) await this.swarm.destroy()
    await this.pot.close()
    await this.store.close()
  }
}

module.exports = { KittyNode }
