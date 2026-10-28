'use strict'
/* Inspector-style contract tests: tools/list metadata + every tool's success and error path. */
const test = require('node:test')
const assert = require('node:assert/strict')
const { connect, envelope, fake } = require('./helpers')

const TOOLS = ['render_chart', 'validate_chart', 'describe_chart', 'get_schema', 'list_chart_types', 'list_examples', 'get_example']
const SPEC = { chart: { type: 'bar' }, series: [{ name: 'Revenue', data: [12, 19, 7] }] }

let c
test.before(async () => { c = await connect() })
test.after(async () => c.close())

test('initialize: server info, instructions, capabilities', () => {
  const info = c.client.getServerVersion()
  assert.equal(info.name, 'west-coast-charts')
  assert.match(info.version, /^\d+\.\d+\.\d+/)
  assert.match(c.client.getInstructions(), /validate_chart/)
  const caps = c.client.getServerCapabilities()
  assert.ok(caps.tools && caps.resources && caps.prompts)
})

test('tools/list: exact set, complete metadata for automated graders', async () => {
  const { tools } = await c.client.listTools()
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort())
  for (const t of tools) {
    assert.ok(t.title, `${t.name} title`)
    assert.ok(t.description.length > 120, `${t.name} description is substantive`)
    assert.match(t.description, /[Rr]ead-only/, `${t.name} states side effects`)
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.outputSchema && t.outputSchema.type === 'object', `${t.name} outputSchema`)
    for (const [k, p] of Object.entries(t.inputSchema.properties || {})) assert.ok(p.description, `${t.name}.${k} has a description`)
    assert.deepEqual(
      { r: t.annotations.readOnlyHint, i: t.annotations.idempotentHint, d: t.annotations.destructiveHint, o: t.annotations.openWorldHint },
      { r: true, i: true, d: false, o: false },
      `${t.name} annotations`
    )
  }
  const withSpec = tools.filter((t) => t.inputSchema.properties && t.inputSchema.properties.spec)
  for (const t of withSpec) {
    assert.deepEqual(t.inputSchema.required.includes('spec'), true)
    assert.match(t.description, /Example: \{/, `${t.name} has an example call`)
  }
})

test('render_chart svg: embedded resource + table + structured content', async () => {
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, seed: 7, width: 640, height: 360 } })
  assert.ok(!r.isError)
  const res = r.content.find((x) => x.type === 'resource')
  assert.equal(res.resource.mimeType, 'image/svg+xml')
  assert.match(res.resource.text, /^<svg[^>]+data-seed="7"/)
  assert.match(r.content[0].text, /Verification table/)
  assert.equal(r.structuredContent.mimeType, 'image/svg+xml')
  assert.equal(r.structuredContent.meta.width, 640)
  assert.match(r.structuredContent.sha256, /^[0-9a-f]{64}$/)
  assert.equal(r.structuredContent.table.schema, 'wcc-describe/1')
  assert.deepEqual(r.structuredContent.table.table.columns, ['series', 'value'])
  assert.deepEqual(r.structuredContent.table.table.rows, [['Revenue', '3']])
  // the render is readable as a resource afterwards
  const read = await c.client.readResource({ uri: r.structuredContent.uri })
  assert.equal(read.contents[0].text, res.resource.text)
})

test('render_chart is deterministic for same spec+seed', async () => {
  const a = await c.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, seed: 3 } })
  const b = await c.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, seed: 3 } })
  assert.equal(a.structuredContent.sha256, b.structuredContent.sha256)
})

test('render_chart png: image content', async () => {
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, format: 'png', scale: 2 } })
  const img = r.content.find((x) => x.type === 'image')
  assert.equal(img.mimeType, 'image/png')
  assert.equal(Buffer.from(img.data, 'base64')[1], 0x50)
})

test('render_chart delivery link: resource_link only (token saving)', async () => {
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, delivery: 'link' } })
  assert.ok(r.content.some((x) => x.type === 'resource_link'))
  assert.ok(!r.content.some((x) => x.type === 'resource' || x.type === 'image'))
})

test('render_chart invalid spec -> isError schema envelope with issues', async () => {
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'bar' }, serise: [] } } })
  assert.equal(r.isError, true)
  const e = envelope(r)
  assert.equal(e.kind, 'schema')
  assert.equal(e.details.issues[0].suggestion, 'series')
  assert.equal(r.structuredContent, undefined)
  assert.match(r.content[0].text, /^schema: /)
})

test('render_chart premium without key -> kind license (reason license_required), core not called', async () => {
  const { fake } = require('./helpers')
  const before = fake.calls.length
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'sankey' }, series: [] } } })
  assert.equal(r.isError, true)
  const e = envelope(r)
  assert.equal(e.kind, 'license')
  assert.equal(e.details.reason, 'license_required')
  assert.match(e.hint, /WCC_LICENSE_KEY/)
  assert.equal(fake.calls.length, before)
})

