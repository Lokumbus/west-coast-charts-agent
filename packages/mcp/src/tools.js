'use strict'
const { describeSchema, describeMarkdown, splitTable, tableSourceSchema } = require('./describe')
/*
 * The seven West Coast Charts tools. All are read-only and idempotent: they compute and return
 * results, they never write files or call the network. Failures come back as isError results
 * with the CLI envelope { error: { kind, message, hint, details } } (see errors.js).
 */
const crypto = require('crypto')
const { z } = require('zod/v4')
const { toolError, licenseError, McpToolError } = require('./errors')
const { versionOf } = require('./core')

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false }

const EX_SPEC = { chart: { type: 'bar' }, series: [{ name: 'Revenue', data: [12, 19, 7] }], xaxis: { categories: ['Q1', 'Q2', 'Q3'] } }

// ---- shared input fragments ------------------------------------------------------------------
const spec = z
  .object({
    chart: z
      .object({ type: z.string().min(1).describe("Chart type, e.g. 'line', 'bar', 'area', 'donut', 'heatmap', 'sankey'. See list_chart_types.") })
      .loose()
      .describe('chart options; chart.type is required'),
    series: z.any().optional().describe('Data series, ApexCharts-compatible shape (array of {name, data} or numbers for pie/donut/radialBar). Omit when `data` is given.')
  })
  .loose()
  .describe(`West Coast Charts options object, JSON only (no functions), the same object you pass to new WestCoastCharts(el, options). ApexCharts 4.x options are accepted. Example: ${JSON.stringify(EX_SPEC)}`)
const data = z.array(z.any()).optional().describe('Optional series array that replaces spec.series (keeps the spec reusable as a template).')
const size = {
  width: z.number().int().min(16).max(8192).optional().describe('Canvas width in px. Default spec.chart.width or 800.'),
  height: z.number().int().min(16).max(8192).optional().describe('Canvas height in px. Default spec.chart.height or 450.'),
  theme: z.enum(['light', 'dark']).optional().describe('Theme. Default spec.theme.mode or the server default.'),
  seed: z.number().int().min(0).max(2147483647).optional().describe('Random seed for layouts (network, facets). Same spec + seed => byte-identical output. Default 1.')
}

// ---- helpers ---------------------------------------------------------------------------------
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const json = (o) => JSON.stringify(o)

function chartType(s) {
  return s && s.chart && typeof s.chart.type === 'string' ? s.chart.type : null
}

async function premiumGate(ctx, s) {
  const type = chartType(s)
  if (!type || ctx.config.licenseKey || ctx.config.evaluation) return
  let types
  try {
    types = await ctx.core.listTypes()
  } catch (e) {
    return // let render report the real problem
  }
  const t = (types || []).find((x) => x.type === type)
  if (t && t.premium) throw licenseError(type)
}

function renderOpts(ctx, a, extra = {}) {
  const o = { ...extra }
  for (const k of ['data', 'width', 'height', 'seed']) if (a[k] != null) o[k] = a[k]
  o.theme = a.theme || (a.spec && a.spec.theme && a.spec.theme.mode) || ctx.config.defaultTheme
  if (ctx.config.licenseKey) o.licenseKey = ctx.config.licenseKey
  else if (ctx.config.evaluation) o.evaluation = true
  return o
}

function pixelGuard(ctx, a) {
  const w = a.width || (a.spec.chart && +a.spec.chart.width) || 800
  const h = a.height || (a.spec.chart && +a.spec.chart.height) || 450
  const s = a.scale || 1
  const px = w * h * s * s
  if (Number.isFinite(px) && px > ctx.config.maxPixels)
    throw new McpToolError('usage', `Requested ${w}x${h} at scale ${s} is ${px} px, above this server's limit of ${ctx.config.maxPixels}.`, 'Lower width/height or scale (e.g. scale 1 or 2).', { pixels: px, maxPixels: ctx.config.maxPixels })
}

function issueLine(i) {
  return `- [${i.severity}] ${i.code} at ${i.path || '(root)'}: ${i.message}${i.hint ? ` -> ${i.hint}` : ''}`
}

const tableMarkdown = describeMarkdown

