'use strict'

// Demo insurance for hostile venue wifi: a local DHT the CLI can bootstrap
// from, so the whole two-terminal demo runs with ZERO external network.
//
//   node scripts/local_dht.js
//   node bin/kitty.js create … --bootstrap 127.0.0.1:49737
//   node bin/kitty.js join …   --bootstrap 127.0.0.1:49737

const createTestnet = require('hyperdht/testnet')

async function main () {
  const testnet = await createTestnet(3)
  const nodes = testnet.bootstrap.map(n => `${n.host}:${n.port}`).join(',')
  console.log('local DHT up — pass this to every kitty session:')
  console.log(`  --bootstrap ${nodes}`)
  console.log('(ctrl-c to stop)')
  process.on('SIGINT', async () => {
    await testnet.destroy()
    process.exit(0)
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
