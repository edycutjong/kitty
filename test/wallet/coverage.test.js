'use strict'

// Wallet surface that the happy-path suite doesn't reach: the mode flag, the
// real-mode pre-flight guard, and the explorer-link builder. The live devnet
// transfer/getBalance calls are coverage-excluded in wallet.js (they need a
// funded Solana account) and are exercised by the manual --real run instead.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { KittyWallet } = require('../../src/wallet/wallet')

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const MINT = 'So11111111111111111111111111111111111111112'

test('isReal reflects the wallet mode', () => {
  assert.equal(new KittyWallet({ mode: 'real', seedPhrase: SEED, token: MINT }).isReal, true)
  assert.equal(new KittyWallet({ seedPhrase: SEED }).isReal, false) // dry-run default
})

test('real mode refuses a transfer with no USD₮ mint configured', async () => {
  const w = new KittyWallet({ mode: 'real', seedPhrase: SEED }) // no token
  await assert.rejects(w.transfer({ recipient: 'x', amount: '1' }), /USD₮ SPL mint/)
})

test('explorerLink builds a devnet URL for real txids, null for simulations', () => {
  const w = new KittyWallet({ seedPhrase: SEED })
  assert.equal(w.explorerLink('DRYRUN-abc'), null)
  assert.equal(w.explorerLink(''), null)
  assert.equal(
    w.explorerLink('5xTx9realSignature'),
    'https://explorer.solana.com/tx/5xTx9realSignature?cluster=devnet'
  )
})

test('real mode maps the WDK account result to a labelled receipt (stubbed account)', async () => {
  // The live on-chain transfer/getBalance are proven by the manual `--real` run;
  // here a stubbed WDK account proves OUR result-mapping (hash→txid, fee→string,
  // real:true, token-balance shaping) without a funded devnet account.
  const w = new KittyWallet({ mode: 'real', seedPhrase: SEED, token: MINT })
  w._account = {
    transfer: async ({ recipient, amount }) => ({ hash: `SIG-${recipient}-${amount}`, fee: 42n }),
    getBalance: async () => 1000n,
    getTokenBalance: async () => 500n
  }
  const r = await w.transfer({ recipient: 'dest', amount: '5' })
  assert.equal(r.real, true)
  assert.equal(r.txid, 'SIG-dest-5')
  assert.equal(r.fee, '42')
  assert.equal(w.explorerLink(r.txid), 'https://explorer.solana.com/tx/SIG-dest-5?cluster=devnet')

  const b = await w.getBalance()
  assert.deepEqual(b, { native: '1000', token: '500', real: true })
})

test('getAddress lazily readies the wallet when called first', async () => {
  const w = new KittyWallet({ seedPhrase: SEED })
  const addr = await w.getAddress() // no explicit ready()
  assert.ok(addr.startsWith('DRY'))
})

test('real-mode simulateStake maps a WDK verdict, defaulting missing fields to null (stubbed)', async () => {
  const w = new KittyWallet({ mode: 'real', seedPhrase: SEED, token: MINT })
  w._address = 'addr'
  w._account = { simulate: { transfer: async () => ({ decision: 'DENY' }) } } // no reason/policy_id/matched_rule
  const deny = await w.simulateStake('5')
  assert.deepEqual(deny, { decision: 'DENY', reason: null, policyId: null, ruleName: null, mode: 'real' })
  w._account = { simulate: { transfer: async () => ({ decision: 'ALLOW', reason: 'ok', policy_id: 'p', matched_rule: 'r' }) } }
  const allow = await w.simulateStake('5')
  assert.equal(allow.decision, 'ALLOW')
  assert.equal(allow.reason, 'ok')
})

test('settlePlan falls back to leg.to when no toAddress is given', async () => {
  const w = await new KittyWallet({ seedPhrase: SEED }).ready()
  const transfers = await w.settlePlan([{ to: 'aa'.repeat(32), amount: '1000000' }]) // no toAddress
  assert.equal(transfers.length, 1)
  assert.ok(transfers[0].txid.startsWith('DRYRUN-'))
})

test('real-mode getBalance returns a null token when no mint is configured (stubbed)', async () => {
  const w = new KittyWallet({ mode: 'real', seedPhrase: SEED }) // no token
  w._account = { getBalance: async () => 777n }
  assert.deepEqual(await w.getBalance(), { native: '777', token: null, real: true })
})
