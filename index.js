'use strict'

// Library entrypoint — The Kitty's protocol as reusable building blocks.
// (The Pear desktop app boots from index.html; the CLI from bin/kitty.js.)

module.exports = {
  core: require('./src/core'),
  p2p: require('./src/p2p'),
  wallet: require('./src/wallet')
}
