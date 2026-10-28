'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { connect } = require('./helpers')

let c
test.before(async () => { c = await connect() })
test.after(async () => c.close())

test('resources: quickstart, errors, version, docs listed and readable', async () => {
  const { resources } = await c.client.listResources()
  const uris = resources.map((r) => r.uri)
  for (const u of ['wcc://docs/agent-quickstart', 'wcc://errors', 'wcc://version']) assert.ok(uris.includes(u), u)
  const docs = resources.filter((r) => r.uri.startsWith('wcc://docs/') && r.uri !== 'wcc://docs/agent-quickstart')
  assert.ok(docs.length >= 5, `library docs listed (${docs.length})`)
  assert.ok(docs.every((d) => d.mimeType === 'text/markdown'))
  const page = await c.client.readResource({ uri: docs[0].uri })
  assert.ok(page.contents[0].text.length > 100)
  const errs = JSON.parse((await c.client.readResource({ uri: 'wcc://errors' })).contents[0].text)
  assert.ok(errs.kinds.find((k) => k.kind === 'license').mcp)
  const qs = await c.client.readResource({ uri: 'wcc://docs/agent-quickstart' })
  assert.match(qs.contents[0].text, /validate_chart/)
  const { resourceTemplates } = await c.client.listResourceTemplates()
  assert.deepEqual(resourceTemplates.map((t) => t.uriTemplate).sort(), ['wcc://docs/{slug}', 'wcc://renders/{id}'])
})

test('unknown render resource -> error mentioning render_chart', async () => {
  await assert.rejects(c.client.readResource({ uri: 'wcc://renders/deadbeef.svg' }), /render_chart/)
})

test('prompts: build_dashboard and pick_chart_type', async () => {
  const { prompts } = await c.client.listPrompts()
  assert.deepEqual(prompts.map((p) => p.name).sort(), ['build_dashboard', 'pick_chart_type'])
  const p = await c.client.getPrompt({ name: 'build_dashboard', arguments: { goal: 'ops room', charts: '4' } })
  assert.match(p.messages[0].content.text, /about 4 charts/)
  assert.match(p.messages[0].content.text, /validate_chart/)
  const q = await c.client.getPrompt({ name: 'pick_chart_type', arguments: { data: 'p95 per region per hour' } })
  assert.match(q.messages[0].content.text, /list_chart_types/)
})
