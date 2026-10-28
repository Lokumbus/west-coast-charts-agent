'use strict'
// Chart types are read from the actual selected library declarations; parse failures are errors.
const fs = require('fs')
const path = require('path')
const { paths } = require('./lib')
const { WccError } = require('./errors')

const FALLBACK = {
  core: ['line', 'area', 'bar', 'pie', 'donut', 'radialBar', 'scatter', 'bubble', 'heatmap', 'candlestick', 'boxPlot', 'radar', 'polarArea', 'rangeBar', 'rangeArea', 'treemap'],
  types: ['gauge', 'funnel', 'pyramid', 'waterfall', 'dumbbell', 'beeswarm', 'histogram', 'violin', 'raincloud', 'sunburst', 'icicle', 'streamgraph', 'unit', 'waffle', 'slope', 'barRace', 'calendar'],
  premium: ['sankey', 'chord', 'gantt', 'tree', 'stock', 'map', 'marimekko', 'network', 'radialColumn', 'quintTimeline', 'quintConvergence', 'vitalsClock', 'schedule'],
}
// layer modules (lib: src/premium/layers/registry.js KNOWN)
const LAYERS = [
  { host: 'radialColumn', type: 'wave', module: 'wave-ring', where: 'plotOptions.radialColumn.layers[].type' },
  { host: 'radialColumn', type: 'matrix', module: 'matrix-core', where: 'plotOptions.radialColumn.layers[].type' },
  { host: 'network', type: 'facet', module: 'network-facet', where: 'plotOptions.network.layout.type' },
  { host: 'radialColumn', type: 'incident', module: 'quint', where: 'plotOptions.radialColumn.layers[].type' },
]

function union(src, name) {
  const m = new RegExp('type ' + name + ' =([\\s\\S]*?)\\n\\n').exec(src)
  return m ? Array.from(m[1].matchAll(/'([A-Za-z]+)'/g)).map((x) => x[1]) : null
}
let cached = null
function lists() {
  if (cached) return cached
  cached = { ...FALLBACK }
  try {
    const dir = path.join(paths().root, 'types')
    const wcc = fs.readFileSync(path.join(dir, 'wcc-options.d.ts'), 'utf8')
    const t = union(wcc, 'WccChartType')
    const p = union(wcc, 'WccPremiumChartType')
    const apex = fs.readFileSync(path.join(dir, 'apexcharts.d.ts'), 'utf8')
    const m = /\n\s*type\?:\s*\n([\s\S]*?)\| WccChartType/.exec(apex)
    const c = m ? Array.from(m[1].matchAll(/'([A-Za-z]+)'/g)).map((x) => x[1]) : null
    if (t && t.length) cached.types = t
    if (p && p.length) cached.premium = p
    if (c && c.length) cached.core = c
    if (!t?.length || !p?.length || !c?.length) throw new Error('Chart type unions missing')
  } catch (e) {
    cached = null
    throw new WccError('not_found', 'The installed library type declarations could not be read.', 'Install the complete matching Core distribution; no stale type list is used.', { reason: e.message })
  }
  return cached
}
function listTypes() {
  const l = lists()
  return [
    ...l.core.map((type) => ({ type, tier: 'core', premium: false })),
    ...l.types.map((type) => ({ type, tier: 'types', premium: false })),
    ...l.premium.map((type) => ({ type, tier: 'premium', premium: true, module: 'west-coast-charts/' + ({quintTimeline:'layers/quint',quintConvergence:'layers/quint',vitalsClock:'layers/vitals',schedule:'layers/schedule'}[type] || 'premium') })),
    ...LAYERS.map((x) => ({ type: x.host + ':' + x.type, tier: 'premium-layer', premium: true, module: 'west-coast-charts/layers/' + x.module, option: x.where })),
  ]
}
const allTypeNames = () => {
  const l = lists()
  return [...l.core, ...l.types, ...l.premium]
}
const isPremiumType = (t) => lists().premium.includes(t)

/** premium layer modules a spec uses */
function layersUsed(spec) {
  const out = []
  const po = (spec && spec.plotOptions) || {}
  const rc = po.radialColumn && po.radialColumn.layers
  if (Array.isArray(rc)) for (const l of rc) if (l && (l.type === 'wave' || l.type === 'matrix' || l.type === 'incident')) out.push('radialColumn:' + l.type)
  const nl = po.network && po.network.layout
  if (nl && nl.type === 'facet') out.push('network:facet')
  return Array.from(new Set(out))
}

/** premium host types that also claim a core type (lib: src/premium/register.js, registerPremiumType test fns) */
function premiumClaim(spec) {
  const t = spec && spec.chart && spec.chart.type
  const po = (spec && spec.plotOptions) || {}
  if (t === 'candlestick' && po.stock && po.stock.enabled) return 'stock'
  return null
}
const isPremiumSpec = (spec) => isPremiumType(spec && spec.chart && spec.chart.type) || !!premiumClaim(spec) || layersUsed(spec).length > 0

module.exports = { listTypes, allTypeNames, isPremiumType, isPremiumSpec, premiumClaim, layersUsed, LAYERS }
