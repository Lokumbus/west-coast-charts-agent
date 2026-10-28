'use strict'
/* The real binary over stdio (as Claude Desktop / Cursor / .mcpb run it), core swapped via WCC_RENDER_CORE. */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')

test('stdio: initialize, list, call, licence via --license-key', async () => {
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'bin', 'wcc-mcp.js'), '--license-key', 'VALID-KEY'],
    env: { ...process.env, WCC_RENDER_CORE: path.join(__dirname, 'fake-core.js') },
    stderr: 'pipe'
  })
  const c = new Client({ name: 'stdio-test', version: '1' })
  await c.connect(t)
  const { tools } = await c.listTools()
  assert.equal(tools.length, 7)
  const r = await c.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'radialColumn' } } } })
  assert.ok(!r.isError, r.content[0].text)
  await c.close()
})

test('stdio: missing core -> server still starts, tools return internal envelope', async () => {
  const t = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'bin', 'wcc-mcp.js')],
    env: { ...process.env, WCC_RENDER_CORE: '/nonexistent/core.js' },
    stderr: 'pipe'
  })
  const c = new Client({ name: 'stdio-test', version: '1' })
  await c.connect(t)
  const r = await c.callTool({ name: 'list_chart_types', arguments: {} })
  assert.equal(r.isError, true)
  assert.equal(JSON.parse(r.content[1].text).error.kind, 'internal')
  await c.close()
})
