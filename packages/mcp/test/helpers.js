'use strict'
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js')
const { createServer } = require('../src/server')
const fake = require('./fake-core')

async function connect(config = {}) {
  const server = createServer({ core: fake, config: { defaultTheme: 'light', maxPixels: 16777216, ...config } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'contract-test', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  return { client, server, close: async () => { await client.close(); await server.close() } }
}
const envelope = (r) => r.isError && JSON.parse(r.content[1].text).error
module.exports = { connect, envelope, fake }