/** keep a schema slice small: below `depth` levels, child schemas collapse to a stub with a pointer */
function trimSchema(schema, depth, base) {
  if (!schema || typeof schema !== 'object') return schema
  const walk = (s, d, p) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return s
    const out = {}
    for (const [k, v] of Object.entries(s)) {
      if (k === 'properties' && v && typeof v === 'object') {
        out.properties = {}
        for (const [pk, pv] of Object.entries(v)) {
          const cp = p ? `${p}.${pk}` : pk
          if (d >= depth && pv && typeof pv === 'object' && (pv.properties || pv.items || pv.anyOf || pv.oneOf)) {
            out.properties[pk] = { type: pv.type, description: pv.description, 'x-wcc-more': `get_schema {"path":"${cp}"}`, 'x-wcc-keys': pv.properties ? Object.keys(pv.properties) : undefined }
          } else out.properties[pk] = walk(pv, d + 1, cp)
        }
      } else if ((k === 'items' || k === 'additionalProperties') && v && typeof v === 'object') out[k] = walk(v, d, p)
      else if ((k === 'anyOf' || k === 'oneOf' || k === 'allOf') && Array.isArray(v)) out[k] = v.map((x) => walk(x, d, p))
      else out[k] = v
    }
    return out
  }
  return walk(schema, 0, base || '')
}

/** ring buffer of recent renders, readable as wcc://renders/{id} */
class RenderCache {
  constructor(max = 32) {
    this.max = max
    this.map = new Map()
  }
  put(entry) {
    this.map.delete(entry.id)
    this.map.set(entry.id, entry)
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value)
  }
  get(id) {
    return this.map.get(id)
  }
}

function wrap(fn) {
  return async (args, extra) => {
    try {
      return await fn(args, extra)
    } catch (e) {
      return toolError(e)
    }
  }
}

