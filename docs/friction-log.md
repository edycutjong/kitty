# Friction Log — developer experience notes (Pear stack + WDK)

Honest field notes from building The Kitty. Kept because sponsors read these,
and because lesson #16 of our own playbook says honesty builds more trust than
claiming a frictionless ride.

## Tether WDK (`@tetherto/wdk@1.0.0-beta.12`)

1. **ESM-only core in a CJS ecosystem.** The Pear/holepunch world is CommonJS-first; WDK ships `"type": "module"`. Our wallet adapter loads it via dynamic `import()` from CJS — clean, but took a deliberate decision (see `DECISIONS.md`). A dual export would remove the seam.
2. **Version skew inside the beta line.** `@tetherto/wdk` is at `beta.12` while `@tetherto/wdk-wallet-solana` tops out at `beta.11`. They compose fine, but a lockstep release (or a compatibility matrix in the README) would save the "is this pairing supported?" pause.
3. **The policy engine is the hidden gem.** `registerPolicy` + `account.simulate.transfer` giving a full `{decision, matched_rule, reason, trace}` verdict *without spending* is exactly what a guardrail demo needs — our stake-time check is one call. DENY-wins semantics and the Proxy-based enforcement are clearly documented in the source. More examples of `conditions` functions in the docs would help discovery.
4. **Docs vs source drift risk (beta).** We verified every API we rely on against the installed package source rather than docs alone (constructor config keys, `transfer({token, recipient, amount})` → `{hash, fee}`, `PolicyViolationError` fields). Recommended practice at this maturity stage.
5. **Devnet USD₮ story.** There's no canonical devnet USD₮ mint, so demos mint their own 6-decimal SPL stand-in. A documented "testnet USD₮ faucet/mint" would make every hackathon integration look identical (and honest).

## Pear stack (Autobase / Corestore / Hyperswarm / Protomux)

6. **Autobase's determinism contract is strict and worth it.** "The view must be derived only from the linearized nodes" forced our reducer to be clock-free and pure — which is why 3 peers converge byte-identically. The README's warning is easy to skim past; it should be a red box.
7. **`node.length` is the quiet superpower.** Each applied node carries its position in the author's core — that's what makes our kickoff-witnessing rule possible (`snapshot.heads[writer] ≥ commit.seq`). Discovered by reading `lib/apply-state.js`; deserves front-page docs.
8. **Corestore is single-process.** The RocksDB lock means "one CLI command per storage dir" fails when a `watch` holds the store — this *shaped our CLI* into an interactive session (which turned out to be the better demo UX anyway).
9. **Protomux channel sharing just works.** Membership pairing and full corestore replication share one Hyperswarm connection with zero manual framing. `mux.createChannel returning null on duplicates` is a great dedupe primitive — undersold in the docs.
10. **`hyperdht/testnet` makes P2P CI trivial.** Three-node in-process DHT = real swarm tests and reproducible benches with zero external network. This module deserves louder marketing.
11. **Teardown discipline matters.** Un-error-handled connection streams throw `ECONNRESET` on swarm destroy (bit us in `bench.js`); `conn.on('error', noop)` on every connection is effectively mandatory boilerplate.

## Tooling around the edges

12. **`pear` name collision.** On a machine with PHP installed, `which pear` finds PHP's package manager first — cost us a confused minute; worth a note in Pear's install docs (`npm i -g pear` shadows it correctly).
13. **`node --test` glob semantics.** `node --test test/` fails on Node 22 (treated as a module path); `node --test "test/**/*.test.js"` is the reliable form.
