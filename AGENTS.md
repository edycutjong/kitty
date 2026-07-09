# AGENTS.md — The Kitty

Machine-readable project brief for agent workflows (enhance-project, dorahacks, readme generators).

| Field | Value |
|---|---|
| Name | The Kitty |
| Tagline | The serverless, self-custodial prediction pot with no house |
| One-liner | Friends stake USD₮ into a match pot with no server and no custodian; picks seal tamper-evidently before kickoff; winners split automatically. |
| Hackathon | Tether Developers Cup (DoraHacks) — football theme |
| Tracks | WDK × Pear → Cup Champion |
| License | Apache-2.0 (binding hackathon rule) |
| Runtime | Node ≥20 (CLI/tests) · Pear runtime (desktop app) |
| Stack | Corestore · Hypercore · Autobase · Hyperbee · Hyperswarm · Protomux · `@tetherto/wdk` 1.0.0-beta.12 · `@tetherto/wdk-wallet-solana` 1.0.0-beta.11 |
| Module format | CommonJS (`src/`), dynamic `import()` for ESM WDK |
| Lint | standard |
| Tests | node:test — `npm test`; exact count stated in README.md |
| Colors | canvas `#0B0E11` · panel `#12161C` · USD₮ green `#26A17B` · pot-gold `#F5C542` · text `#F5F7FA` · slate `#7C8794` |
| Type | Space Grotesk (display) · Inter (body) · monospace for hashes/ledger |
| Aesthetic | Floodlit stadium at night; glassmorphism cards, hairline borders, green "verified/locked" glow; the glowing pot is the signature motif |
| Icon | `docs/icon.svg` (+ `docs/icon-512.png`) |
| OG image | `docs/og-image.png` |
| README hero | `docs/readme-hero.png` |
| Entry points | `bin/kitty.js` (terminal) · `index.html` + `app.js` (Pear desktop) |
| Key scripts | `npm run bench` · `npm run verify:p2p` · `npm run check:readiness` · `npm run seed:demo` |
| Env | none required for dry-run/demo; `.env.example` documents real-mode Solana devnet settings |
| Honest limitations | consensus result entry (no oracle) · WDK is beta (pinned) · payouts pull-based, not atomic with finality |