// ---- registration ----------------------------------------------------------------------------
function registerTools(server, ctx) {
  const { core } = ctx

  server.registerTool(
    'render_chart',
    {
      title: 'Render chart (SVG/PNG + verification table)',
      description: [
        'Render a West Coast Charts spec headlessly to SVG or PNG and return the image together with the verification table: the values, aggregates and text description that were actually drawn.',
        'Use it to produce a chart file or to check that a chart shows what you intended. Read the returned table instead of looking at the image when you cannot see images. Do not use it just to check option names (validate_chart is faster) or only for the numbers (describe_chart is cheaper).',
        'Behaviour: read-only, deterministic (same spec+seed => byte-identical output, animations off), no files written, no network. The spec is validated first (validate: "strict" rejects invalid options with kind "schema" and fix hints; "warn" renders anyway and lists warnings).',
        'Premium types (sankey, chord, gantt, tree, stock, map, marimekko, network, radialColumn) need a licence key on the server; without one the call fails with kind "license" (details.reason "license_required"), unless the server runs with --evaluation (WCC_EVALUATION=1): then they render with an "unlicensed" watermark.',
        `Example: {"spec": ${json(EX_SPEC)}, "format": "svg"}`
      ].join('\n'),
      inputSchema: {
        spec,
        data,
        format: z.enum(['svg', 'png']).default('svg').describe('Output format. svg (default) is text and editable; png is a base64 image.'),
        ...size,
        scale: z.number().min(1).max(4).optional().describe('PNG pixel ratio 1-4. Default 1. Ignored for svg.'),
        background: z.string().max(64).optional().describe("CSS colour behind the chart. PNG default '#ffffff'; SVG stays transparent unless set."),
        validate: z.enum(['strict', 'warn', 'off']).default('strict').describe('Run validate_chart first. strict (default) fails on errors, warn renders and reports, off skips.'),
        delivery: z.enum(['inline', 'link']).default('inline').describe('inline (default) embeds the SVG text/PNG bytes; link returns only a resource link wcc://renders/{id} plus the table (saves tokens; read the resource when needed).')
      },
      outputSchema: {
        uri: z.string().describe('wcc://renders/{id} resource with the rendered file'),
        mimeType: z.string(),
        bytes: z.number().int(),
        sha256: z.string(),
        table: describeSchema.nullable().describe('Verification table (wcc-describe/1): text, table {caption, columns, rows (strings), total, truncated}, aggregate, series...'),
        tableSource: tableSourceSchema,
        meta: z.any().describe('{type, premium, licensed, licenseKeySource, width, height, seed, tableSource, libVersion, renderCoreVersion, fontSet, ms, warnings}')
      },
      annotations: { title: 'Render chart', ...READ_ONLY }
    },
    wrap(async (a) => {
      pixelGuard(ctx, a)
      await premiumGate(ctx, a.spec)
      const opts = renderOpts(ctx, a, { format: a.format, validate: a.validate })
      if (a.scale != null) opts.scale = a.scale
      if (a.background != null) opts.background = a.background
      const r = await core.render(a.spec, opts)
      const isPng = a.format === 'png'
      const buf = isPng ? Buffer.from(r.png) : Buffer.from(r.svg || '', 'utf8')
      const hash = sha(buf)
      const id = `${hash.slice(0, 16)}.${isPng ? 'png' : 'svg'}`
      const uri = `wcc://renders/${id}`
      const mimeType = isPng ? 'image/png' : 'image/svg+xml'
      ctx.renders.put({ id, uri, mimeType, buf, png: isPng })
      const meta = r.meta || {}
      const summary = [`Rendered ${meta.type || chartType(a.spec)} ${meta.width || ''}x${meta.height || ''} ${a.format}, ${buf.length} bytes, sha256 ${hash.slice(0, 12)}, ${uri}`]
      if (meta.warnings && meta.warnings.length) summary.push('Warnings:', ...meta.warnings.map(issueLine))
      const { table, tableSource } = splitTable(r.table)
      const src = meta.tableSource !== undefined ? meta.tableSource : tableSource
      summary.push('', `Verification table (what was drawn; source: ${src || 'none'}):`, tableMarkdown(table, 30, src))
      const content = [{ type: 'text', text: summary.join('\n') }]
      if (a.delivery === 'link') content.push({ type: 'resource_link', uri, name: id, mimeType, description: 'Rendered chart', size: buf.length })
      else if (isPng) content.push({ type: 'image', data: buf.toString('base64'), mimeType })
      else content.push({ type: 'resource', resource: { uri, mimeType, text: r.svg } })
      return { content, structuredContent: { uri, mimeType, bytes: buf.length, sha256: hash, table: r.table ? table : null, tableSource: r.table ? src || null : null, meta } }
    })
  )

  server.registerTool(
    'validate_chart',
    {
      title: 'Validate chart spec',
      description: [
        'Check a West Coast Charts spec without rendering. Returns structured issues, each with a stable code, the dotted option path, a message, a hint with the exact fix and, for typos or invented options, the suggested correct key (did-you-mean).',
        'Use it before render_chart when you wrote options from memory, and after every fix until ok is true. An invalid spec is a normal result (ok:false), not a tool error. It does not check whether the data makes sense; use describe_chart for that.',
        'Read-only, deterministic, fast (no rendering).',
        'Example: {"spec": {"chart": {"type": "radialColumn"}, "plotOptions": {"radialColumn": {"agregate": "max"}}}} -> error WCC_UNKNOWN_OPTION at plotOptions.radialColumn.agregate, suggestion "aggregate".'
      ].join('\n'),
      inputSchema: { spec, data },
      outputSchema: {
        ok: z.boolean(),
        errors: z.array(z.any()).describe('Issue[] {code, path, message, hint, suggestion, severity:"error"}'),
        warnings: z.array(z.any()).describe('Issue[] with severity "warning"'),
        validator: z.string().describe("'e1' matching released library validator; no approximate fallback")
      },
      annotations: { title: 'Validate chart spec', ...READ_ONLY }
    },
    wrap(async (a) => {
      const s = a.data ? { ...a.spec, series: a.data } : a.spec
      const r = await core.validate(s, {})
      const res = { ok: !!r.ok, errors: r.errors || [], warnings: r.warnings || [], validator: r.validator || 'unknown' }
      const lines = [res.ok ? `OK: spec is valid (${res.validator} validator).` : `INVALID: ${res.errors.length} error(s), ${res.warnings.length} warning(s).`]
      lines.push(...res.errors.map(issueLine), ...res.warnings.map(issueLine))
      return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: res }
    })
  )

  server.registerTool(
    'describe_chart',
    {
      title: 'Describe chart (verification table)',
      description: [
        "Return the verification table (wcc-describe/1) of a spec without producing an image: the text description, the data table as drawn (caption, columns, rows of formatted strings, total, truncated) and, from the full model, per-series and chart-level aggregates with their function (sum/mean/max/min/none), scales, extrema and hidden series. Aggregates follow the chart's semantics, e.g. p95 latencies are reported as a maximum, never summed.",
        'Use it to check, in text only, that a chart says what you intend, to write alt text, or to answer questions about a chart. Cheaper than render_chart; use render_chart instead when you need the image.',
        'Read-only and deterministic.',
        `Example: {"spec": ${json(EX_SPEC)}, "format": "markdown"}`
      ].join('\n'),
      inputSchema: {
        spec,
        data,
        format: z.enum(['markdown', 'json']).default('markdown').describe('markdown (default): text + table + aggregates; json: the wcc-describe/1 object, then a second text item with the table source (both also in structuredContent.table / .tableSource).'),
        max_rows: z.number().int().min(1).max(1000).default(50).describe('Rows shown in markdown output. Default 50. json returns every row the core returned (see table.total/truncated).'),
        ...size
      },
      outputSchema: { table: describeSchema, tableSource: tableSourceSchema },
      annotations: { title: 'Describe chart', ...READ_ONLY }
    },
    wrap(async (a) => {
      await premiumGate(ctx, a.spec)
      const { table: t, tableSource } = splitTable(await core.table(a.spec, renderOpts(ctx, a, { withMeta: true })))
      const content = a.format === 'json'
        ? [{ type: 'text', text: JSON.stringify(t) }, { type: 'text', text: `tableSource: ${tableSource || 'unknown'}` }]
        : [{ type: 'text', text: `_Table source: ${tableSource || 'unknown'}._\n\n` + tableMarkdown(t, a.max_rows, tableSource) }]
      return { content, structuredContent: { table: t, tableSource } }
    })
  )

  server.registerTool(
    'get_schema',
    {
      title: 'Get option schema slice',
      description: [
        'Return the JSON Schema (draft 2020-12) of West Coast Charts options, either the root or the slice at a dotted path. Deeper levels are collapsed to stubs with "x-wcc-keys" (child names) and "x-wcc-more" (the call that expands them), so answers stay small.',
        'Use it to look up the exact option names, types, enums and defaults before writing a spec, instead of guessing. Ask for the narrowest path you need; do not fetch the whole tree at high depth. Unknown paths fail with kind "not_found" and a did-you-mean hint.',
        'Read-only.',
        'Examples: {"path": "plotOptions.radialColumn"}, {"path": "xaxis.labels", "depth": 1}, {} for the top-level keys.'
      ].join('\n'),
      inputSchema: {
        path: z.string().max(200).regex(/^[A-Za-z0-9_$.\[\]-]*$/).optional().describe("Dotted option path, e.g. 'plotOptions.bar' or 'chart.toolbar'. Omit for the root."),
        depth: z.number().int().min(0).max(6).default(2).describe('Levels of nested properties to expand. Default 2; 0 returns only the node itself with its child keys.')
      },
      outputSchema: { path: z.string(), depth: z.number().int(), schema: z.any() },
      annotations: { title: 'Get option schema', ...READ_ONLY }
    },
    wrap(async (a) => {
      const p = a.path || ''
      const s = await core.getSchema(p || undefined)
      const out = trimSchema(s, a.depth, p)
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: { path: p, depth: a.depth, schema: out } }
    })
  )

  server.registerTool(
    'list_chart_types',
    {
      title: 'List chart types',
      description: [
        'List every chart type this server can render with its tier (premium true/false) and, for premium layers, the module that provides it.',
        'Use it to pick a valid chart.type, or to find a free alternative when a premium type fails with kind "license". Read-only, no arguments.'
      ].join('\n'),
      inputSchema: {},
      outputSchema: { types: z.array(z.object({ type: z.string(), premium: z.boolean(), module: z.string().optional() }).loose()), licensed: z.boolean() },
      annotations: { title: 'List chart types', ...READ_ONLY }
    },
    wrap(async () => {
      const types = (await core.listTypes()) || []
      const lic = !!ctx.config.licenseKey
      const free = types.filter((t) => !t.premium).map((t) => t.type)
      const prem = types.filter((t) => t.premium).map((t) => t.type + (t.module ? ` (module ${t.module})` : ''))
      const text = `Free: ${free.join(', ')}\nPremium${lic ? '' : ' (licence key required, not configured)'}: ${prem.join(', ')}`
      return { content: [{ type: 'text', text }], structuredContent: { types, licensed: lic } }
    })
  )

  server.registerTool(
    'list_examples',
    {
      title: 'List curated examples',
      description: [
        'List curated West Coast Charts showcase examples, strongest first. Each entry has an id, chart type, title and premium flag; fetch the full spec with get_example.',
        'Use it to start from a proven spec instead of writing one from scratch. Filter by type or by words in the title. Returns metadata only, not specs. Read-only; paginated with offset/limit.',
        'Example: {"type": "heatmap", "limit": 5} or {"query": "latency"}'
      ].join('\n'),
      inputSchema: {
        type: z.string().max(64).optional().describe("Only examples of this chart.type, e.g. 'line'."),
        query: z.string().max(200).optional().describe('Case-insensitive words that must all appear in id or title.'),
        premium: z.boolean().optional().describe('true = only premium, false = only free examples.'),
        offset: z.number().int().min(0).default(0).describe('Skip this many results. Default 0.'),
        limit: z.number().int().min(1).max(100).default(20).describe('Max results. Default 20.')
      },
      outputSchema: { total: z.number().int(), offset: z.number().int(), examples: z.array(z.object({ id: z.string(), type: z.string(), title: z.string(), premium: z.boolean() }).loose()) },
      annotations: { title: 'List examples', ...READ_ONLY }
    },
    wrap(async (a) => {
      const filter = {}
      if (a.type) filter.type = a.type
      if (a.premium != null) filter.premium = a.premium
      let all = (await core.listExamples(Object.keys(filter).length ? filter : undefined)) || []
      if (a.type) all = all.filter((e) => e.type === a.type)
      if (a.premium != null) all = all.filter((e) => !!e.premium === a.premium)
      if (a.query) {
        const words = a.query.toLowerCase().split(/\s+/).filter(Boolean)
        all = all.filter((e) => words.every((w) => `${e.id} ${e.title}`.toLowerCase().includes(w)))
      }
      const page = all.slice(a.offset, a.offset + a.limit)
      const lines = page.map((e) => `${e.id}  [${e.type}${e.premium ? ', premium' : ''}]  ${e.title}`)
      if (a.offset + a.limit < all.length) lines.push(`... ${all.length - a.offset - a.limit} more (offset ${a.offset + a.limit})`)
      return { content: [{ type: 'text', text: lines.join('\n') || 'No examples match.' }], structuredContent: { total: all.length, offset: a.offset, examples: page } }
    })
  )

  server.registerTool(
    'get_example',
    {
      title: 'Get example spec',
      description: [
        'Return the full JSON spec of one curated example (ids come from list_examples). The spec can be passed unchanged to render_chart or adapted.',
        'Read-only. Unknown ids fail with kind "not_found" and the closest ids in the hint.',
        'Example: {"id": "line-basic"}'
      ].join('\n'),
      inputSchema: { id: z.string().min(1).max(200).describe('Example id from list_examples.') },
      outputSchema: { id: z.string(), type: z.string(), title: z.string(), premium: z.boolean(), spec: z.any() },
      annotations: { title: 'Get example', ...READ_ONLY }
    },
    wrap(async (a) => {
      const e = await core.getExample(a.id)
      const res = { id: e.id, type: e.type, title: e.title, premium: !!e.premium, spec: e.spec }
      return { content: [{ type: 'text', text: `${e.title} [${e.type}${e.premium ? ', premium' : ''}]\n${JSON.stringify(e.spec)}` }], structuredContent: res }
    })
  )
}

module.exports = { registerTools, RenderCache, trimSchema, tableMarkdown, READ_ONLY, EX_SPEC, versionOf }
