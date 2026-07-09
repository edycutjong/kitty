'use strict'

// Counts the real suite by running it and parsing the TAP summary — the
// number in README.md must match this output exactly.

const { spawnSync } = require('child_process')

const res = spawnSync(process.execPath, ['--test', 'test/**/*.test.js'], {
  encoding: 'utf-8',
  maxBuffer: 64 * 1024 * 1024
})

const out = (res.stdout || '') + (res.stderr || '')
const tests = /^# tests (\d+)$/m.exec(out)
const pass = /^# pass (\d+)$/m.exec(out)
const fail = /^# fail (\d+)$/m.exec(out)

if (!tests) {
  console.error('could not parse test output')
  process.exit(1)
}

const summary = { tests: Number(tests[1]), pass: Number(pass[1]), fail: Number(fail[1]) }
console.log(JSON.stringify(summary))
process.exit(summary.fail > 0 ? 1 : 0)
