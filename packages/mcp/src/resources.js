'use strict'
/*
 * Resources: library docs as markdown, the error catalog, an agent quickstart and recent renders.
 */
const fs = require('fs')
const path = require('path')
const { ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { docsDir, versionOf } = require('./core')
const { toEnvelope } = require('./errors')

const QUICKSTART = `# West Coast Charts for agents — quickstart

West Coast Charts (WCC) is an SVG chart library with an ApexCharts-compatible options API.
A *spec* is the JSON options object: \`{ chart: { type }, series, xaxis, ... }\`. No functions.

Workflow that avoids invented options:
1. \`list_chart_types\` — pick a valid \`chart.type\` (premium types need a licence key).
2. \`list_examples\` / \`get_example\` — start from a curated spec of that type.
3. \`get_schema {path}\` — look up exact option names before adding options.
4. \`validate_chart\` — fix every error using its \`hint\` / \`suggestion\` until \`ok: true\`.
5. \`render_chart\` — get SVG/PNG plus the verification table.
6. Read the verification table (or \`describe_chart\`) and check the drawn values, units and aggregates. Shape \`wcc-describe/1\`: \`text\`, \`table.{caption,columns,rows,total,truncated}\` (cells are formatted strings), and with \`source: "describe"\` also \`aggregate\`, \`series[].aggregate\`, \`scales\`, \`extrema\`, \`hidden\`
   match your intent. Never sum percentiles, rates or scores; set \`plotOptions.<type>.aggregate\`.

Errors are tool results with \`isError: true\` and \`{ error: { kind, message, hint, details } }\`.
Kinds: usage, schema, not_found, license, internal (same as the \`wcc\` CLI). Follow \`hint\`.
Output is deterministic: same spec + seed => identical bytes.

In a web page:
\`\`\`js
import WestCoastCharts from 'west-coast-charts'
new WestCoastCharts(document.querySelector('#chart'), spec).render()
\`\`\`
`

const ERROR_KIND_TEXT = {
  usage: 'Invalid tool arguments (wrong type, out of range, too large). Fix the argument named in the message.',
  schema: 'The spec failed validation. details.issues lists each problem with path, hint and suggestion.',
  not_found: 'Unknown chart type, example id or schema path. The hint lists the closest matches.',
  license: 'Premium chart type without a valid licence key. details.reason is "license_required" (no key configured) or "license_invalid" (key rejected: wrong signature, expired, wrong tier). Configure WCC_LICENSE_KEY / x-wcc-license-key or use a free type.',
  internal: 'Renderer or server bug. Retry once, then report the spec.',
  conflict: 'CLI only: output file exists without --force.',
  confirmation_required: 'CLI only: overwriting action without TTY and without --yes.'
}

function listDocs() {
  const root = docsDir()
  const out = []
  for (const sub of ['guide', 'guide/reference', 'features']) {
    const d = path.join(root, sub)
    let files = []
    try {
      files = fs.readdirSync(d).filter((f) => f.endsWith('.md'))
    } catch (e) {
      continue
    }
    for (const f of files.sort()) {
      const slug = `${sub.replace(/\//g, '-')}-${f.replace(/\.md$/, '')}`.replace(/-README$/, '-index').toLowerCase()
      out.push({ slug, file: path.join(d, f) })
    }
  }
  return out
}

function firstHeading(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000)
    const m = head.match(/^#\s+(.+)$/m)
    return m ? m[1].trim() : null
  } catch (e) {
    return null
  }
}

function registerResources(server, ctx) {
  server.registerResource(
    'quickstart',
    'wcc://docs/agent-quickstart',
    { title: 'Agent quickstart', description: 'How an agent should use these tools to build correct charts (read first, ~500 tokens).', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: QUICKSTART }] })
  )

  server.registerResource(
    'docs',
    new ResourceTemplate('wcc://docs/{slug}', {
      list: async () => ({
        resources: listDocs().map((d) => ({
          uri: `wcc://docs/${d.slug}`,
          name: d.slug,
          title: firstHeading(d.file) || d.slug,
          mimeType: 'text/markdown',
          size: safeSize(d.file)
        }))
      }),
      complete: { slug: (v) => listDocs().map((d) => d.slug).filter((s) => s.startsWith(v || '')) }
    }),
    { title: 'West Coast Charts documentation', description: 'Library guide, option reference and feature docs as markdown. Large pages (options reference) can exceed 50k tokens; prefer get_schema for single options.', mimeType: 'text/markdown' },
    async (uri, { slug }) => {
      if (slug === 'agent-quickstart') return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: QUICKSTART }] }
      const d = listDocs().find((x) => x.slug === slug)
      if (!d) throw new Error(`Unknown doc '${slug}'. Available: ${listDocs().map((x) => x.slug).join(', ')}`)
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: fs.readFileSync(d.file, 'utf8') }] }
    }
  )

  server.registerResource(
    'errors',
    'wcc://errors',
    { title: 'Error catalog', description: 'Every error kind with CLI exit code and how to fix it (JSON). Same envelope for MCP tool errors and the wcc CLI.', mimeType: 'application/json' },
    async (uri) => {
      let cat
      try {
        cat = await ctx.core.errorCatalog()
      } catch (e) {
        cat = null
      }
      const kinds = (cat && cat.length ? cat : Object.keys(ERROR_KIND_TEXT).map((kind) => ({ kind }))).map((c) => ({ ...c, mcp: ERROR_KIND_TEXT[c.kind] || c.description }))
      const doc = { envelope: { error: { kind: 'string', message: 'string', hint: 'string|null', details: 'object|null' } }, transport: 'CallToolResult.isError = true; structuredContent = envelope', kinds }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(doc, null, 1) }] }
    }
  )

  server.registerResource(
    'version',
    'wcc://version',
    { title: 'Versions', description: 'Server, render core, chart library and font set versions (determinism key).', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ server: ctx.version, ...versionOf(ctx.core) }) }] })
  )

  server.registerResource(
    'renders',
    new ResourceTemplate('wcc://renders/{id}', { list: undefined }),
    { title: 'Recent renders', description: 'The last 32 outputs of render_chart in this session (SVG text or PNG blob), addressed by the uri render_chart returned.', mimeType: 'image/svg+xml' },
    async (uri, { id }) => {
      const r = ctx.renders.get(id)
      if (!r) throw new Error(`Render '${id}' is not cached (only the last 32 renders of this session are kept). Call render_chart again.`)
      return { contents: [r.png ? { uri: uri.href, mimeType: r.mimeType, blob: r.buf.toString('base64') } : { uri: uri.href, mimeType: r.mimeType, text: r.buf.toString('utf8') }] }
    }
  )
}

function safeSize(f) {
  try {
    return fs.statSync(f).size
  } catch (e) {
    return undefined
  }
}

module.exports = { registerResources, listDocs, QUICKSTART, ERROR_KIND_TEXT, toEnvelope }
