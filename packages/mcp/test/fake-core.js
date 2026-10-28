'use strict'
/* Fake render core implementing docs/render-core-api.md v0.3 (wcc-describe/1 tables, meta.tableSource, table({withMeta}), license details.reason), for contract tests. */
class WccError extends Error {
  constructor(kind, message, hint = null, details = null) {
    super(message)
    Object.assign(this, { kind, hint, details, exitCode: { internal: 1, usage: 2, schema: 2, not_found: 3, license: 4 }[kind] || 1 })
  }
}
const TYPES = [
  { type: 'line', premium: false }, { type: 'bar', premium: false }, { type: 'donut', premium: false }, { type: 'heatmap', premium: false },
  { type: 'sankey', premium: true }, { type: 'radialColumn', premium: true }, { type: 'waveRing', premium: true, module: 'layers/wave-ring' }
]
const EXAMPLES = [
  { id: 'ops-latency-heatmap', type: 'heatmap', title: 'p95 latency by region and hour', premium: false, spec: { chart: { type: 'heatmap' }, series: [{ name: 'eu-west-2', data: [{ x: '00', y: 120 }] }] } },
  { id: 'line-basic', type: 'line', title: 'Basic line', premium: false, spec: { chart: { type: 'line' }, series: [{ name: 'a', data: [1, 2, 3] }] } },
  { id: 'sankey-flows', type: 'sankey', title: 'Checkout flows', premium: true, spec: { chart: { type: 'sankey' }, series: [] } }
]
const KEYS = ['chart', 'series', 'xaxis', 'yaxis', 'plotOptions', 'theme', 'title', 'labels', 'colors']
const near = (k, list) => list.find((x) => x.slice(0, 3) === k.slice(0, 3)) || null
const SCHEMA = {
  type: 'object',
  properties: {
    chart: { type: 'object', description: 'chart', properties: { type: { type: 'string', enum: TYPES.map((t) => t.type) }, toolbar: { type: 'object', properties: { show: { type: 'boolean' }, tools: { type: 'object', properties: { download: { type: 'boolean' } } } } } } },
    plotOptions: { type: 'object', properties: { radialColumn: { type: 'object', properties: { aggregate: { type: 'string', enum: ['sum', 'mean', 'max', 'min', 'none'] } } } } }
  }
}
const calls = []
function validateSync(spec) {
  const errors = []
  if (!spec || typeof spec !== 'object') errors.push({ code: 'WCC_NOT_OBJECT', path: '', message: 'spec must be an object', severity: 'error' })
  else {
    if (!spec.chart || !TYPES.some((t) => t.type === spec.chart.type)) errors.push({ code: 'WCC_UNKNOWN_TYPE', path: 'chart.type', message: `unknown type ${spec.chart && spec.chart.type}`, hint: "use 'line'", suggestion: 'line', severity: 'error' })
    for (const k of Object.keys(spec)) if (!KEYS.includes(k)) { const s = near(k, KEYS); errors.push({ code: 'WCC_UNKNOWN_OPTION', path: k, message: `unknown option '${k}'`, hint: s ? `use '${s}'` : null, suggestion: s, severity: 'error' }) }
  }
  return { ok: !errors.length, errors, warnings: [], validator: 'stub' }
}
function tableOf(spec, opts = {}) {
  const series = opts.data || spec.series || []
  const text = `A ${spec.chart.type} chart with ${series.length} series.`
  const table = { caption: `${spec.chart.type} chart`, columns: ['series', 'value'], rows: series.map((s) => [s.name || '', String(Array.isArray(s.data) ? s.data.length : s)]), total: series.length, truncated: false }
  const base = { schema: 'wcc-describe/1', type: spec.chart.type, premium: false, title: null, text, table }
  if (!spec.chart.full) return base
  // full E2 model (validates against wcc-describe.schema.json)
  return {
    ...base, subtitle: null, deterministic: true, noData: false,
    series: series.map((s, i) => ({ index: i, name: s.name || '', hidden: false, count: 3, unit: null, min: { value: 1, category: 'Q1' }, max: { value: 3, category: 'Q3' }, aggregate: { mode: 'max', value: 3, label: 'Highest value' } })),
    marks: [{ series: 'a', seriesIndex: 0, category: 'Q1', value: 1, formatted: '1' }], marksTotal: 1, marksTruncated: false,
    aggregate: { mode: 'max', value: 3, label: 'Peak p95', formatted: '3 ms' },
    scales: { x: { type: 'category', min: null, max: null, title: null }, y: [{ index: 0, min: 0, max: 3, title: null, logarithmic: false, series: ['a'] }] },
    extrema: { min: { value: 1, series: 'a', category: 'Q1' }, max: { value: 3, series: 'a', category: 'Q3' } },
    units: { category: null, value: 'ms' }, filters: [], hidden: []
  }
}
async function prem(spec, opts) {
  const t = TYPES.find((x) => x.type === spec.chart.type)
  if (t && t.premium && opts.licenseKey !== 'VALID-KEY') throw new WccError('license', opts.licenseKey ? 'licence key is invalid' : 'premium type needs a valid licence key', 'https://westcoast-charts.com/pricing/#trial', { type: t.type, reason: opts.licenseKey ? 'license_invalid' : 'license_required' })
  return t
}
module.exports = {
  WccError,
  calls,
  version: { renderCore: '0.1.0-fake', lib: '1.1.0-fake', fontSet: 'fake' },
  async render(spec, opts = {}) {
    calls.push(['render', spec, opts])
    if ((opts.validate || 'strict') === 'strict') { const v = validateSync(spec); if (!v.ok) throw new WccError('schema', `${v.errors.length} invalid option(s)`, v.errors[0].hint, { issues: v.errors }) }
    const t = await prem(spec, opts)
    if (spec.chart.crash) throw new Error('boom')
    const w = opts.width || 800, h = opts.height || 450
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" data-seed="${opts.seed || 1}" data-theme="${opts.theme}"><rect width="10" height="10"/></svg>`
    const out = { format: opts.format || 'svg', table: tableOf(spec, opts), meta: { type: spec.chart.type, premium: !!(t && t.premium), licensed: opts.licenseKey === 'VALID-KEY', width: w, height: h, seed: opts.seed || 1, libVersion: '1.1.0-fake', renderCoreVersion: '0.1.0-fake', fontSet: 'fake', tableSource: spec.chart.full ? 'describe' : 'stub', ms: 1, warnings: [] } }
    if (out.format === 'png') out.png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, w & 255])
    else out.svg = svg
    return out
  },
  async validate(spec) { calls.push(['validate', spec]); return validateSync(spec) },
  async table(spec, opts = {}) {
    calls.push(['table', spec, opts]); await prem(spec, opts)
    const t = tableOf(spec, opts)
    if (spec.chart.legacySource) return { ...t, source: spec.chart.full ? 'describe' : 'stub' } // render-core <= 0.2 shape
    return opts.withMeta ? { table: t, meta: { type: spec.chart.type, tableSource: spec.chart.full ? 'describe' : 'stub', warnings: [] } } : t
  },
  getSchema(path) {
    if (!path) return SCHEMA
    let s = SCHEMA
    for (const p of path.split('.')) {
      s = s && s.properties && s.properties[p]
      if (!s) throw new WccError('not_found', `no option '${path}'`, "did you mean 'plotOptions.radialColumn'?")
    }
    return s
  },
  listTypes() { return TYPES },
  listExamples() { return EXAMPLES.map(({ spec, ...e }) => e) },
  getExample(id) { const e = EXAMPLES.find((x) => x.id === id); if (!e) throw new WccError('not_found', `no example '${id}'`, "closest: 'line-basic'"); return e },
  errorCatalog() { return [{ kind: 'internal', exitCode: 1, description: 'bug' }, { kind: 'schema', exitCode: 2, description: 'invalid spec' }, { kind: 'license', exitCode: 4, description: 'premium without key' }] }
}
