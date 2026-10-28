'use strict'
/* End-to-end against the real @wcc-agent/render-core (skipped when it cannot load yet). */
const test = require('node:test')
const assert = require('node:assert/strict')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js')
const { createServer } = require('../src/server')
const { loadCore } = require('../src/core')

const core = loadCore()
const skip = core.unavailable ? `render-core unavailable: ${core.unavailable}` : false
const env = (r) => r.isError && JSON.parse(r.content[1].text).error
let c, s
test.before(async () => {
  if (skip) return
  s = createServer({ core, config: { defaultTheme: 'light', maxPixels: 16777216 } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  c = new Client({ name: 'e2e', version: '1' })
  await Promise.all([s.connect(a), c.connect(b)])
})
test.after(async () => { if (c) await c.close() })

const SPEC = { chart: { type: 'bar' }, series: [{ name: 'Revenue', data: [12, 19, 7] }], xaxis: { categories: ['Q1', 'Q2', 'Q3'] } }

test('real: render svg deterministic + table', { skip, timeout: 120000 }, async () => {
  const a = await c.callTool({ name: 'render_chart', arguments: { spec: SPEC, seed: 5 } })
  assert.ok(!a.isError, a.content[0].text)
  assert.match(a.content.find((x) => x.type === 'resource').resource.text, /<svg/)
  const b = await c.callTool({ name: 'render_chart', arguments: { spec: SPEC, seed: 5 } })
  assert.equal(a.structuredContent.sha256, b.structuredContent.sha256)
  const t = a.structuredContent.table
  assert.equal(t.schema, 'wcc-describe/1')
  assert.ok(t.table.rows.length >= 3)
  assert.ok(t.table.rows.flat().every((cell) => typeof cell === 'string'))
  // the source is reported next to the table (meta.tableSource), never inside it; the table is always schema-valid
  assert.equal(a.structuredContent.tableSource, 'describe')
  assert.equal(a.structuredContent.tableSource, a.structuredContent.meta.tableSource)
  assert.equal(t.source, undefined)
  const Ajv = require('ajv')
  const v = new Ajv({ strict: false, allErrors: true }).compile(require('./wcc-describe.schema.json'))
  assert.ok(v(t), JSON.stringify(v.errors))
  const d = await c.callTool({ name: 'describe_chart', arguments: { spec: SPEC, seed: 5, format: 'json' } })
  assert.equal(d.structuredContent.tableSource, a.structuredContent.tableSource)
  assert.deepEqual(d.structuredContent.table, t)
})

test('real: render png', { skip, timeout: 120000 }, async () => {
  const r = await c.callTool({ name: 'render_chart', arguments: { spec: SPEC, format: 'png', width: 400, height: 240 } })
  assert.ok(!r.isError, r.content[0].text)
  const png = Buffer.from(r.content.find((x) => x.type === 'image').data, 'base64')
  assert.equal(png.slice(1, 4).toString(), 'PNG')
})

test('real: validate, describe, schema, types, examples', { skip, timeout: 120000 }, async () => {
  const v = await c.callTool({ name: 'validate_chart', arguments: { spec: { ...SPEC, xaxsi: {} } } })
  assert.ok(!v.isError, v.content[0].text)
  assert.equal(v.structuredContent.ok, false)
  const d = await c.callTool({ name: 'describe_chart', arguments: { spec: SPEC } })
  assert.ok(!d.isError, d.content[0].text)
  const g = await c.callTool({ name: 'get_schema', arguments: { depth: 0 } })
  assert.ok(!g.isError, g.content[0].text)
  const t = await c.callTool({ name: 'list_chart_types', arguments: {} })
  assert.ok(t.structuredContent.types.some((x) => x.type === 'sankey' && x.premium))
  const l = await c.callTool({ name: 'list_examples', arguments: { limit: 3 } })
  assert.ok(l.structuredContent.total > 0)
  const free = (await c.callTool({ name: 'list_examples', arguments: { premium: false, limit: 1 } })).structuredContent.examples[0]
  const e = await c.callTool({ name: 'get_example', arguments: { id: free.id } })
  const r = await c.callTool({ name: 'render_chart', arguments: { spec: e.structuredContent.spec, delivery: 'link' } })
  assert.ok(!r.isError, r.content[0].text)
})

test('real: premium without key -> license', { skip, timeout: 120000 }, async () => {
  const r = await c.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'sankey' }, series: [] } } })
  assert.equal(env(r).kind, 'license')
  assert.equal(env(r).details.reason, 'license_required')
})
