# The Kitty — DoraHacks BUIDL Submission

> Copy-paste bundle: each section maps 1:1 to the BUIDL form pages.
> ⚠️ Two fields below stay marked **(pending)** until earned — the readiness gate
> (`npm run check:readiness`) enforces them before submitting.

## 1. Profile

- **BUIDL Name:** The Kitty
- **BUIDL Logo:** `docs/icon-512.png` (512×512 PNG, symbol-only)
- **Category:** Crypto / Web3
- **Vision (159/256 chars):**
  `Every group of friends can run a money pool with no custodian: state lives on their own devices, money in their own wallets, fairness enforced by cryptography.`
- **Elevator Pitch (130/150 chars):**
  `Serverless, self-custodial USD₮ prediction pot. Picks seal tamper-evidently before kickoff; winners split automatically. No house.`

### Crypto/Web3 fields
- **Innovation Domains:** Infra / API · Crypto Adoption · Wallet · Social
- **L1s:** Solana (devnet demo; WDK is chain-portable)
- **Other open source ecosystems:** — (Pear/Holepunch is the chosen track's stack; WDK is a supporting stack; not in the preset list)

## 2. Project Story

### Inspiration
Every tournament our group chat runs a prediction pool, and every tournament it fails the same three ways: the mate holding the cash forgets who paid (custody), someone swears they picked Argentina before kickoff (disputes), and the winner chases payouts for a week (friction). Betting apps "solve" this by becoming the house — KYC, custody, fees, data. We wanted the opposite: delete the treasurer, keep the mates.

### What it does
1. **Pot = a `pear://` link.** Hyperswarm topic discovery; a member admits your writer key over a Protomux pairing channel — no signup, no server, verified in CI across 3 real peers.
2. **Gasless self-custodial stakes.** Each member pledges the exact buy-in (20 USD₮ in the demo) from a WDK wallet only they control; a **Transaction Policy** caps the stake and throws `PolicyViolationError` on-device before any transaction exists (`account.simulate.transfer` verdict shown in UI).
3. **Sealed picks + kickoff lock.** A pick is a BLAKE2b-256 commitment (potId‖writer‖pick‖salt) appended to the member's own signed Hypercore before kickoff; at kickoff every client snapshots what it witnessed of every log. A commit no *other* member witnessed never counts — back-dating is neutralized live on screen.
4. **Consensus result, frozen ledger.** A strict majority of stakers (⌊n/2⌋+1) finalizes the score; the reducer then freezes stakes/commits/reveals so the split is immutable.
5. **Deterministic wallet-to-wallet settlement.** Every peer computes the identical split (bigint, `Σ payouts == Σ stakes` always); losers pay winners directly, gasless — nobody ever custodies another member's money.

### How we built it
| Layer | Technology | Why |
|---|---|---|
| P2P state | **Autobase** over per-member **Hypercores**, **Hyperbee** view | multi-writer merge with deterministic linearization = shared state with no server |
| Discovery/transport | **Hyperswarm** + **Protomux** | topic = instant room; membership pairing multiplexed on the replication stream |
| Money | **`@tetherto/wdk` 1.0.0-beta.12** + `wdk-wallet-solana` | self-custodial accounts, gasless USD₮, real ALLOW/DENY policy engine |
| Trust core | pure CJS reducer, zero I/O | Autobase may reorder/re-apply; purity ⇒ byte-identical convergence |
| Surfaces | interactive CLI session + Pear desktop app | corestore is single-process, so the session IS the app |

**Quality & Security Engineering:** 227 tests (node:test, every invariant + rejection path) · 5-stage CI (lint → security → 3-peer live E2E → p50/p95 bench → gate) · CodeQL + Dependabot + TruffleHog · `check_submission_readiness.js` fails the build if any doc claim outruns reality · threat model in `docs/AUDIT_REPORT.md`.

### Challenges we ran into
1. **Timestamps are lies.** The kickoff lock can't trust writer-claimed clocks, so we designed cross-witnessing: at kickoff each client snapshots the core lengths it has *seen*; eligibility requires another member's coverage. Getting this deterministic under Autobase's reorder/re-apply semantics (selectors over final state, never apply-time flags) was the hardest design work in the project.
2. **Where does the money sit?** A serverless system has no escrow address — an upfront "vault" would silently reinstate the treasurer. We switched to signed pledges + a deterministic loser→winner transfer matrix (waterfall over sorted keys, exact to the unit) and documented the refusal-risk trade-off honestly instead of hiding it.
3. **A beta SDK in a CJS world.** WDK is ESM-only and its docs are still settling, so we verified every call against the installed package source (config keys, `transfer` result shape, DENY-wins policy semantics) and wrapped it behind a real/dry-run adapter so judges can run everything with zero config.

### What we learned
Trustlessness is a *protocol* property, not a blockchain property: an append-only log your mates witnessed beats a timestamp any day. And honesty compounds — the dry-run mode being loudly labelled made every real claim more credible.

### What's next
- **Threshold escrow** (m-of-n SPL token account) so even payment refusal becomes impossible.
- **Bare mobile build** with Bluetooth mesh — the stadium with no signal is the natural habitat.
- **Season pots** — one Autobase per tournament, standings as a derived view.

## 3. Team

- **Team Name:** The Kitty
- **Team Description:** Solo builder. Shipped a full P2P settlement protocol in-window: 227 passing tests, 5-stage CI with a live 3-peer E2E, reproducible p50/p95 benchmarks (7.4 ms Autobase convergence), and a threat model that says out loud what the protocol can't do.
- **Contact to Organizer:** Hi! I'm Edy — I built The Kitty, a serverless self-custodial prediction pot on the Pear track (WDK powers self-custodial settlement). Repo: https://github.com/edycutjong/kitty · demo video and landing below. Everything is reproducible with `npm test` / `npm run verify:p2p` — thank you for running it!

## 4. Links

- **GitHub (Apache 2.0):** https://github.com/edycutjong/kitty
- **Live landing:** https://edycutjong.github.io/kitty
- **Demo video (≤3 min, unlisted):** ✅ https://youtu.be/Rx59vsOlg7Q

## 5. Required form fields (Rules — "Submitting a Project")

| Field | Value |
|---|---|
| Product name | The Kitty |
| Track (single pick) | **Pear** (the serverless multi-writer pot — Autobase + Hypercore + Hyperswarm + Hyperbee + Protomux — is the load-bearing engineering; WDK is a supporting stack for settlement, described in the platform-use blurb) |
| Nation represented | **(pending — fill at registration)** |
| Teammates + backgrounds | Edy Cu — solo (full-stack; listed on the BUIDL page) |
| Team location | **(pending — fill at registration)** |
| Public GitHub repo (Apache 2.0) | https://github.com/edycutjong/kitty |
| Platform-use blurb | Autobase multi-writer pot state + Hypercore tamper-evident sealed picks + Hyperswarm rooms (Pear) × WDK self-custodial gasless USD₮ + Transaction Policy cap. Remove either stack and you rebuild a server and a custodian. |
| Demo video | ✅ https://youtu.be/Rx59vsOlg7Q |
| Prior work disclosure | None — all code written during the event window (repo history shows cadence) |
| Third-party disclosure | OSS deps only (Holepunch P2P stack + `@tetherto/wdk*`, pinned in package.json); services: public Hyperswarm DHT bootstrap (replaceable via `--bootstrap`), public Solana devnet RPC in `--real` mode only. No cloud AI, no hosted backend. |

## 6. Media assets

- Logo 480×480+: `docs/icon-512.png`
- Banner 16:9: `docs/og-image.png`
- Screenshots to capture: ① CLI two-terminal moment with `⇄ peer connected` + invite · ② ledger with the red rejected back-dated pick · ③ settlement panel `Σ paid == Σ staked ✓` with tx links (desktop app)

## 7. Engineering Harness Summary

| Layer | Status | Details |
|---|---|---|
| Code Quality | ✅ | standard, zero warnings |
| Unit Testing | ✅ | 227 tests, every invariant + rejection reason |
| E2E Testing | ✅ | `verify_p2p`: 3 live peers + tamper attempt, in CI |
| Security (DevSecOps) | ✅ | CodeQL + Dependabot + TruffleHog + npm audit |
| CI/CD Pipeline | ✅ | 5 stages: quality → security → E2E → bench → gate |
| Performance & Observability | ✅ | `bench.js` p50/p95 artifact; invariant report at runtime |

---

Thank you for taking the time to review The Kitty — we built the pot we actually wanted for our own group chat, and we're proud there's no server behind it. 🐱⚽
