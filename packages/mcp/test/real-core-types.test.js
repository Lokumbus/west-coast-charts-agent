'use strict'
/* Real library (release/1.1 dist) through MCP: describe_chart / render_chart return the full
 * chart.describe() model (tableSource 'describe') for free types and, on a server started
 * with evaluation: true, for all 13 premium types. Skipped when render-core cannot load. */
const test = require('node:test')
const assert = require('node:assert/strict')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js')
const { createServer } = require('../src/server')
const { loadCore } = require('../src/core')
const { resolveConfig } = require('../src/config')

const core = loadCore()
const skip = core.unavailable ? `render-core unavailable: ${core.unavailable}` : false
const Ajv = require('ajv')
const valid = new Ajv({ strict: false, allErrors: true }).compile(require('./wcc-describe.schema.json'))

async function client(config) {
  const s = createServer({ core, config: { defaultTheme: 'light', maxPixels: 16777216, ...config } })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const c = new Client({ name: 'e2e-types', version: '1' })
  await Promise.all([s.connect(a), c.connect(b)])
  return c
}
let free, evalc
test.before(async () => {
  if (skip) return
  free = await client({})
  evalc = await client({ evaluation: true })
})
test.after(async () => {
  for (const c of [free, evalc]) if (c) await c.close()
})
const example = async (c, id) => (await c.callTool({ name: 'get_example', arguments: { id } })).structuredContent.spec
async function describe(c, id) {
  const r = await c.callTool({ name: 'describe_chart', arguments: { spec: await example(c, id), format: 'json' } })
  assert.ok(!r.isError, id + ': ' + r.content[0].text)
  assert.equal(r.structuredContent.tableSource, 'describe', id)
  const t = r.structuredContent.table
  assert.ok(valid(t), id + ': ' + JSON.stringify(valid.errors))
  return t
}

const FREE = {
  'line-basic': /^Line chart with 2 series/,
  'area-stacked': /^Stacked area chart .* Category totals range from 50 \(Mon\) to 132 \(Sat\)\.$/,
  'pie-basic': /^Pie chart with 3 slices/,
  'gauge-progress': /Value: 72%\.$/,
  'heatmap-basic': /^Heat map chart/,
  'waterfall-pnl': /^Waterfall chart/,
}
const PREMIUM = {
  'sankey-budget': 'sankey',
  'chord-plans': 'chord',
  'radial-column-ring': 'radialColumn',
  'gantt-launch': 'gantt',
  'tree-org': 'tree',
  'stock-acme': 'stock',
  'map-world': 'map',
  'marimekko-market': 'marimekko',
  'network-services': 'network',
  'quint-timeline': 'quintTimeline',
  'quint-convergence': 'quintConvergence',
  'vitals-clock-demo': 'vitalsClock',
  'schedule-demo': 'schedule',
}

test('real: free types -> describe() model, schema-valid, precise text', { skip, timeout: 300000 }, async () => {
  for (const [id, re] of Object.entries(FREE)) {
    const t = await describe(free, id)
    assert.equal(t.premium, false)
    assert.match(t.text, re, id)
    assert.ok(t.series.length && t.marks.length, id)
  }
})

test('real: evaluation server -> all 13 premium types return the describe() model', { skip, timeout: 600000 }, async () => {
  for (const [id, type] of Object.entries(PREMIUM)) {
    const t = await describe(evalc, id)
    assert.equal(t.type, type, id)
    assert.equal(t.premium, true, id)
    assert.ok(t.text.length > 20 && t.table.rows.length > 0, id)
  }
  const g = await describe(evalc, 'gantt-launch')
  assert.match(g.text, /from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\./)
})

test('real: evaluation render is watermarked and says it is unlicensed', { skip, timeout: 120000 }, async () => {
  const r = await evalc.callTool({ name: 'render_chart', arguments: { spec: await example(evalc, 'sankey-budget'), delivery: 'inline' } })
  assert.ok(!r.isError, r.content[0].text)
  assert.equal(r.structuredContent.meta.licensed, false)
  assert.equal(r.structuredContent.tableSource, 'describe')
})

test('real: without evaluation (and no key) premium still fails with kind license', { skip, timeout: 120000 }, async () => {
  const r = await free.callTool({ name: 'describe_chart', arguments: { spec: await example(free, 'gantt-launch') } })
  assert.ok(r.isError)
  assert.equal(JSON.parse(r.content[1].text).error.kind, 'license')
})

test('config: --evaluation / WCC_EVALUATION', () => {
  assert.equal(resolveConfig({ env: {}, argv: [] }).evaluation, false)
  assert.equal(resolveConfig({ env: { WCC_EVALUATION: '1' }, argv: [] }).evaluation, true)
  assert.equal(resolveConfig({ env: {}, argv: ['--evaluation'] }).evaluation, true)
  assert.equal(resolveConfig({ env: { WCC_EVALUATION: 'no' }, argv: [] }).evaluation, false)
})

test('real: licensed premium', { skip: skip || (!process.env.WCC_TEST_LICENSE_KEY_FILE && 'no dedicated test license file'), timeout: 120000 }, async () => {
  const c = await client({ licenseKey: require('fs').readFileSync(process.env.WCC_TEST_LICENSE_KEY_FILE, 'utf8').trim() })
  const r = await c.callTool({ name: 'describe_chart', arguments: { spec: await example(c, 'sankey-budget') } })
  assert.ok(!r.isError)
  await c.close()
})
