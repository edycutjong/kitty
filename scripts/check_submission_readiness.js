'use strict'

// Submission gate — fails while ANY claim in the docs is ahead of the build.
// This script failing is a feature: it is the honesty mechanism the specs
// demand. Run: npm run check:readiness

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const failures = []
const warnings = []

function read (rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8')
  } catch {
    return null
  }
}

function check (ok, label, { warn = false } = {}) {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else if (warn) {
    warnings.push(label)
    console.log(`  ⚠ ${label}`)
  } else {
    failures.push(label)
    console.log(`  ✗ ${label}`)
  }
}

console.log('the-kitty submission readiness\n')

// ── files that must exist ──
for (const f of ['README.md', 'LICENSE', 'DEMO.md', 'docs/ARCHITECTURE.md', 'landing/index.html', 'bench-results.json', 'the-kitty_dorahacks_submission.md', 'docs/AUDIT_REPORT.md', 'docs/friction-log.md', '.github/workflows/ci.yml', '.env.example']) {
  check(read(f) !== null, `${f} exists`)
}

// ── license is Apache 2.0 (binding hackathon rule) ──
const license = read('LICENSE') || ''
check(/Apache License/i.test(license) && /Version 2\.0/i.test(license), 'LICENSE is Apache 2.0')

// ── placeholder scan across judge-facing docs ──
const PLACEHOLDER = /TODO|FIXME|PLACEHOLDER|⬜|FILL[- _]?ME|lorem ipsum|your-video|OWNER\/REPO|<repo>|example\.com/i
for (const f of ['README.md', 'DEMO.md', 'the-kitty_dorahacks_submission.md', 'docs/ARCHITECTURE.md']) {
  const body = read(f)
  if (body === null) continue
  const hit = PLACEHOLDER.exec(body)
  check(!hit, `${f} has no placeholders${hit ? ` (found "${hit[0]}")` : ''}`)
}

// ── test count in README must match the real suite ──
const readme = read('README.md') || ''
const claimed = /\*\*(\d+)\s+tests?\*\*/.exec(readme)
check(!!claimed, 'README states the exact test count in bold')
if (claimed) {
  const res = spawnSync(process.execPath, ['scripts/count_tests.js'], { cwd: root, encoding: 'utf-8' })
  try {
    const actual = JSON.parse(res.stdout.trim())
    check(actual.fail === 0, `test suite is green (${actual.pass}/${actual.tests})`)
    check(Number(claimed[1]) === actual.tests, `README test count (${claimed[1]}) matches reality (${actual.tests})`)
  } catch {
    check(false, 'test suite runs and is parseable')
  }
}

// ── proof-of-production gates (EXTERNAL pendings — warn, don't block) ──
// A real devnet tx + explorer link can only exist after a funded `--real`
// settle run; the YouTube URL only after the video is uploaded; the form
// fields only a human can fill. These WARN (exit 0) so `npm run ci` isn't
// red for reasons outside the code — they still surface as the remaining
// pre-submission checklist. (Dishonesty guards below stay blocking.)
check(/explorer\.solana\.com\/tx\//.test(readme), 'README embeds real devnet tx explorer links (run the settle flow with --real)', { warn: true })
// Flag actual dry-run tx IDS pasted as proof (DRYRUN-<hex>), not the prose
// that honestly explains the DRYRUN- labelling convention.
const realSection = readme.split(/^## .*Real-money mode.*$/m)[1]?.split(/^## /m)[0] || ''
check(!/DRYRUN-[0-9a-f]{6,}/.test(realSection), 'real-money section contains no dry-run tx ids presented as proof')

// ── submission bundle gates ──
const sub = read('the-kitty_dorahacks_submission.md') || ''
check(/https:\/\/github\.com\//.test(sub), 'submission has a public GitHub repo URL')
check(/https:\/\/(www\.)?(youtube\.com\/watch|youtu\.be\/)/.test(sub), 'submission has a real YouTube demo video URL', { warn: true })
check(!/\(pending/.test(sub), 'submission has no (pending) fields left', { warn: true })
check(/thank/i.test(sub), 'submission ends with a personal thank-you')

// ── bench freshness ──
try {
  const bench = JSON.parse(read('bench-results.json'))
  check(bench.convergenceMs.p95 < 1000, `bench convergence p95 (${bench.convergenceMs.p95}ms) under 1s target`)
} catch {
  check(false, 'bench-results.json parses')
}

console.log(`\n${failures.length} blocking gap(s), ${warnings.length} warning(s)`)
if (failures.length) {
  console.log('NOT submission-ready — every BLOCKING gate above must pass before the DoraHacks form is touched.')
  process.exit(1)
}
if (warnings.length) {
  console.log(`submission-ready pending ${warnings.length} external step(s) — resolve before the Jul 14 deadline:`)
  for (const w of warnings) console.log(`   · ${w}`)
} else {
  console.log('submission-ready ✓')
}
