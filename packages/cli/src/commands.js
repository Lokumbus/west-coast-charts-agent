'use strict'
// The command table: single source for dispatch, `wcc --help`, and the clispec v0.3 `wcc schema` document.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const core = require('../../render-core')
const { WccError } = core
const { readSpec, readJsonFile, licenseKey, renderOpts, confirm } = require('./io')

const SKILL_FILE = path.join(__dirname, '..', 'skill', 'SKILL.md')
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

// ---- shared argument declarations (clispec `args`) ----
const A = {
  spec: { name: 'SPEC', type: 'path', positional: true, description: 'Chart spec JSON file, "-" for stdin (default: stdin when it is not a TTY), or "example:<id>".' },
  data: { name: '--data', type: 'path', description: 'JSON file with a series array; replaces spec.series.' },
  format: { name: '--format', type: 'string', enum: ['svg', 'png'], default: 'svg', description: 'Artifact format.' },
  width: { name: '--width', type: 'integer', description: 'Width in px (default: chart.width or 800; max 8000).' },
  height: { name: '--height', type: 'integer', description: 'Height in px (default: chart.height or 450; max 8000).' },
  seed: { name: '--seed', type: 'integer', default: 1, description: 'PRNG seed; same spec + seed + version => byte-identical output.' },
  scale: { name: '--scale', type: 'number', default: 1, description: 'PNG pixel ratio (0.25-4).' },
  background: { name: '--background', type: 'string', description: 'Background colour (PNG default #ffffff; SVG default transparent).' },
  theme: { name: '--theme', type: 'string', enum: ['light', 'dark'], description: 'Theme mode.' },
  validate: { name: '--validate', type: 'string', enum: ['strict', 'warn', 'off'], default: 'strict', description: 'Validation before rendering.' },
  keyFile: { name: '--license-key-file', type: 'path', description: 'File holding the premium licence key (preferred over argv). Precedence: this file > chart.licenseKey in the spec > env WCC_LICENSE_KEY.' },
  key: { name: '--license-key', type: 'string', hidden: true, description: 'Licence key on argv (discouraged: visible in ps/history; prefer WCC_LICENSE_KEY).' },
  fontSet: { name: '--font-set', type: 'string', enum: ['inter-4.1', 'liberation-sans-2.1.5', 'inter', 'liberation'], default: 'inter-4.1', description: 'Frozen font set for layout and PNG: inter-4.1 (theme default) or liberation-sans-2.1.5 (Arial-compatible).' },
  evaluation: { name: '--evaluation', type: 'boolean', description: 'Premium without a key: render with an "unlicensed" watermark (opt-in preview).' },
}
const RENDER_ARGS = [A.spec, A.data, A.format, A.width, A.height, A.seed, A.scale, A.background, A.theme, A.validate, A.fontSet, A.keyFile, A.key, A.evaluation]

const ISSUE_FIELDS = [
  { name: 'kind', type: 'string', enum: ['unknown_option', 'type_mismatch', 'invalid_value', 'deprecated', 'license_required'] },
  { name: 'severity', type: 'string', enum: ['error', 'warning'] },
  { name: 'path', type: 'string' },
  { name: 'pointer', type: 'string' },
  { name: 'message', type: 'string' },
  { name: 'hint', type: 'string', nullable: true },
  { name: 'suggestion', type: 'string', nullable: true },
  { name: 'fix', type: 'object', nullable: true },
]

function fmtTable(cols, rows) {
  const w = cols.map((c, i) => Math.max(String(c).length, ...rows.map((r) => String(r[i] == null ? '' : r[i]).length)))
  const line = (r) => r.map((c, i) => String(c == null ? '' : c).padEnd(w[i])).join('  ').trimEnd()
  return [line(cols), ...rows.map(line)].join('\n') + '\n'
}

async function getSpec(ctx) {
  const ref = ctx.pos[0]
  if (ref && ref.startsWith('example:')) return core.getExample(ref.slice(8)).spec
  return readSpec(ref, ctx)
}
async function specAndOpts(ctx) {
  const spec = await getSpec(ctx)
  const opts = renderOpts(ctx)
  if (ctx.flags['--data'] !== undefined) opts.data = readJsonFile(ctx.flags['--data'], '--data')
  return { spec, opts }
}

