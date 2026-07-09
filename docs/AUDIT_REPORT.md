# Self-Audit & Threat Model — The Kitty

> An honest map of what this protocol can and cannot protect against. Claiming
> perfect security is an anti-pattern; this document is the opposite of that.

## 1. Formal invariants (all machine-checked)

| # | Invariant | Statement | Enforcement | Tests |
|---|---|---|---|---|
| I1 | Pick immutability | ∀ member m: at most one accepted `commit-pick`, with claimed `ts < kickoffTs`; a reveal is accepted iff `BLAKE2b(domain‖potId‖m‖pick‖salt) == commitment` | reducer rejects duplicates/late commits; hash check in `verifyReveal` | `reduce.picks.test.js` (15) |
| I2 | Witnessed lock | a commit is *eligible* iff ∃ member w ≠ m with an in-window `kickoff-snapshot` s.t. `heads[m] ≥ commit.seq` | `selectors.isWitnessed` (strict mode default) | `reduce.witness.test.js` (14) |
| I3 | Accounting | `Σ payouts == Σ stakes` (zero-sum; no mint, no fee, no house) | bigint split + runtime `verifyAccounting` + payout ops must match the plan exactly | `split.test.js`, `settlement.test.js` (39) |
| I4 | Authority | an op binds to the Hypercore that contains it; member m cannot author ops attributed to w ≠ m | Ed25519-signed cores; writer = `node.from.key` | `convergence.test.js` (stranger rejection) |
| I5 | Result finality | finalized iff ≥ ⌊staked/2⌋+1 identical scores among stakers; the ledger freezes at finality | reducer tally + `AFTER_FINALITY` rejections | `reduce.result.test.js` (15) |
| I6 | Determinism | identical linearized history ⇒ identical state, splits, settlement plan on every peer | pure clock-free reducer; selectors over final state | `determinism.test.js` (6) |

## 2. Adversary analysis

### A. Cheating member (the core threat — SOLVED)
*Wants to change or back-date a pick after seeing the match.*
- Changing a pick: impossible — duplicate commits rejected (I1), reveals hash-pinned to the sealed commitment.
- Copying a rival's pick: impossible pre-kickoff — commitments hide the prediction (salted, domain-separated, writer-bound).
- Back-dating: the op's claimed timestamp is attacker-controlled, **but** an unwitnessed commit never becomes eligible (I2). Demonstrated live in `verify_p2p` and `seed_demo`.
- Forged authorship: impossible without the victim's signing key (I4).

### B. Colluding quorum (RESIDUAL — documented, not hidden)
*⌊n/2⌋+1 stakers agree to finalize a false score.*
- Not prevented. Mitigations: the dissent is permanently recorded (votes are append-only, so the honest minority holds cryptographic evidence); pots are social groups where collusion ≈ stealing from named friends; quorum is configurable (a pot can demand unanimity).
- Deliberate design choice over an AI/video oracle, which would be fragile theatre. Upgrade path: external result oracles (e.g. signed feeds) as an *optional* vote source.

### C. Snapshot collusion (RESIDUAL — bounded)
*A member forges `heads` claiming they saw a cheater's late commit early.*
- A single colluder can launder one accomplice's back-dated pick (I2 needs only one witness). Bounded by: snapshots are one-per-member, in-window, and permanently attributable — after the match, the forged claim is inspectable evidence (`heads[m]` exceeding what any honest peer saw at kickoff is a red flag in the ledger).
- Hardening path: require k > 1 witnesses (`witnessRule` is already pluggable), or bind snapshots to Hyperswarm connection transcripts.

### D. Payment refusal (RESIDUAL — explicit trade-off)
*A loser never appends `payout` / never transfers.*
- Settlement is a signed pledge + direct P2P payment; refusal is socially enforced. The pledge (signed, replicated) is undeniable evidence of the debt; the default client auto-settles at finality; the pot UI shows exactly who still owes what.
- This is strictly better than the status quo (a treasurer who can vanish with *everyone's* money) and than a fake "vault" (custody by another name). Upgrade path: m-of-n SPL token escrow.

### E. Network adversaries
- **Transport**: all peer links are Noise-encrypted (Hyperswarm secret streams); the swarm topic is a hash of the pot key, so DHT observers learn a rendezvous, not the key.
- **Membership gate**: the invite carries the Autobase bootstrap key; anyone holding it can request admission and replicate. Invites are capability tokens — share like a group-chat link. (No per-member revocation yet — documented gap.)
- **Eclipse/DoS**: a partitioned member misses witnessing (their own commit may become ineligible in strict mode — fail-safe, not fail-open). Liveness degrades; safety does not.
- **Storage**: pick salts sit unencrypted in local app storage until reveal (device-level protection assumed — same trust class as the wallet seed).

### F. Wallet layer
- WDK accounts are self-custodial; keys derive from a local BIP-39 seed (`wallet-seed.txt`, mode 0600, gitignored). The Transaction Policy cap is enforced **in-wallet** (DENY-wins engine, verified against the installed `@tetherto/wdk` source) — it cannot be bypassed by the pot protocol, only by the device owner editing their own config (it is *their* guardrail).
- `@tetherto/wdk` is **beta** (pinned exactly). The policy proxy's documented nested-call escape means underscore-prefixed internals bypass enforcement — we only call the public proxied surface.

## 3. Honest gaps & known limitations

1. Result truth is quorum consensus (B) — no oracle.
2. Settlement liveness is social (D) — no escrow yet.
3. One-witness laundering (C) exists in strict mode with a single colluder.
4. No member revocation / invite rotation after admission.
5. Autobase view is a single JSON document — O(state) per apply batch; fine at pot scale (≤ ~64 members), wrong for thousands.
6. Timestamps in the UI countdown come from local clocks; protocol correctness never does.
7. A configured quorum override is clamped to the staked count (`min(quorum, staked)` — unanimity-of-stakers floor): a pot expecting 6 stakers with `quorum: 5` finalizes at 3-of-3 if only 3 stake. Prevents deadlock; weakens an explicit super-majority when turnout is low.
8. `add-writer` stays valid after finality (late joiners can read, not stake) — deliberate: membership is social, money is frozen.

## 4. Self-audit checklist (what we actually did)

- [x] Every reducer rule has explicit accept AND reject tests (158 core tests, 180 total).
- [x] Every REJECT reason constant is asserted by at least one test.
- [x] Determinism pinned under re-apply, truncation, and cross-writer reordering.
- [x] Accounting fuzz across pot sizes (1–5 members, winners 0–all, remainder cases).
- [x] The full flow runs across 3 real peers with a live tamper attempt in CI (`verify_p2p`).
- [x] WDK policy verified against the real engine (not just our dry-run twin).
- [x] Dependency surface pinned; `@tetherto/*` excluded from Dependabot auto-bumps.
- [x] No secrets in repo (TruffleHog in CI); wallet seeds written 0600 and gitignored.
