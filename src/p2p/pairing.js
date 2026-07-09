'use strict'

// First-contact membership handshake, multiplexed on the SAME connection the
// Corestore replicates over (Protomux shares the stream). A joiner announces
// its writer key; any existing member appends the add-writer op. Everything
// else — state, picks, money — flows through the Autobase, never this channel.

const Protomux = require('protomux')
const c = require('compact-encoding')

const PROTOCOL = 'the-kitty/pairing/1'

function attachPairing (conn, handlers) {
  const mux = Protomux.from(conn)
  const channel = mux.createChannel({
    protocol: PROTOCOL,
    onclose () {
      /* c8 ignore next -- reserved: nothing calls pairing.close(); the channel auto-closes with the connection */
      if (handlers.onclose) handlers.onclose()
    }
  })
  /* c8 ignore next -- defensive: the swarm attaches pairing once per connection, so a duplicate (null) channel doesn't arise in practice */
  if (channel === null) return null // duplicate channel on this stream

  const joinRequest = channel.addMessage({
    encoding: c.json,
    onmessage (msg) {
      if (msg && typeof msg.key === 'string' && typeof msg.name === 'string') {
        handlers.onJoinRequest(msg)
      }
    }
  })

  const welcome = channel.addMessage({
    encoding: c.json,
    /* c8 ignore start -- reserved handshake: the live flow admits via the Autobase add-writer op, so no peer sends a welcome */
    onmessage (msg) {
      if (handlers.onWelcome) handlers.onWelcome(msg)
    }
    /* c8 ignore stop */
  })

  channel.open()

  return {
    channel,
    requestJoin ({ key, name }) {
      joinRequest.send({ key, name })
    },
    /* c8 ignore start -- reserved membership API: nothing calls sendWelcome/close; admission is via the add-writer op and the channel auto-closes with the conn */
    sendWelcome (info) {
      welcome.send(info)
    },
    close () {
      channel.close()
    }
    /* c8 ignore stop */
  }
}

module.exports = { attachPairing, PROTOCOL }
