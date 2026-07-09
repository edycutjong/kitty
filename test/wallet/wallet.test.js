'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { KittyWallet } = require('../../src/wallet/wallet')
const { buildCapPolicy, checkCapLocally, isPolicyViolation, POLICY_ID, RULE_NAME } = require('../../src/wallet/policy')

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// ── policy unit ───────────────────────────────────────────────────────────

test('buildCapPolicy produces a valid WDK policy shape', () => {
  const p = buildCapPolicy('20000000')
  assert.equal(p.id, POLICY_ID)
  assert.equal(p.scope, 'project')
  assert.equal(p.rules.length, 2)
  assert.equal(p.rules[1].action, 'DENY')
  assert.equal(p.rules[1].operation, 'transfer')
})

test('cap condition triggers only above the cap', () => {
  const rule = buildCapPolicy('100').rules[1]
  const over = rule.conditions[0]({ params: { amount: 101n } })
  const at = rule.conditions[0]({ params: { amount: 100n } })
  const under = rule.conditions[0]({ params: { amount: 99n } })
  assert.equal(over, true)
  assert.equal(at, false)
  assert.equal(under, false)
})

test('checkCapLocally throws a PolicyViolationError twin above cap', () => {
  assert.doesNotThrow(() => checkCapLocally('100', '100'))
  try {
    checkCapLocally('101', '100')
    assert.fail('should have thrown')
  } catch (err) {
    assert.equal(err.name, 'PolicyViolationError')
    assert.equal(err.policyId, POLICY_ID)
    assert.equal(err.ruleName, RULE_NAME)
    assert.ok(isPolicyViolation(err))
  }
})

test('isPolicyViolation rejects unrelated errors', () => {
  assert.equal(isPolicyViolation(new Error('boom')), false)
  assert.equal(isPolicyViolation(null), false)
})

// ── dry-run mode ──────────────────────────────────────────────────────────

test('dry-run wallet derives a deterministic, clearly-labelled address', async () => {
  const w1 = await new KittyWallet({ seedPhrase: SEED }).ready()
  const w2 = await new KittyWallet({ seedPhrase: SEED }).ready()
  const addr = await w1.getAddress()
  assert.ok(addr.startsWith('DRY'))
  assert.equal(addr, await w2.getAddress())
})

test('different seeds give different dry-run addresses', async () => {
  const w1 = await new KittyWallet({ seedPhrase: SEED }).ready()
  const w2 = await new KittyWallet({ seedPhrase: SEED + ' x' }).ready()
  assert.notEqual(await w1.getAddress(), await w2.getAddress())
})

test('simulateStake ALLOWs under the cap and DENYs over it', async () => {
  const w = await new KittyWallet({ seedPhrase: SEED, maxBuyIn: '20000000' }).ready()
  const ok = await w.simulateStake('20000000')
  assert.equal(ok.decision, 'ALLOW')
  const no = await w.simulateStake('20000001')
  assert.equal(no.decision, 'DENY')
  assert.equal(no.policyId, POLICY_ID)
  assert.ok(no.reason)
})

test('dry-run transfer returns DRYRUN- txids, honestly labelled', async () => {
  const w = await new KittyWallet({ seedPhrase: SEED }).ready()
  const { txid, real } = await w.transfer({ recipient: 'someone', amount: '5000000' })
  assert.ok(txid.startsWith('DRYRUN-'))
  assert.equal(real, false)
  assert.equal(w.explorerLink(txid), null) // no explorer link for simulations
})

test('dry-run transfer above the cap throws the policy error', async () => {
  const w = await new KittyWallet({ seedPhrase: SEED, maxBuyIn: '1000' }).ready()
  await assert.rejects(w.transfer({ recipient: 'someone', amount: '1001' }), err => isPolicyViolation(err))
})

test('settlePlan settles every owed leg and returns payout-op transfers', async () => {
  const w = await new KittyWallet({ seedPhrase: SEED }).ready()
  const owed = [
    { to: 'aa'.repeat(32), toAddress: 'addr-w1', amount: '10000000' },
    { to: 'bb'.repeat(32), toAddress: 'addr-w2', amount: '10000000' }
  ]
  const transfers = await w.settlePlan(owed)
  assert.equal(transfers.length, 2)
  assert.equal(transfers[0].to, owed[0].to)
  assert.equal(transfers[0].amount, '10000000')
  assert.ok(transfers[0].txid.startsWith('DRYRUN-'))
  assert.notEqual(transfers[0].txid, transfers[1].txid)
})

test('dry-run balance is labelled unreal', async () => {
  const w = await new KittyWallet({ seedPhrase: SEED }).ready()
  const b = await w.getBalance()
  assert.equal(b.real, false)
})

test('wallet rejects unknown modes and missing seeds', () => {
  assert.throws(() => new KittyWallet({ mode: 'pretend', seedPhrase: SEED }))
  assert.throws(() => new KittyWallet({}))
})

// ── real mode (offline-safe surface: key derivation only, no RPC calls) ───

test('real mode: WDK derives a Solana address from the seed locally', async () => {
  const w = new KittyWallet({ mode: 'real', seedPhrase: SEED, token: 'So11111111111111111111111111111111111111112' })
  await w.ready()
  const addr = await w.getAddress()
  assert.ok(typeof addr === 'string' && addr.length >= 32 && !addr.startsWith('DRY'))
  w.dispose()
})

test('real mode: the registered WDK policy DENYs an over-cap stake via simulate', async () => {
  const w = new KittyWallet({ mode: 'real', seedPhrase: SEED, maxBuyIn: '20000000', token: 'So11111111111111111111111111111111111111112' })
  await w.ready()
  const verdict = await w.simulateStake('999000000')
  assert.equal(verdict.decision, 'DENY')
  const ok = await w.simulateStake('1000000')
  assert.equal(ok.decision, 'ALLOW')
  w.dispose()
})

test('random seed phrases from WDK are valid BIP-39', async () => {
  const seed = await KittyWallet.randomSeedPhrase()
  assert.equal(seed.split(' ').length, 12)
  assert.ok(await KittyWallet.isValidSeedPhrase(seed))
})
