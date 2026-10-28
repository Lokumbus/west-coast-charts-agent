'use strict'
// Black-box CLI tests: stdout = artifact/data only, exit codes 0-6, single-line JSON envelope as the last stderr line.
const test = require('node:test')
const assert = require('node:assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const BIN = path.join(__dirname, '..', 'bin', 'wcc.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wcc-cli-'))
const env = Object.assign({}, process.env, { WCC_LICENSE_KEY: '', NO_COLOR: '1' })
delete env.WCC_TEST_INTERNAL_FAULT

function wcc(args, { input, extraEnv } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: tmp, input: input === undefined ? '' : input, env: Object.assign({}, env, extraEnv || {}), maxBuffer: 64 << 20 })
  const stderr = r.stderr.toString()
  const lines = stderr.trim().split('\n')
  let envelope = null
  try {
    envelope = JSON.parse(lines[lines.length - 1])
  } catch (e) {
    /* none */
  }
  return { code: r.status, stdout: r.stdout, out: r.stdout.toString(), stderr, envelope }
}
function expectError(r, code, kind) {
  assert.strictEqual(r.code, code, `exit code ${r.code}, stderr: ${r.stderr}`)
  assert.ok(r.envelope && r.envelope.error, 'last stderr line is a JSON envelope')
  const e = r.envelope.error
  assert.strictEqual(e.kind, kind)
  assert.strictEqual(e.exit_code, code)
  assert.strictEqual(typeof e.message, 'string')
  assert.strictEqual(typeof e.hint, 'string', 'hint present')
  assert.strictEqual(r.stderr.trim().split('\n').pop().includes('\n'), false)
  return e
}

const spec = path.join(tmp, 'line.json')
test('exit 0: examples get --spec-only writes plain JSON', () => {
  const r = wcc(['examples', 'get', 'line-basic', '--spec-only'])
  assert.strictEqual(r.code, 0)
  fs.writeFileSync(spec, r.stdout)
  assert.strictEqual(JSON.parse(r.out).chart.type, 'line')
})

test('exit 0: chart render stdout is the SVG only, byte-identical across processes', () => {
  const a = wcc(['chart', 'render', spec, '--seed', '42'])
  const b = wcc(['chart', 'render', spec, '--seed', '42'])
  assert.strictEqual(a.code, 0)
  assert.match(a.out, /^<svg /)
  assert.ok(a.out.trimEnd().endsWith('</svg>'))
  assert.ok(a.stdout.equals(b.stdout))
  assert.strictEqual(a.stderr, '', 'no stderr noise when piped')
})

test('exit 0: stdin input and example: refs give the same bytes', () => {
  const a = wcc(['chart', 'render', '-'], { input: fs.readFileSync(spec) })
  const b = wcc(['chart', 'render', 'example:line-basic'])
  const c = wcc(['chart', 'render'], { input: fs.readFileSync(spec) })
  assert.ok(a.stdout.equals(b.stdout) && a.stdout.equals(c.stdout))
})

test('exit 0: png is a PNG and deterministic', () => {
  const a = wcc(['chart', 'render', spec, '--format', 'png'])
  const b = wcc(['chart', 'render', spec, '--format', 'png'])
  assert.strictEqual(a.stdout.slice(1, 4).toString(), 'PNG')
  assert.ok(a.stdout.equals(b.stdout))
})

test('exit 0: export is idempotent (changed true, then false)', () => {
  const a = wcc(['chart', 'export', spec, '--out', 'x.svg'])
  const b = wcc(['chart', 'export', spec, '--out', 'x.svg'])
  assert.strictEqual(JSON.parse(a.out).changed, true)
  assert.strictEqual(JSON.parse(b.out).changed, false)
  assert.strictEqual(b.code, 0)
})

test('exit 0: table, types, examples, errors, schema are JSON when piped', () => {
  const t = JSON.parse(wcc(['chart', 'table', spec]).out)
  assert.strictEqual(t.schema, 'wcc-describe/1')
  assert.strictEqual(t.table.rows.length, 12)
  assert.ok(JSON.parse(wcc(['types', 'list']).out).items.some((x) => x.type === 'sankey' && x.premium))
  assert.ok(JSON.parse(wcc(['examples', 'list']).out).items.length >= 15)
  const errs = JSON.parse(wcc(['errors']).out).items
  assert.deepStrictEqual(errs.map((e) => [e.kind, e.exit_code]), [['internal', 1], ['usage', 2], ['schema', 2], ['not_found', 3], ['license', 4], ['conflict', 5], ['confirmation_required', 6]])
  const s = JSON.parse(wcc(['schema']).out)
  assert.strictEqual(s.clispec, '0.3')
  for (const c of s.commands) assert.ok(['read_only', 'idempotent', 'non_idempotent'].includes(c.effects), c.name)
  assert.deepStrictEqual(JSON.parse(wcc(['--help', '--json']).out), s)
  assert.match(wcc(['--help']).out, /wcc schema/)
  assert.deepStrictEqual(JSON.parse(wcc(['schema', 'chart', 'render']).out).commands.map((c) => c.name), ['chart render'])
})

