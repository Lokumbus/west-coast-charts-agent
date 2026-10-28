'use strict'
/* Streamable HTTP: auth 401 per RFC 9728, PRM, server card, a real tool call over HTTP. */
const test = require('node:test')
const assert = require('node:assert/strict')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { createHttpApp } = require('../src/http')
const fake = require('./fake-core')

function start(env) {
  const app = createHttpApp({ env, core: fake, config: { defaultTheme: 'light', maxPixels: 16777216 } })
  return new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok({ s, url: `http://127.0.0.1:${s.address().port}` }))
  })
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
const post = (url, body, headers = {}) => fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })

test('no auth configured: open endpoint, PRM 404, card says auth not required', async () => {
  const { s, url } = await start({})
  try {
    const r = await post(url, INIT)
    assert.equal(r.status, 200)
    assert.equal((await r.json()).result.serverInfo.name, 'west-coast-charts')
    assert.equal((await fetch(`${url}/.well-known/oauth-protected-resource`)).status, 404)
    const card = await (await fetch(`${url}/.well-known/mcp/server-card.json`)).json()
    assert.equal(card.authentication.required, false)
    assert.equal(card.serverInfo.name, 'west-coast-charts')
    assert.equal(card.tools.length, 7)
    assert.ok(card.tools.every((t) => t.inputSchema && t.annotations))
    assert.equal((await fetch(`${url}/mcp`)).status, 405)
  } finally {
    s.close()
  }
})

test('auth configured: unauthenticated -> 401 (not 403) with RFC 9728 resource_metadata', async () => {
  const { s, url } = await start({ WCC_MCP_AUTH_TOKENS: 'tok-a,tok-b', WCC_MCP_ISSUER: 'https://auth.example' })
  try {
    for (const h of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Basic abc' }]) {
      const r = await post(url, INIT, h)
      assert.equal(r.status, 401, JSON.stringify(h))
      const www = r.headers.get('www-authenticate')
      assert.match(www, /^Bearer /)
      assert.match(www, new RegExp(`resource_metadata="${url}/.well-known/oauth-protected-resource/mcp"`))
    }
    assert.equal((await fetch(`${url}/mcp`)).status, 401)
    const prm = await (await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json()
    assert.equal(prm.resource, `${url}/mcp`)
    assert.deepEqual(prm.authorization_servers, ['https://auth.example'])
    // card and health stay public so registries/scanners can read them behind the auth wall
    const card = await (await fetch(`${url}/.well-known/mcp/server-card.json`)).json()
    assert.equal(card.authentication.required, true)
    assert.equal((await fetch(`${url}/healthz`)).status, 200)
    const ok = await post(url, INIT, { authorization: 'Bearer tok-b' })
    assert.equal(ok.status, 200)
  } finally {
    s.close()
  }
})

test('SDK client over Streamable HTTP: render, licence header, per-tenant render cache', async () => {
  const { s, url } = await start({ WCC_MCP_AUTH_TOKENS: 'tok-a,tok-b' })
  const mk = async (token, extra = {}) => {
    const c = new Client({ name: 'http-test', version: '1' })
    await c.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}`, ...extra } } }))
    return c
  }
  try {
    const a = await mk('tok-a')
    const r = await a.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'line' }, series: [{ name: 's', data: [1, 2] }] } } })
    assert.ok(!r.isError)
    const again = await a.readResource({ uri: r.structuredContent.uri })
    assert.match(again.contents[0].text, /^<svg/)
    const b = await mk('tok-b')
    await assert.rejects(b.readResource({ uri: r.structuredContent.uri }), /not cached/)
    const noKey = await a.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'sankey' }, series: [] } } })
    assert.equal(JSON.parse(noKey.content[1].text).error.kind, 'license')
    const lic = await mk('tok-a', { 'x-wcc-license-key': 'VALID-KEY' })
    const ok = await lic.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'sankey' }, series: [] } } })
    assert.ok(!ok.isError)
    await Promise.all([a.close(), b.close(), lic.close()])
  } finally {
    s.close()
  }
})
