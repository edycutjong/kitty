# Decision Log

## 2026-07-03T15:10+07:00 — Test framework: node:test (not brittle/jest)
**Context**: Spec demands a large invariant-covering suite with the exact count in README.
**Options considered**: brittle (holepunch convention) vs jest vs node:test.
**Decision**: `node:test` (built into Node ≥20).
**Rationale**: Zero extra dependencies, TAP output, runs identically in CI and on a judge's machine. brittle adds a dep for no capability we need; jest is heavyweight for a no-DOM protocol library.

## 2026-07-03T15:10+07:00 — Module format: CommonJS
**Context**: Pear/holepunch packages are CJS-first; `@tetherto/wdk` README shows ESM.
**Decision**: CJS across `src/`, with dynamic `import()` inside the wallet adapter if WDK ships ESM-only.
**Rationale**: Best interop with the Pear stack under both Node and Bare; dynamic import covers ESM deps from CJS on Node 22.

## 2026-07-03T15:10+07:00 — Commit–reveal picks (complexity layer 1)
**Context**: PRD locks picks at kickoff, but a plaintext pick log lets late pickers copy early pickers.
**Decision**: Picks are submitted as BLAKE2b-256 commitments (`commit-pick`) before kickoff and opened (`reveal-pick`) after kickoff; the reducer verifies the hash.
**Rationale**: Fixes a real fairness flaw (pick copying), adds genuine cryptographic depth demanded by `.agents/prompts/complexity-prompt.md`, is pure logic (cheap to build/test), and produces a visible demo beat ("picks are sealed until kickoff").

## 2026-07-03T15:10+07:00 — Kickoff witnessing via snapshots (back-dating defence)
**Context**: An op's timestamp is claimed by its writer; a cheater could append a back-dated commit after kickoff.
**Decision**: Every client auto-appends a `kickoff-snapshot` (observed head lengths of every writer's core) at kickoff. A commit only counts if its sequence number is covered by a snapshot from a *different* member within the grace window.
**Rationale**: Turns "append-only makes tampering detectable" into an enforced rule with an on-screen rejection. Residual risk (colluding snapshotters, all-offline pots) documented in docs/AUDIT_REPORT.md, not hidden.

## 2026-07-03T15:10+07:00 — Quorum = strict majority (floor(n/2)+1 of staked members)
**Context**: PRD's example "⌈n/2⌉+1" gives 3-of-3 for n=3 — one offline friend would deadlock settlement.
**Decision**: Default quorum is `floor(stakedCount/2)+1` (2-of-3, 3-of-4), overridable per pot via config.
**Rationale**: Standard strict majority; keeps the 3-peer demo robust. Deviation from the PRD example is deliberate and documented.

## 2026-07-03T15:10+07:00 — No-winner rule: full refund to all stakers
**Context**: If no revealed pick matches the final score, the pool must still be zero-sum.
**Decision**: Refund every staker their exact buy-in (including members who failed to reveal).
**Rationale**: Deterministic, friendly, preserves Σ payouts == Σ stakes with zero remainder by construction.

## 2026-07-03T15:10+07:00 — License: Apache 2.0 (not MIT)
**Context**: enhance-project.md defaults to MIT; the binding Tether Developers Cup Rules require Apache 2.0.
**Decision**: Apache 2.0. Hackathon rules override the workflow default.

## 2026-07-03T15:10+07:00 — build/ is its own git repo (nested, no remote yet)
**Context**: Judges clone a standalone public repo; HermesDocs is the private planning monorepo.
**Decision**: `git init` inside `build/` with milestone commits; no remote until the user creates the public GitHub repo. The parent repo sees it as an embedded repo and does not track its contents.

## 2026-07-03T15:10+07:00 — Wallet adapter: real + dry-run modes, never blurred
**Context**: Real gasless devnet transfers need a funded faucet + relay availability (`@tetherto/wdk` is beta); tests and CI must not depend on external services.
**Decision**: `src/wallet/` exposes one interface with `mode: 'real' | 'dry-run'`. Dry-run produces deterministic, clearly-labelled simulated tx ids (`DRYRUN-…`); the readiness checker fails the submission until real testnet tx hashes are recorded in README.
**Rationale**: Honesty gates from the workflows; keeps the suite runnable out of the box for judges.

## 2026-07-03T15:40+07:00 — Settlement model: signed pledge + direct P2P net settlement (no vault)
**Context**: ARCHITECTURE.md says "each member's WDK wallet claims/receives its share" but never names who holds staked funds mid-game. In a serverless, self-custodial system there is **no escrow address** — any upfront transfer would land in a member's wallet and silently reinstate the treasurer.
**Options considered**: (a) transfer stakes upfront to the creator's address (custody risk returns), (b) on-chain escrow program (custom Solana program — out of scope, no smart-contract track), (c) stake = Hypercore-signed *pledge* + at finality each **loser pays winners directly** per a deterministic net-settlement plan.
**Decision**: (c). `stake` is a signed pledge (policy `simulate.transfer` proves capacity); after quorum finality the reducer freezes the ledger and `settlementPlan()` emits exact loser→winner transfers (waterfall over sorted keys); each loser's client auto-pays gasless USD₮ and appends a `payout` op with tx ids. Winners' shares on-chain equal `computeSplit` exactly; `Σ paid == Σ owed` by construction.
**Rationale**: Strictly more self-custodial than an escrow — nobody ever holds another member's money. Residual risk (a loser refusing to pay) is documented in docs/AUDIT_REPORT.md; the signed pledge is evidence, and the default client auto-settles. "What's next" lists threshold escrow as the upgrade path.

## 2026-07-03T15:40+07:00 — Ledger freezes at finality
**Context**: Autobase can merge a partitioned member's valid pre-kickoff ops *after* a quorum result has been applied, which could retroactively change the split after payouts were validated.
**Decision**: Once `result.finalized`, the reducer rejects any further stake/commit/snapshot/reveal (`ledger-frozen-after-finality`). All peers apply the same linearized order, so the frozen set is identical everywhere; the split is immutable from finality onward.
**Rationale**: Determinism of payouts beats maximal inclusiveness; UI nudges members not to finalize until everyone has revealed.

## 2026-07-03T15:10+07:00 — Membership: any existing member can admit a writer
**Context**: Autobase writers must be added by an existing writer; invite links are shared peer-to-peer.
**Decision**: `add-writer` is valid from any current member (creator included), matching "whoever has the link shared it" semantics. First-join handshake runs over a Protomux channel on the same Hyperswarm connection used for replication.