test('ndjson emits one item per line', () => {
  const lines = wcc(['-o', 'ndjson', 'examples', 'list']).out.trim().split('\n')
  assert.ok(lines.length >= 15)
  for (const l of lines) assert.ok(JSON.parse(l).id)
})

test('exit 1: internal error envelope', () => {
  expectError(wcc(['errors'], { extraEnv: { WCC_TEST_INTERNAL_FAULT: '1' } }), 1, 'internal')
})

test('exit 2: usage - unknown command, flag and enum value carry the corrected command', () => {
  assert.strictEqual(expectError(wcc(['chart', 'redner', spec]), 2, 'usage').hint, `wcc chart render ${spec}`)
  assert.strictEqual(expectError(wcc(['chart', 'render', spec, '--fromat', 'png']), 2, 'usage').hint, `wcc chart render ${spec} --format png`)
  assert.strictEqual(expectError(wcc(['chart', 'render', spec, '--format', 'pgn']), 2, 'usage').hint, `wcc chart render ${spec} --format png`)
  expectError(wcc(['chart', 'render', spec, '--seed', 'abc']), 2, 'usage')
})

test('exit 2: schema - invalid spec, bad JSON; the hint names the exact key', () => {
  const bad = path.join(tmp, 'bad.json')
  fs.writeFileSync(bad, JSON.stringify({ chart: { type: 'line', heigth: 300 }, series: [{ data: [1, 2] }] }))
  const e = expectError(wcc(['chart', 'render', bad]), 2, 'schema')
  assert.match(e.hint, /chart\.height/)
  assert.strictEqual(e.details.issues[0].fix.to, 'chart.height')
  const v = wcc(['chart', 'validate', bad])
  expectError(v, 2, 'schema')
  assert.strictEqual(JSON.parse(v.out).ok, false, 'validate still prints its report on stdout')
  expectError(wcc(['chart', 'render', '-'], { input: '{"chart":' }), 2, 'schema')
})

test('exit 3: not_found - file, example, option path', () => {
  expectError(wcc(['chart', 'render', 'line.jsn']), 3, 'not_found')
  assert.strictEqual(expectError(wcc(['examples', 'get', 'line-basc']), 3, 'not_found').hint, 'wcc examples get line-basic')
  assert.strictEqual(expectError(wcc(['options', 'schema', 'chart.tpye']), 3, 'not_found').hint, 'wcc options schema chart.type')
})

test('exit 4: license - premium type without key; hint has the public trial URL', () => {
  const e = expectError(wcc(['chart', 'render', 'example:sankey-budget']), 4, 'license')
  assert.strictEqual(e.details.reason, 'license_required')
  assert.match(e.hint, /WCC_LICENSE_KEY/)
  assert.match(e.hint, /https:\/\/westcoast-charts\.com\/pricing\/#trial/)
  expectError(wcc(['chart', 'render', 'example:sankey-budget'], { extraEnv: { WCC_LICENSE_KEY: 'bogus' } }), 4, 'license')
  // opt-in preview only
  const p = wcc(['chart', 'render', 'example:sankey-budget', '--evaluation'])
  assert.strictEqual(p.code, 0)
  assert.match(p.out, /^<svg /)
})

test('exit 5: conflict - edited skill file needs --force', () => {
  assert.strictEqual(wcc(['skills', 'install', 'sk']).code, 0)
  assert.strictEqual(JSON.parse(wcc(['skills', 'install', 'sk']).out).changed, false)
  fs.appendFileSync(path.join(tmp, 'sk', 'wcc-charts', 'SKILL.md'), '\nlocal edit\n')
  assert.strictEqual(expectError(wcc(['skills', 'install', 'sk']), 5, 'conflict').hint, 'wcc skills install sk --force')
  assert.strictEqual(JSON.parse(wcc(['skills', 'install', 'sk', '--force']).out).changed, true)
})

test('exit 6: confirmation_required - overwrite without TTY needs --yes', () => {
  wcc(['chart', 'export', spec, '--out', 'y.svg'])
  const e = expectError(wcc(['chart', 'export', spec, '--out', 'y.svg', '--width', '500']), 6, 'confirmation_required')
  assert.strictEqual(e.hint, `wcc chart export ${spec} --out y.svg --width 500 --yes`)
  const ok = wcc(['chart', 'export', spec, '--out', 'y.svg', '--width', '500', '--yes'])
  assert.strictEqual(ok.code, 0)
  assert.strictEqual(JSON.parse(ok.out).changed, true)
})

test('text mode errors are human-readable (no JSON at a human), no ANSI', () => {
  const r = wcc(['-o', 'text', 'examples', 'get', 'nope'])
  assert.strictEqual(r.code, 3)
  assert.match(r.stderr, /^wcc: error: /)
  assert.ok(!/\x1b\[/.test(r.stderr + r.out))
})