test('render_chart premium with configured key renders', async () => {
  const k = await connect({ licenseKey: 'VALID-KEY' })
  const r = await k.client.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'sankey' }, series: [] } } })
  assert.ok(!r.isError)
  assert.equal(r.structuredContent.meta.licensed, true)
  await k.close()
})

test('render_chart premium with bad key -> core licence error passes through', async () => {
  const k = await connect({ licenseKey: 'WRONG' })
  const r = await k.client.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'radialColumn' } } } })
  assert.equal(envelope(r).kind, 'license')
  await k.close()
})

test('render_chart pixel limit -> usage', async () => {
  const k = await connect({ maxPixels: 10000 })
  const r = await k.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, width: 800, height: 450 } })
  assert.equal(envelope(r).kind, 'usage')
  await k.close()
})

test('render_chart renderer crash -> internal envelope, not protocol error', async () => {
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'bar', crash: true } }, validate: 'off' } })
  assert.equal(r.isError, true)
  assert.equal(envelope(r).kind, 'internal')
})

test('bad arguments (schema violation) -> isError usage envelope, not JSON-RPC error', async () => {
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, format: 'gif' } })
  assert.equal(r.isError, true)
  assert.equal(envelope(r).kind, 'usage')
  const r2 = await c.client.callTool({ name: 'render_chart', arguments: { spec: { series: [] } } })
  assert.equal(envelope(r2).kind, 'usage')
})

test('unknown tool -> isError not_found envelope', async () => {
  const r = await c.client.callTool({ name: 'draw_chart', arguments: {} })
  assert.equal(r.isError, true)
  assert.equal(envelope(r).kind, 'not_found')
})

test('validate_chart: invalid spec is a normal result with suggestions', async () => {
  const r = await c.client.callTool({ name: 'validate_chart', arguments: { spec: { chart: { type: 'bar' }, xaxsi: {} } } })
  assert.ok(!r.isError)
  assert.equal(r.structuredContent.ok, false)
  assert.equal(r.structuredContent.errors[0].suggestion, 'xaxis')
  assert.match(r.content[0].text, /INVALID/)
  const ok = await c.client.callTool({ name: 'validate_chart', arguments: { spec: SPEC } })
  assert.equal(ok.structuredContent.ok, true)
})

test('validate_chart: data replaces series', async () => {
  const r = await c.client.callTool({ name: 'validate_chart', arguments: { spec: { chart: { type: 'line' } }, data: [{ name: 'x', data: [1] }] } })
  assert.equal(r.structuredContent.ok, true)
})

test('describe_chart markdown + json', async () => {
  const md = await c.client.callTool({ name: 'describe_chart', arguments: { spec: SPEC } })
  assert.match(md.content[0].text, /\| series \| value \|/)
  assert.match(md.content[0].text, /source: stub/)
  const js = await c.client.callTool({ name: 'describe_chart', arguments: { spec: SPEC, format: 'json' } })
  const d = JSON.parse(js.content[0].text)
  assert.equal(d.schema, 'wcc-describe/1')
  assert.deepEqual(d.table.rows, [['Revenue', '3']])
  assert.deepEqual(js.structuredContent.table, d)
  assert.equal(js.structuredContent.tableSource, 'stub')
  assert.equal(js.content[1].text, 'tableSource: stub')
  const p = await c.client.callTool({ name: 'describe_chart', arguments: { spec: { chart: { type: 'radialColumn' } } } })
  assert.equal(envelope(p).kind, 'license')
})

test('get_schema: root, slice, depth trimming, unknown path', async () => {
  const root = await c.client.callTool({ name: 'get_schema', arguments: { depth: 0 } })
  const chart = root.structuredContent.schema.properties.chart
  assert.deepEqual(chart['x-wcc-keys'], ['type', 'toolbar'])
  assert.equal(chart['x-wcc-more'], 'get_schema {"path":"chart"}')
  const slice = await c.client.callTool({ name: 'get_schema', arguments: { path: 'plotOptions.radialColumn' } })
  assert.deepEqual(slice.structuredContent.schema.properties.aggregate.enum, ['sum', 'mean', 'max', 'min', 'none'])
  const bad = await c.client.callTool({ name: 'get_schema', arguments: { path: 'plotOptions.radialColum' } })
  assert.equal(envelope(bad).kind, 'not_found')
  assert.match(envelope(bad).hint, /radialColumn/)
  const inj = await c.client.callTool({ name: 'get_schema', arguments: { path: 'a"; rm -rf' } })
  assert.equal(envelope(inj).kind, 'usage')
})

test('list_chart_types: free/premium split', async () => {
  const r = await c.client.callTool({ name: 'list_chart_types', arguments: {} })
  assert.equal(r.structuredContent.licensed, false)
  assert.ok(r.structuredContent.types.find((t) => t.type === 'sankey').premium)
  assert.match(r.content[0].text, /licence key required/)
})

