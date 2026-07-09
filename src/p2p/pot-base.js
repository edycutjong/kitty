'use strict'

// KittyPot — the replicated pot: one Autobase over every member's Hypercore,
// linearized into a Hyperbee view by the pure core reducer.
//
// Determinism contract (Autobase README): the view is derived ONLY from the
// linearized nodes — `apply` reads the current state from the bee, folds the
// batch through the reducer, and writes it back. Autobase may truncate and
// re-apply at any time; because the reducer is pure this always converges.

const Autobase = require('autobase')
const Hyperbee = require('hyperbee')
const b4a = require('b4a')

const { createState, applyOp } = require('../core/reduce')
const { OP } = require('../core/constants')

const STATE_KEY = 'state'

function openView (store) {
  return new Hyperbee(store.get('view'), {
    extension: false,
    keyEncoding: 'utf-8',
    valueEncoding: 'json'
  })
}

async function applyNodes (nodes, view, host) {
  const existing = await view.get(STATE_KEY)
  const state = existing ? existing.value : createState()

  for (const node of nodes) {
    const op = node.value
    if (!op || typeof op !== 'object') continue

    const ctx = {
      writer: b4a.toString(node.from.key, 'hex'),
      seq: node.length
    }
    const { accepted } = applyOp(state, op, ctx)

    // Membership is protocol-governed: only an add-writer the reducer
    // accepted (i.e. admitted by an existing member) unlocks appending.
    if (accepted && op.type === OP.ADD_WRITER) {
      await host.addWriter(b4a.from(op.key, 'hex'), { indexer: true })
    }
  }

  await view.put(STATE_KEY, state)
}

class KittyPot {
  constructor (store, { bootstrap = null } = {}) {
    this.store = store
    this.base = new Autobase(store.session(), bootstrap, {
      valueEncoding: 'json',
      ackInterval: 1000,
      open: openView,
      apply: applyNodes
    })
  }

  async ready () {
    await this.base.ready()
    return this
  }

  get key () {
    return this.base.key
  }

  get keyHex () {
    return b4a.toString(this.base.key, 'hex')
  }

  get localKeyHex () {
    return b4a.toString(this.base.local.key, 'hex')
  }

  get writable () {
    return this.base.writable
  }

  get discoveryKey () {
    return this.base.discoveryKey
  }

  async append (op) {
    await this.base.append(op)
  }

  async update () {
    await this.base.update()
  }

  async state () {
    await this.base.update()
    const entry = await this.base.view.get(STATE_KEY)
    return entry ? entry.value : createState()
  }

  // What THIS peer has seen of every member's log right now — the local
  // observation a kickoff snapshot attests to.
  async observedHeads () {
    const state = await this.state()
    const heads = {}
    for (const writerHex of Object.keys(state.writers)) {
      const core = this.store.get({ key: b4a.from(writerHex, 'hex') })
      await core.ready()
      heads[writerHex] = core.length
      await core.close()
    }
    return heads
  }

  async close () {
    await this.base.close()
  }
}

module.exports = { KittyPot, openView, applyNodes, STATE_KEY }
