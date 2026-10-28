'use strict'
/*
 * wcc-describe/1: the verification table shape (E2, dist/schema/wcc-describe.schema.json).
 * render-core returns either the full model (source 'describe') or a stub with the common
 * subset (source 'stub'). The outputSchema requires only the common subset and keeps the
 * full-model fields optional, so both validate.
 */
const { z } = require('zod/v4')

const num = z.number().nullable()
const mode = z.enum(['sum', 'mean', 'max', 'min', 'none'])

const describeSchema = z
  .object({
    schema: z.literal('wcc-describe/1').describe('shape id; always "wcc-describe/1"'),
    type: z.string().describe('chart type as configured'),
    premium: z.boolean(),
    title: z.string().nullable(),
    subtitle: z.string().nullable().optional(),
    text: z.string().describe("accessible text description of what was drawn (the chart's <desc>)"),
    table: z
      .object({
        caption: z.string(),
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())).describe('cells are formatted strings, as displayed'),
        total: z.number().int().describe('rows before truncation'),
        truncated: z.boolean()
      })
      .describe('the data table as drawn (same as the chart’s accessible data table)'),
    deterministic: z.boolean().optional(),
    noData: z.boolean().optional(),
    series: z.array(z.object({ name: z.string(), hidden: z.boolean(), count: z.number().int(), unit: z.string().nullable(), aggregate: z.object({ mode, value: num, label: z.string() }).loose().nullable() }).loose()).optional().describe('per series: count, min/max point, unit, aggregate'),
    marks: z.array(z.object({ series: z.string(), category: z.string(), value: num, formatted: z.string() }).loose()).optional().describe('drawn values (numeric + formatted)'),
    marksTotal: z.number().int().optional(),
    marksTruncated: z.boolean().optional(),
    aggregate: z.object({ mode, value: num, label: z.string(), formatted: z.string().nullable() }).loose().nullable().optional().describe('chart-level combined value with its function (e.g. p95 latencies: max, never sum)'),
    categories: z.array(z.object({ category: z.string(), value: num }).loose()).optional(),
    scales: z.any().optional().describe('{x:{type,min,max,title,...}, y:[{index,min,max,title,logarithmic,series}]}'),
    extrema: z.any().optional().describe('{min:{value,series,category}, max:{...}}'),
    units: z.object({ category: z.string().nullable(), value: z.string().nullable() }).loose().optional(),
    filters: z.array(z.any()).optional().describe('active highlight/crossfilter/zoom filters'),
    hidden: z.array(z.string()).optional().describe('names of hidden (legend-collapsed) series')
  })
  .loose()
  .describe('wcc-describe/1 verification table')

const esc = (v) => (v == null ? '' : String(v).replace(/\|/g, '\\|').replace(/\n/g, ' '))
const fmt = (v, f) => (f != null ? f : v == null ? 'n/a' : String(v))

/** markdown view of a wcc-describe/1 object for the model */
function describeMarkdown(d, maxRows = 50, source) {
  if (!d) return '_no table_'
  if (source === undefined) source = d.source
  const out = []
  if (d.text) out.push(d.text, '')
  const t = d.table || {}
  const cols = t.columns || []
  const rows = t.rows || []
  if (cols.length) {
    if (t.caption) out.push(`**${esc(t.caption)}**`, '')
    out.push(`| ${cols.map(esc).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`)
    for (const r of rows.slice(0, maxRows)) out.push(`| ${r.map(esc).join(' | ')} |`)
    const total = Number.isInteger(t.total) ? t.total : rows.length
    const shown = Math.min(rows.length, maxRows)
    if (total > shown) out.push('', `_${total - shown} more rows not shown${rows.length > maxRows ? ' (raise max_rows)' : ' (truncated by the core)'}._`)
  }
  const aggs = []
  if (d.aggregate) aggs.push(`- ${d.aggregate.label}: ${fmt(d.aggregate.value, d.aggregate.formatted)} (${d.aggregate.mode})`)
  for (const s of d.series || []) if (s.aggregate) aggs.push(`- ${s.name}: ${s.aggregate.label} ${fmt(s.aggregate.value)} (${s.aggregate.mode})${s.hidden ? ' [hidden]' : ''}`)
  if (aggs.length) out.push('', 'Aggregates (as drawn):', ...aggs)
  if (d.hidden && d.hidden.length) out.push('', `Hidden series: ${d.hidden.join(', ')}`)
  if (source === 'stub') out.push('', '_basic table (source: stub); per-series aggregates, scales and marks not available._')
  return out.join('\n')
}

/**
 * Normalise what core.table(spec, {withMeta:true}) returned into {table, tableSource}.
 * render-core >= 0.3 returns {table, meta: {tableSource}}; older cores return the describe object itself,
 * possibly with a top-level `source`. The table handed out is always the schema-valid wcc-describe/1 object
 * (the `source` key is moved out of it).
 */
function splitTable(r) {
  if (!r) return { table: null, tableSource: null, meta: null }
  if (r.schema !== 'wcc-describe/1' && r.table && typeof r.table === 'object' && r.meta) return { table: r.table, tableSource: r.meta.tableSource || null, meta: r.meta }
  const { source, ...table } = r
  return { table, tableSource: source || null, meta: null }
}

const tableSourceSchema = z.enum(['describe', 'stub']).nullable().describe("where the table came from: 'describe' = full E2 model from chart.describe(); 'stub' = basic table extracted from the drawn chart (no per-series aggregates, scales or marks); null = no table")

module.exports = { describeSchema, describeMarkdown, splitTable, tableSourceSchema }
