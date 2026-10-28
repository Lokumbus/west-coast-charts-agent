'use strict'
// Real library end to end: `wcc chart table` returns the full chart.describe() model of the
// release/1.1 dist (not the DOM stub) for free types and, with --evaluation, all 9 premium types.
const test = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('child_process')
const path = require('path')
const { paths } = require('@wcc-agent/render-core/src/lib')

const BIN = path.join(__dirname, '..', 'bin', 'wcc.js')
const env = Object.assign({}, process.env, { WCC_LICENSE_KEY: '', NO_COLOR: '1' })
let lib = null
try {
  lib = paths()
} catch (e) {
  /* no library */
}
const skip = !lib ? 'library not found' : !lib.describe ? `library ${lib.version} has no dist/agent/describe` : false
const run = (args) => spawnSync(process.execPath, [BIN, ...args], { input: '', env, maxBuffer: 64 << 20 })
const table = (id, extra = []) => {
  const r = run(['chart', 'table', 'example:' + id, '--json', ...extra])
  assert.strictEqual(r.status, 0, r.stderr.toString())
  return JSON.parse(r.stdout.toString())
}
const ISO_DAY = /\d{4}-\d{2}-\d{2}/

// id -> what the describe() text must say (precision checks: names, units, aggregates, dates)
const FREE = {
  'line-basic': /^Line chart with 2 series: Web, Mobile\. 12 data points per series\./,
  'area-stacked': /^Stacked area chart with 3 series.* Category totals range from 50 \(Mon\) to 132 \(Sat\)\.$/,
  'bar-horizontal': /^Bar chart with 1 series/,
  'column-grouped': /^Column chart with 2 series/,
  'pie-basic': /^Pie chart with 3 slices/,
  'gauge-progress': /^Gauge chart with 1 series: Progress\. Value: 72%\.$/,
  'heatmap-basic': /^Heat map chart with 3 series/,
  'waterfall-pnl': /^Waterfall chart with 1 series/,
  'funnel-conversion': /^Funnel chart/,
  'scatter-basic': /^Scatter chart/,
}
const PREMIUM = {
  'sankey-budget': ['sankey', /^Sankey diagram with 7 nodes in 4 columns and 6 flows, total 2,360\./],
  'chord-plans': ['chord', /^Chord diagram of 4 groups and 12 flows/],
  'radial-column-ring': ['radialColumn', /^Radial column chart of 24 categories and 1 series\. Average Requests: 60\./],
  'gantt-launch': ['gantt', new RegExp('^Gantt chart with 9 tasks and 2 milestones in 3 groups, from ' + ISO_DAY.source + ' to ' + ISO_DAY.source + '\\. On the critical path: \\d+ tasks')],
  'tree-org': ['tree', /^Tree with 19 nodes on 4 levels\. Root: Ava Chen\./],
  'stock-acme': ['stock', new RegExp('^Stock chart of ACME with 500 periods from ' + ISO_DAY.source + ' to ' + ISO_DAY.source + '\\.')],
  'map-world': ['map', /^Map of 176 regions/],
  'marimekko-market': ['marimekko', /^Marimekko chart of 3 categories and 3 segments, total 1,730\./],
  'network-services': ['network', /^Network of 6 nodes and 6 connections in 3 groups\./],
}

test('real core: free types return the describe() model (text, series, scales), precise wording', { skip, timeout: 300000 }, () => {
  for (const [id, re] of Object.entries(FREE)) {
    const t = table(id)
    assert.strictEqual(t.schema, 'wcc-describe/1', id)
    assert.strictEqual(t.premium, false, id)
    assert.match(t.text, re, id)
    assert.ok(t.series.length > 0 && t.marks.length > 0, id + ': series/marks come only from describe(), not from the DOM stub')
    assert.ok(t.table.rows.length > 0 && t.table.rows.flat().every((c) => typeof c === 'string'), id)
    assert.doesNotMatch(t.text, /\d\.\d{5,}|NaN|undefined/, id)
  }
})

test('real core: stacked area adds a Total column; dates in tables are ISO', { skip, timeout: 120000 }, () => {
  const t = table('area-stacked')
  assert.deepStrictEqual(t.table.columns.slice(-1), ['Total'])
  assert.ok(t.categories.every((c) => typeof c.value === 'number'))
  assert.match(table('gantt-launch', ['--evaluation']).table.rows[0].join(' '), ISO_DAY)
})

test('real core: all 9 premium types with --evaluation return the describe() model', { skip, timeout: 600000 }, () => {
  const seen = new Set()
  for (const [id, [type, re]] of Object.entries(PREMIUM)) {
    const t = table(id, ['--evaluation'])
    assert.strictEqual(t.schema, 'wcc-describe/1', id)
    assert.strictEqual(t.type, type, id)
    assert.strictEqual(t.premium, true, id)
    assert.match(t.text, re, id)
    assert.ok(t.table.columns.length > 0 && t.table.rows.length > 0, id)
    seen.add(type)
  }
  assert.strictEqual(seen.size, 9)
})

test('real core: premium without --evaluation and without a key still exits 4 (license)', { skip, timeout: 120000 }, () => {
  const r = run(['chart', 'table', 'example:sankey-budget', '--json'])
  assert.strictEqual(r.status, 4)
})

test('real core: licensed premium render', { skip: skip || (!process.env.WCC_TEST_LICENSE_KEY_FILE && 'no licence key (set WCC_TEST_LICENSE_KEY_FILE)'), timeout: 120000 }, () => {
  const r = run(['chart', 'table', 'example:sankey-budget', '--json', '--license-key-file', process.env.WCC_TEST_LICENSE_KEY_FILE])
  assert.strictEqual(r.status, 0, r.stderr.toString())
  assert.strictEqual(JSON.parse(r.stdout.toString()).premium, true)
})

test('real core: validate reports the library validator and a did-you-mean', { skip, timeout: 120000 }, () => {
  const r = spawnSync(process.execPath, [BIN, 'chart', 'validate', '-', '--json'], { input: JSON.stringify({ chart: { type: 'bar' }, series: [{ data: [1, 2] }], xaxsi: {} }), env })
  const out = JSON.parse(r.stdout.toString() || '{}')
  assert.strictEqual(out.ok, false, r.stderr.toString())
  assert.match(JSON.stringify(out), /xaxis/)
})
