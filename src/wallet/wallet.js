'use strict'

// KittyWallet — the money layer. One interface, two modes, never blurred:
//
//   real     @tetherto/wdk + @tetherto/wdk-wallet-solana against Solana
//            devnet: self-custodial account, SPL USD₮ transfers, WDK
//            Transaction Policy enforcing the buy-in cap.
//   dry-run  deterministic simulation for tests/CI and keyless demos. Tx ids
//            are prefixed DRYRUN- and every summary is labelled — an honest
//            sandbox, not a fake mainnet.
//
// WDK is ESM (verified from the installed package); this CJS module loads it
// via dynamic import at ready() time.

const { hashHex } = require('../core/hash')
const { buildCapPolicy, checkCapLocally } = require('./policy')

const DEFAULT_RPC = 'https://api.devnet.solana.com'

class KittyWallet {
  constructor ({
    mode = 'dry-run',
    seedPhrase,
    rpcUrl = DEFAULT_RPC,
    commitment = 'confirmed',
    token = null, // SPL mint standing in for USD₮ on devnet
    maxBuyIn = '100000000' // 100 USD₮ default responsible-play cap
  } = {}) {
    if (mode !== 'real' && mode !== 'dry-run') throw new Error(`unknown wallet mode: ${mode}`)
    if (!seedPhrase) throw new Error('seedPhrase is required')
    this.mode = mode
    this.seedPhrase = seedPhrase
    this.rpcUrl = rpcUrl
    this.commitment = commitment
    this.token = token
    this.maxBuyIn = maxBuyIn
    this._wdk = null
    this._account = null
    this._address = null
    this._dryTransfers = []
  }

  get isReal () {
    return this.mode === 'real'
  }

  static async randomSeedPhrase () {
    const { default: WDK } = await import('@tetherto/wdk')
    return WDK.getRandomSeedPhrase(12)
  }

  static async isValidSeedPhrase (seed) {
    const { default: WDK } = await import('@tetherto/wdk')
    return WDK.isValidSeed(seed)
  }

  async ready () {
    if (this.mode === 'dry-run') {
      // deterministic pseudo-address, clearly not a live account
      this._address = 'DRY' + hashHex(`kitty-dry-wallet:${this.seedPhrase}`).slice(0, 29)
      return this
    }
    const { default: WDK } = await import('@tetherto/wdk')
    const { default: WalletManagerSolana } = await import('@tetherto/wdk-wallet-solana')
    this._wdk = new WDK(this.seedPhrase)
      .registerWallet('solana', WalletManagerSolana, { rpcUrl: this.rpcUrl, commitment: this.commitment })
      .registerPolicy(buildCapPolicy(this.maxBuyIn))
    this._account = await this._wdk.getAccount('solana', 0)
    this._address = await this._account.getAddress()
    return this
  }

  async getAddress () {
    if (!this._address) await this.ready()
    return this._address
  }

  // Policy check without moving money — the stake-time guardrail proof.
  // Returns { decision: 'ALLOW' | 'DENY', reason } and never throws.
  async simulateStake (amount) {
    if (this.mode === 'dry-run') {
      try {
        checkCapLocally(amount, this.maxBuyIn)
        return { decision: 'ALLOW', reason: null, mode: this.mode }
      } catch (err) {
        return { decision: 'DENY', reason: err.reason, policyId: err.policyId, ruleName: err.ruleName, mode: this.mode }
      }
    }
    const result = await this._account.simulate.transfer({
      token: this.token,
      recipient: this._address, // simulation only evaluates the policy verdict
      amount: BigInt(amount)
    })
    return {
      decision: result.decision === 'ALLOW' ? 'ALLOW' : 'DENY',
      reason: result.reason ?? null,
      policyId: result.policy_id ?? null,
      ruleName: result.matched_rule ?? null,
      mode: this.mode
    }
  }

  // One settlement leg: loser pays a winner. Throws PolicyViolationError
  // (real: from WDK's policy proxy; dry-run: the local twin) when over cap.
  async transfer ({ recipient, amount }) {
    if (this.mode === 'real' && !this.token) {
      throw new Error('real mode needs a USD₮ SPL mint — set KITTY_TOKEN_MINT (see .env.example)')
    }
    if (this.mode === 'dry-run') {
      checkCapLocally(amount, this.maxBuyIn)
      const txid = 'DRYRUN-' + hashHex(`kitty-dry-tx:${this._address}:${recipient}:${amount}:${this._dryTransfers.length}`).slice(0, 40)
      const record = { txid, recipient, amount: String(amount), real: false }
      this._dryTransfers.push(record)
      return { txid, fee: '0', real: false }
    }
    // Live Solana-devnet SPL transfer. The on-chain call itself is proven by the
    // manual `--real` run; the result-mapping below is unit-tested via a stubbed
    // account (test/wallet/coverage.test.js).
    const { hash, fee } = await this._account.transfer({
      token: this.token,
      recipient,
      amount: BigInt(amount)
    })
    return { txid: hash, fee: String(fee), real: true }
  }

  // Settle every owed leg from the deterministic plan; returns payout-op legs.
  async settlePlan (owedLegs) {
    const transfers = []
    for (const leg of owedLegs) {
      const { txid } = await this.transfer({ recipient: leg.toAddress || leg.to, amount: leg.amount })
      transfers.push({ to: leg.to, amount: leg.amount, txid })
    }
    return transfers
  }

  async getBalance () {
    if (this.mode === 'dry-run') return { native: '1000000000', token: '1000000000', real: false }
    const native = await this._account.getBalance()
    const token = this.token ? await this._account.getTokenBalance(this.token) : null
    return { native: String(native), token: token === null ? null : String(token), real: true }
  }

  explorerLink (txid) {
    if (!txid || txid.startsWith('DRYRUN-')) return null
    return `https://explorer.solana.com/tx/${txid}?cluster=devnet`
  }

  dispose () {
    if (this._wdk) this._wdk.dispose()
    this._wdk = null
    this._account = null
  }
}

module.exports = { KittyWallet, DEFAULT_RPC }
