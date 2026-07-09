# DEMO.md — exact steps & expected outputs

Two ways to see everything: the **scripted proof** (30 seconds, zero interaction) and the **live two-terminal pot** (the real thing). Both need only `npm install` — no env vars, no accounts, no cloud.

## 0. The 30-second proof

```bash
npm run verify:p2p
```

Expected: a live event stream from **3 real peers on an in-process DHT** — connections opening, join-requests admitted, Autobase merges — ending with:

```
══ INVARIANT REPORT ═══════════════════════════════
  identical state on all 3 peers      ✓
  Σ payouts == Σ stakes (60 == 60)    ✓
  winner set == [ana]                 ✓
  back-dated pick neutralized         ✓
  pot settled, peer-to-peer           ✓
═══════════════════════════════════════════════════
ALL INVARIANTS HELD — no server was harmed (or used) in this demo.
```

Exit code 0 = every protocol invariant held.

## 1. The live two-terminal pot (~4 minutes)

### Terminal 1 — Ana opens the pot

```bash
node bin/kitty.js create --dir /tmp/kitty-ana --name ana \
  --match "Brazil vs Argentina" --buy-in 20 --kickoff +2m
```

Expected on screen:
- `wallet DRY… (dry-run)` — a deterministic self-custodial wallet
- `pot open: Brazil v Argentina · buy-in 20 USD₮ · kickoff <time>`
- `invite your mates:  pear://kitty/…` ← **copy this**
- `swarm joined — no server anywhere, peers find each other by topic`

### Terminal 2 — Ben joins by invite

```bash
node bin/kitty.js join "pear://kitty/…" --dir /tmp/kitty-ben --name ben
```

Expected: `⇄ peer connected (1 live)` on both terminals, then on Ben's side
`you're in — a member admitted your key` (terminal 1 shows `+ admitted ben to the pot`). Nobody configured anything — the pairing channel did it.

### Both terminals — stake and seal

```
kitty> stake
  ✓ Transaction Policy: ALLOW (cap respected)
  pledged 20 USD₮ — settles peer-to-peer at full-time

kitty> pick 2-1        (terminal 1)
kitty> pick 0-0        (terminal 2)
  pick sealed 🔒 <hash>… (salt stays on this device until reveal)
```

Run `status` on either side — both show the identical pot, members, and sealed (unrevealed) picks. That's Autobase: no backend, same state.

### ⏱ Kickoff (2 minutes elapse)

Both terminals print automatically:

```
🔒 kickoff — picks locked; you witnessed 2 member logs
```

**The money shot** — try to cheat in either terminal:

```
kitty> pick 2-1
  ✗ pick already sealed — picks are immutable
```

Then check `ledger`: any post-kickoff commit attempt shows **struck through in red** with `rejected: after-kickoff`. The append-only log makes tampering evidence, not argument.

### Reveal, resolve, settle

```
kitty> reveal              (both terminals)
  revealed 2–1 — hash-checked against your sealed commitment

kitty> result 2-1          (both terminals — quorum is 2 of 2)
  voted 2–1 — finalizes at quorum of stakers

kitty> settle              (terminal 2 — ben lost)
  paid 20 USD₮ → <ana's key>  tx DRYRUN-…

kitty> status              (either side)
  split mode win · Σ paid 40 == Σ staked 40 ✓
  status settled
```

### Clean up

`quit` in both terminals; `rm -rf /tmp/kitty-ana /tmp/kitty-ben`.

## 2. Real devnet money (optional, for the recorded demo)

```bash
cp .env.example .env               # set KITTY_TOKEN_MINT (see comments inside)
# fund both wallets' ATAs from your devnet mint, then add --real to both commands
```

At `settle`, each transfer prints a real signature + `https://explorer.solana.com/tx/…?cluster=devnet` link. Over-stake the cap (`--max-buy-in 5` then `stake`) to see the **real WDK `PolicyViolationError`** on screen.

## 3. Desktop app (Pear runtime)

```bash
npm i -g pear
pear run --dev .
```

Same protocol, floodlit-stadium UI: glowing pot, live peer rail, tamper-evident ledger timeline, settlement flow with Σ==Σ proof strip.

## 3-minute video beat map

| t | beat | on screen |
|---|---|---|
| 0:00–0:20 | the treasurer problem | title card + one sentence |
| 0:20–0:50 | create + join by invite | two terminals side by side, `⇄ peer connected` |
| 0:50–1:20 | stake with policy check | `Transaction Policy: ALLOW` · then a cap-violation DENY |
| 1:20–1:50 | seal picks, kickoff lock | `pick sealed 🔒` → `🔒 kickoff — picks locked` |
| 1:50–2:20 | **cheat attempt rejected live** | red strikethrough in `ledger` |
| 2:20–2:50 | result quorum + settle | `Σ paid == Σ staked ✓ · settled`, explorer link |
| 2:50–3:00 | close | "No server was harmed (or used)." + repo URL |