test('list_examples: order kept (strongest first), filters, paging', async () => {
  const all = await c.client.callTool({ name: 'list_examples', arguments: {} })
  assert.equal(all.structuredContent.examples[0].id, 'ops-latency-heatmap')
  assert.equal(all.structuredContent.total, 3)
  const q = await c.client.callTool({ name: 'list_examples', arguments: { query: 'LATENCY region' } })
  assert.deepEqual(q.structuredContent.examples.map((e) => e.id), ['ops-latency-heatmap'])
  const free = await c.client.callTool({ name: 'list_examples', arguments: { premium: false, limit: 1 } })
  assert.equal(free.structuredContent.examples.length, 1)
  assert.match(free.content[0].text, /more \(offset 1\)/)
  assert.equal(free.structuredContent.examples[0].spec, undefined)
})

test('get_example: spec + not_found', async () => {
  const r = await c.client.callTool({ name: 'get_example', arguments: { id: 'line-basic' } })
  assert.equal(r.structuredContent.spec.chart.type, 'line')
  const bad = await c.client.callTool({ name: 'get_example', arguments: { id: 'nope' } })
  assert.equal(envelope(bad).kind, 'not_found')
})

test('example spec renders unchanged (get_example -> render_chart)', async () => {
  const e = await c.client.callTool({ name: 'get_example', arguments: { id: 'line-basic' } })
  const r = await c.client.callTool({ name: 'render_chart', arguments: { spec: e.structuredContent.spec } })
  assert.ok(!r.isError)
})

test('describe_chart: full wcc-describe/1 model validates against E2 schema; markdown shows aggregates', async () => {
  const Ajv = require('ajv')
  const validate = new Ajv({ strict: false, allErrors: true }).compile(require('./wcc-describe.schema.json'))
  const full = { chart: { type: 'line', full: true }, series: [{ name: 'a', data: [1, 2, 3] }] }
  const r = await c.client.callTool({ name: 'describe_chart', arguments: { spec: full, format: 'json' } })
  assert.ok(!r.isError, r.content[0].text)
  assert.equal(r.structuredContent.tableSource, 'describe')
  assert.equal(r.structuredContent.table.source, undefined, 'table stays schema-valid wcc-describe/1')
  assert.ok(validate(r.structuredContent.table), JSON.stringify(validate.errors))
  // the core was asked for meta (meta.tableSource), not left to guess
  assert.ok(fake.calls.some(([k, , o]) => k === 'table' && o && o.withMeta === true))
  const md = await c.client.callTool({ name: 'describe_chart', arguments: { spec: full } })
  assert.match(md.content[0].text, /Peak p95: 3 ms \(max\)/)
  assert.match(md.content[0].text, /a: Highest value 3 \(max\)/)
  const rr = await c.client.callTool({ name: 'render_chart', arguments: { spec: full, delivery: 'link' } })
  assert.ok(!rr.isError, rr.content[0].text)
  assert.equal(rr.structuredContent.table.aggregate.mode, 'max')
  assert.equal(rr.structuredContent.tableSource, 'describe')
  assert.equal(rr.structuredContent.meta.tableSource, 'describe')
  assert.match(rr.content[0].text, /source: describe/)
  assert.doesNotMatch(md.content[0].text, /source: stub/)
})

test('describe_chart/render_chart: meta.tableSource read from the core (stub), legacy top-level source still understood', async () => {
  const stub = await c.client.callTool({ name: 'render_chart', arguments: { spec: SPEC, delivery: 'link' } })
  assert.equal(stub.structuredContent.tableSource, 'stub')
  assert.match(stub.content[0].text, /source: stub/)
  assert.match(stub.content[0].text, /basic table \(source: stub\)/)
  const legacy = await c.client.callTool({ name: 'describe_chart', arguments: { spec: { chart: { type: 'line', full: true, legacySource: true }, series: [{ name: 'a', data: [1] }] }, format: 'json' } })
  assert.ok(!legacy.isError, legacy.content[0].text)
  assert.equal(legacy.structuredContent.tableSource, 'describe')
  assert.equal(legacy.structuredContent.table.source, undefined)
})

test('describe_chart: max_rows truncation note', async () => {
  const many = { chart: { type: 'line' }, series: Array.from({ length: 5 }, (_, i) => ({ name: `s${i}`, data: [1] })) }
  const md = await c.client.callTool({ name: 'describe_chart', arguments: { spec: many, max_rows: 2 } })
  assert.match(md.content[0].text, /3 more rows not shown \(raise max_rows\)/)
})

test('licence reasons: no key -> license_required, invalid key from core -> license_invalid', async () => {
  const none = await c.client.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'sankey' }, series: [] } } })
  assert.equal(envelope(none).kind, 'license')
  assert.equal(envelope(none).details.reason, 'license_required')
  const { connect } = require('./helpers')
  const k = await connect({ licenseKey: 'BAD-KEY' })
  try {
    const bad = await k.client.callTool({ name: 'render_chart', arguments: { spec: { chart: { type: 'sankey' }, series: [] } } })
    assert.equal(envelope(bad).kind, 'license')
    assert.equal(envelope(bad).details.reason, 'license_invalid')
  } finally { await k.close() }
})
