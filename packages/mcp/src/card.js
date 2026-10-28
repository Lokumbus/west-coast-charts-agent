'use strict'
/*
 * Static server card (SEP-1649, used by Smithery when a scan cannot run):
 * served at /.well-known/mcp/server-card.json and written to packaging/server-card.json.
 * Generated from the live server definition so it never drifts from tools/list.
 */
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js')
const { createServer } = require('./server')
const { unavailable } = require('./core')
const pkg = require('../package.json')

async function buildServerCard({ authRequired = false, core } = {}) {
  const server = createServer({ core: core || unavailable('server card generation'), config: { defaultTheme: 'light', maxPixels: 16777216 } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'server-card', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  const info = client.getServerVersion()
  const tools = (await client.listTools()).tools
  const resources = (await client.listResources().catch(() => ({ resources: [] }))).resources.filter((r) => !r.uri.startsWith('wcc://docs/') || r.uri === 'wcc://docs/agent-quickstart')
  const resourceTemplates = (await client.listResourceTemplates()).resourceTemplates
  const prompts = (await client.listPrompts()).prompts
  await client.close()
  await server.close()
  return {
    protocolVersion: '2025-06-18',
    serverInfo: { name: info.name, title: info.title, version: info.version || pkg.version },
    description: pkg.description,
    instructions: client.getInstructions ? client.getInstructions() : undefined,
    authentication: authRequired ? { required: true, schemes: ['bearer'] } : { required: false },
    capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
    tools,
    resources,
    resourceTemplates,
    prompts
  }
}

module.exports = { buildServerCard }
