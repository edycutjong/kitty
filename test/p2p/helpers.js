'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function tmpDir (prefix = 'kitty-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// Pipe two corestore replication streams together (in-process "network").
function replicate (storeA, storeB) {
  const s1 = storeA.replicate(true)
  const s2 = storeB.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
  return () => {
    s1.destroy()
    s2.destroy()
  }
}

async function eventually (fn, { timeout = 15000, interval = 50 } = {}) {
  const start = Date.now()
  let lastErr = null
  while (Date.now() - start < timeout) {
    try {
      const v = await fn()
      if (v) return v
    } catch (err) {
      lastErr = err
    }
    await sleep(interval)
  }
  throw lastErr || new Error('eventually: condition not met within timeout')
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitUntil (tsMs) {
  const delta = tsMs - Date.now()
  if (delta > 0) await sleep(delta + 25)
}

module.exports = { tmpDir, replicate, eventually, sleep, waitUntil }