const COMMANDS = [
  {
    name: 'chart render',
    example: { args: ['example:line-basic'] },
    description: 'Render a chart spec to SVG or PNG on stdout (the artifact only).',
    effects: 'read_only',
    output_kind: 'opaque',
    media_type: 'image/svg+xml',
    'x-wcc-media-types': { svg: 'image/svg+xml', png: 'image/png' },
    args: RENDER_ARGS,
    errors: ['usage', 'schema', 'not_found', 'license', 'internal'],
    'x-example': 'wcc chart render chart.json > chart.svg',
    async run(ctx) {
      const { spec, opts } = await specAndOpts(ctx)
      opts.table = false
      if (opts.format === 'png' && ctx.io.stdout.isTTY) throw new WccError('usage', 'Refusing to write PNG bytes to a terminal.', `wcc chart render ${ctx.pos[0] || '-'} --format png > chart.png   (or: wcc chart export ${ctx.pos[0] || '-'} --format png --out chart.png)`)
      const r = await core.render(spec, opts)
      ctx.warn(r.meta.warnings)
      ctx.info(`rendered ${r.meta.type} ${r.meta.width}x${r.meta.height} seed=${r.meta.seed} in ${r.meta.ms} ms`)
      return { bytes: r.format === 'svg' ? Buffer.from(r.svg, 'utf8') : r.png }
    },
  },
  {
    name: 'chart export',
    example: { args: ['example:line-basic', '--out', 'wcc-probe.svg', '--yes'] },
    description: 'Render to a file. Idempotent: same bytes => changed:false; different existing file needs confirmation.',
    effects: 'idempotent',
    output_kind: 'data',
    cardinality: 'single',
    confirmation_bypass_arg: '--yes',
    args: [...RENDER_ARGS, { name: '--out', type: 'path', required: true, description: 'Target file (.svg/.png; sets --format when not given).' }, { name: '--yes', type: 'boolean', description: 'Overwrite a different existing file without asking.' }, { name: '--with-table', type: 'boolean', description: 'Include the data table in the result.' }],
    output_fields: [
      { name: 'path', type: 'string' },
      { name: 'format', type: 'string', enum: ['svg', 'png'] },
      { name: 'bytes', type: 'integer' },
      { name: 'sha256', type: 'string' },
      { name: 'changed', type: 'boolean' },
      { name: 'meta', type: 'object' },
      { name: 'table', type: 'object', nullable: true },
    ],
    errors: ['usage', 'schema', 'not_found', 'license', 'confirmation_required', 'internal'],
    'x-example': 'wcc chart export chart.json --out chart.png --yes',
    async run(ctx) {
      const out = ctx.flags['--out']
      if (!out) throw new WccError('usage', 'chart export needs --out <file>.', `wcc chart export ${ctx.pos[0] || '-'} --out chart.svg`)
      if (ctx.flags['--format'] === undefined && /\.png$/i.test(out)) ctx.flags['--format'] = 'png'
      const { spec, opts } = await specAndOpts(ctx)
      opts.table = !!ctx.flags['--with-table']
      const r = await core.render(spec, opts)
      ctx.warn(r.meta.warnings)
      const bytes = r.format === 'svg' ? Buffer.from(r.svg, 'utf8') : r.png
      const abs = path.resolve(out)
      let changed = true
      if (fs.existsSync(abs)) {
        const cur = fs.readFileSync(abs)
        if (cur.equals(bytes)) changed = false
        else if (!ctx.flags['--yes']) {
          const ok = await confirm(ctx, `${out} exists with different content. Overwrite?`)
          if (!ok) throw new WccError('confirmation_required', `${out} exists with different content; overwriting needs confirmation.`, `${ctx.cmdline({ add: ['--yes'] })}`, { path: abs, sha256_existing: sha256(cur), sha256_new: sha256(bytes) })
        }
      }
      if (changed) {
        const tmp = abs + '.wcc-' + process.pid + '.tmp'
        fs.writeFileSync(tmp, bytes)
        fs.renameSync(tmp, abs) // atomic
      }
      const res = { path: abs, format: r.format, bytes: bytes.length, sha256: sha256(bytes), changed, meta: r.meta }
      if (opts.table) res.table = r.table
      return { data: res, text: `${changed ? 'wrote' : 'unchanged'} ${out} (${bytes.length} bytes, ${r.format})\n` }
    },
  },
  {
    name: 'chart validate',
    example: { args: ['example:line-basic'] },
    description: 'Validate a chart spec against the options schema. Report on stdout; exit 2 when it has errors.',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'single',
    args: [A.spec, A.data],
    output_fields: [
      { name: 'ok', type: 'boolean' },
      { name: 'validator', type: 'string', enum: ['e1'] },
      { name: 'errors', type: 'array', items: { type: 'object', fields: ISSUE_FIELDS } },
      { name: 'warnings', type: 'array', items: { type: 'object', fields: ISSUE_FIELDS } },
    ],
    errors: ['usage', 'schema', 'not_found'],
    'x-example': 'wcc -o json chart validate chart.json',
    async run(ctx) {
      const spec = await getSpec(ctx)
      if (ctx.flags['--data'] !== undefined) spec.series = readJsonFile(ctx.flags['--data'], '--data')
      const r = await core.validate(spec)
      const data = { ok: r.ok, validator: r.validator, errors: r.errors, warnings: r.warnings }
      const text =
        (r.ok ? 'valid' : `${r.errors.length} error(s)`) + (r.warnings.length ? `, ${r.warnings.length} warning(s)` : '') + '\n' +
        r.issues.map((i) => `  ${i.severity === 'error' ? 'error' : 'warn '} ${i.path || '(root)'}: ${i.message}${i.hint ? '  -> ' + i.hint : ''}\n`).join('')
      let error = null
      if (!r.ok) {
        const f = r.errors[0]
        error = new WccError('schema', `${f.message}${r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ''}`, f.hint || null, { issues: r.errors, validator: r.validator })
      }
      return { data, text, error }
    },
  },
  {
    name: 'chart table',
    example: { args: ['example:line-basic'] },
    description: 'Render headlessly and return the chart as data (wcc-describe/1: text summary + data table).',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'single',
    args: [A.spec, A.data, A.width, A.height, A.seed, A.theme, A.validate, A.fontSet, A.keyFile, A.key, A.evaluation],
    output_fields: [
      { name: 'schema', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'title', type: 'string', nullable: true },
      { name: 'text', type: 'string' },
      { name: 'table', type: 'object', fields: [{ name: 'caption', type: 'string' }, { name: 'columns', type: 'array', items: { type: 'string' } }, { name: 'rows', type: 'array', items: { type: 'array', items: { type: 'string' } } }, { name: 'total', type: 'integer' }, { name: 'truncated', type: 'boolean' }] },
    ],
    errors: ['usage', 'schema', 'not_found', 'license', 'internal'],
    'x-example': 'wcc chart table chart.json',
    async run(ctx) {
      const { spec, opts } = await specAndOpts(ctx)
      // data stays the schema-valid wcc-describe/1 object; where it came from (meta.tableSource) is shown in text mode
      // and available as meta.tableSource from `wcc chart render --with-table`
      const r = await core.table(spec, { ...opts, withMeta: true })
      const t = r && r.meta && r.schema !== 'wcc-describe/1' ? r.table : r
      const src = r && r.meta ? r.meta.tableSource : null
      const tb = t.table || { columns: [], rows: [] }
      return { data: t, text: (t.text ? t.text + '\n\n' : '') + fmtTable(tb.columns, tb.rows) + (src === 'stub' ? '\n(basic table, source: stub; per-series aggregates, scales and marks not available)\n' : '') }
    },
  },
  {
    name: 'options schema',
    example: { args: ['chart.type'] },
    description: 'JSON Schema (2020-12) of the chart options, or of one option path (e.g. plotOptions.bar).',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'single',
    stdout_schema: {},
    args: [{ name: 'PATH', type: 'string', positional: true, description: 'Dotted option path; arrays as [] (series[].data).' }, { name: '--depth', type: 'integer', description: 'Limit nested properties (default 1 at the root, unlimited for a path).' }],
    errors: ['usage', 'not_found'],
    'x-example': 'wcc options schema plotOptions.bar --depth 2',
    async run(ctx) {
      const p = ctx.pos[0] || ''
      let depth = ctx.flags['--depth']
      if (depth === undefined && !p) depth = 1
      return { data: core.getSchema(p, { depth }) }
    },
  },
  {
    name: 'types list',
    example: { args: [] },
    description: 'Chart types and premium layers with their tier (core, types, premium, premium-layer).',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'bounded',
    args: [{ name: '--tier', type: 'string', enum: ['core', 'types', 'premium', 'premium-layer'], description: 'Filter by tier.' }],
    output_fields: [{ name: 'type', type: 'string' }, { name: 'tier', type: 'string' }, { name: 'premium', type: 'boolean' }, { name: 'module', type: 'string', nullable: true }],
    errors: ['usage'],
    'x-example': 'wcc types list --tier premium',
    async run(ctx) {
      const items = core.listTypes().filter((t) => !ctx.flags['--tier'] || t.tier === ctx.flags['--tier'])
      return { data: { items, total: items.length }, text: fmtTable(['TYPE', 'TIER', 'PREMIUM'], items.map((t) => [t.type, t.tier, t.premium ? 'yes' : 'no'])) }
    },
  },
  {
    name: 'examples list',
    example: { args: [] },
    description: 'Curated example specs (each renders as-is; premium ones need a key).',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'bounded',
    args: [{ name: '--type', type: 'string', description: 'Filter by chart type.' }, { name: '--tag', type: 'string', description: 'Filter by tag.' }, { name: '--premium', type: 'boolean', description: 'Only premium examples.' }, { name: '--free', type: 'boolean', description: 'Only non-premium examples.' }],
    output_fields: [{ name: 'id', type: 'string' }, { name: 'type', type: 'string' }, { name: 'title', type: 'string' }, { name: 'description', type: 'string' }, { name: 'tags', type: 'array', items: { type: 'string' } }, { name: 'premium', type: 'boolean' }],
    errors: ['usage'],
    'x-example': 'wcc examples list --type bar',
    async run(ctx) {
      const f = { type: ctx.flags['--type'], tag: ctx.flags['--tag'] }
      if (ctx.flags['--premium']) f.premium = true
      if (ctx.flags['--free']) f.premium = false
      const items = core.listExamples(f)
      return { data: { items, total: items.length }, text: fmtTable(['ID', 'TYPE', 'TITLE'], items.map((e) => [e.id, e.type + (e.premium ? ' *' : ''), e.title])) }
    },
  },
  {
    name: 'examples get',
    example: { args: ['line-basic'] },
    description: 'One example: metadata plus the spec (--spec-only prints just the spec, ready for chart render).',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'single',
    args: [{ name: 'ID', type: 'string', positional: true, required: true, description: 'Example id (see examples list).' }, { name: '--spec-only', type: 'boolean', description: 'Emit only the spec object.' }],
    output_fields: [{ name: 'id', type: 'string' }, { name: 'type', type: 'string' }, { name: 'title', type: 'string' }, { name: 'premium', type: 'boolean' }, { name: 'spec', type: 'object' }],
    errors: ['usage', 'not_found'],
    'x-example': 'wcc examples get line-basic --spec-only > chart.json',
    async run(ctx) {
      if (!ctx.pos[0]) throw new WccError('usage', 'examples get needs an example id.', 'wcc examples list', null)
      const e = core.getExample(ctx.pos[0])
      const data = ctx.flags['--spec-only'] ? e.spec : e
      return { data, text: JSON.stringify(data, null, 2) + '\n' }
    },
  },
  {
    name: 'skills show',
    example: { args: [] },
    description: 'The agent skill (SKILL.md): how to drive wcc from an agent. Markdown on stdout.',
    effects: 'read_only',
    output_kind: 'opaque',
    media_type: 'text/markdown',
    args: [],
    errors: [],
    'x-example': 'wcc skills show',
    async run() {
      return { bytes: fs.readFileSync(SKILL_FILE) }
    },
  },
  {
    name: 'skills install',
    description: 'Write the agent skill to DIR/wcc-charts/SKILL.md. Idempotent; an edited file is a conflict unless --force.',
    effects: 'idempotent',
    output_kind: 'data',
    cardinality: 'single',
    args: [{ name: 'DIR', type: 'path', positional: true, description: 'Skills directory (default .agents/skills).' }, { name: '--force', type: 'boolean', description: 'Replace a file whose content differs.' }],
    output_fields: [{ name: 'path', type: 'string' }, { name: 'changed', type: 'boolean' }, { name: 'sha256', type: 'string' }],
    errors: ['usage', 'conflict'],
    'x-example': 'wcc skills install .agents/skills',
    async run(ctx) {
      const dir = path.resolve(ctx.pos[0] || '.agents/skills', 'wcc-charts')
      const file = path.join(dir, 'SKILL.md')
      const want = fs.readFileSync(SKILL_FILE)
      let changed = true
      if (fs.existsSync(file)) {
        const cur = fs.readFileSync(file)
        if (cur.equals(want)) changed = false
        else if (!ctx.flags['--force']) throw new WccError('conflict', `${file} exists with different content (edited or another version).`, ctx.cmdline({ add: ['--force'] }), { path: file, sha256_existing: sha256(cur), sha256_new: sha256(want) })
      }
      if (changed) {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(file + '.tmp', want)
        fs.renameSync(file + '.tmp', file)
      }
      return { data: { path: file, changed, sha256: sha256(want) }, text: `${changed ? 'installed' : 'unchanged'} ${file}\n` }
    },
  },
  {
    name: 'errors',
    example: { args: [] },
    description: 'Error kinds with their exit codes (also in `wcc schema`).',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'bounded',
    args: [],
    output_fields: [{ name: 'kind', type: 'string' }, { name: 'exit_code', type: 'integer' }, { name: 'retryable', type: 'boolean' }, { name: 'description', type: 'string' }],
    errors: [],
    'x-example': 'wcc errors --json',
    async run() {
      const items = core.errorCatalog()
      return { data: { items, total: items.length }, text: fmtTable(['EXIT', 'KIND', 'DESCRIPTION'], items.map((e) => [e.exit_code, e.kind, e.description])) }
    },
  },
  {
    name: 'version',
    example: { args: [] },
    description: 'Versions of wcc, render-core, the chart library, validator and font set.',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'single',
    args: [],
    output_fields: [{ name: 'cli', type: 'string' }, { name: 'renderCore', type: 'string' }, { name: 'lib', type: 'string' }, { name: 'validator', type: 'string' }, { name: 'fontSet', type: 'string' }],
    errors: [],
    async run(ctx) {
      const v = Object.assign({ cli: ctx.version }, core.version)
      return { data: v, text: Object.entries(v).map(([k, x]) => `${k} ${x}`).join('\n') + '\n' }
    },
  },
  {
    name: 'schema',
    example: { args: ['chart', 'render'] },
    description: 'clispec v0.3 description of this CLI (commands, args, output shapes, error kinds). Optional command path narrows it.',
    effects: 'read_only',
    output_kind: 'data',
    cardinality: 'single',
    stdout_schema: { $ref: 'https://clispec.dev/schema/v0.3.json' },
    args: [{ name: 'COMMAND', type: 'string[]', positional: true, description: 'Command path to narrow to, e.g. chart render.' }],
    errors: ['not_found'],
    'x-example': 'wcc schema chart render',
    async run(ctx) {
      return { data: ctx.schemaDoc(ctx.pos.join(' ')) }
    },
  },
]

module.exports = { COMMANDS, fmtTable }
