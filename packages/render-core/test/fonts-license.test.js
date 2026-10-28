'use strict'
// Font sets, describe-table schema conformance, licence-key precedence, and (opt-in) a real premium key.
process.env.TZ = 'UTC'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const core = require('..')
const fonts = require('../src/fonts')

const line = () => core.getExample('line-basic').spec
const sankey = () => core.getExample('sankey-budget').spec
const NOENV = { envLicenseKey: '' }

test('default font set is Inter 4.1, with Liberation Sans as fallback family', async () => {
  const r = await core.render(line(), { seed: 7 })
  assert.strictEqual(r.meta.fontSet, 'inter-4.1')
  assert.match(r.svg, /font-family="'Inter', 'Liberation Sans', Arial, Helvetica, sans-serif"/)
})

test('--font-set liberation still works and changes layout', async () => {
  const a = await core.render(line(), { seed: 7 })
  const b = await core.render(line(), { seed: 7, fontSet: 'liberation' })
  assert.strictEqual(b.meta.fontSet, 'liberation-sans-2.1.5')
  assert.match(b.svg, /font-family="'Liberation Sans', Arial/)
  assert.notStrictEqual(a.svg, b.svg)
})

test('unknown font set -> usage error with the exact fix', async () => {
  await assert.rejects(core.render(line(), { fontSet: 'intr' }), (e) => e.kind === 'usage' && e.exitCode === 2 && /--font-set inter/.test(e.hint))
})

test('glyphs Inter lacks are measured with the fallback face, never as zero width', () => {
  const inter = fonts.fontSet('inter-4.1')
  assert.ok(inter.measure('\u0e01', 12) > 0 || inter.measure('\u2603', 12) > 0)
  assert.ok(inter.measure('AVAVAV', 12) < inter.measure('A', 12) * 3 + inter.measure('V', 12) * 3, 'GPOS kerning applied')
})

test('bundled font licences are present (SIL OFL 1.1)', () => {
  for (const f of ['LICENSE-Inter.txt', 'LICENSE-Liberation.txt']) {
    const t = fs.readFileSync(require('path').join(__dirname, '..', 'fonts', f), 'utf8')
    assert.match(t, /SIL Open Font License/)
  }
})

const DESCRIBE_SCHEMA = process.env.WCC_DESCRIBE_SCHEMA || require('path').join(require('../src/lib').paths().root, 'dist/schema/wcc-describe.schema.json')
test('table conforms to E2 wcc-describe/1 (schema has additionalProperties:false); source is in meta', async () => {
  const Ajv = require('ajv')
  const validate = new Ajv({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync(DESCRIBE_SCHEMA, 'utf8')))
  for (const id of ['line-basic', 'pie-basic', 'scatter-basic', 'heatmap-basic', 'gauge-progress']) {
    const r = await core.render(core.getExample(id).spec, { seed: 7 })
    assert.strictEqual(r.meta.tableSource, 'describe')
    assert.strictEqual(r.table.source, undefined)
    assert.ok(validate(r.table), `${id}: ${JSON.stringify(validate.errors)}`)
  }
})

test('licence precedence: option > chart.licenseKey > env (no fallthrough, like the browser library)', async () => {
  const withSpecKey = Object.assign(sankey(), {})
  withSpecKey.chart = Object.assign({}, withSpecKey.chart, { licenseKey: 'spec-bogus' })
  await assert.rejects(core.render(withSpecKey, { envLicenseKey: 'env-bogus' }), (e) => e.details.reason === 'license_invalid' && e.details.keySource === 'spec' && /chart.licenseKey/.test(e.hint))
  await assert.rejects(core.render(withSpecKey, { licenseKey: 'opt-bogus' }), (e) => e.details.keySource === 'option')
  await assert.rejects(core.render(sankey(), { envLicenseKey: 'env-bogus' }), (e) => e.details.keySource === 'env')
  await assert.rejects(core.render(sankey(), { licenseKey: '', ...NOENV }), (e) => e.details.reason === 'license_required' && /chart.licenseKey/.test(e.hint))
  assert.deepStrictEqual(core.resolveLicenseKey({ chart: { licenseKey: ' k ' } }, NOENV), { key: 'k', source: 'spec' })
})

// Opt-in: a real (short-lived TEST) premium key. Never commit a key; pass a file path:
//   WCC_TEST_LICENSE_KEY_FILE=/tmp/wcc-test-key node --test packages/render-core/test/
const KEY_FILE = process.env.WCC_TEST_LICENSE_KEY_FILE
test('premium with a valid key renders licensed (no watermark), from every key source', { skip: !(KEY_FILE && fs.existsSync(KEY_FILE)) && 'set WCC_TEST_LICENSE_KEY_FILE to a test key file' }, async () => {
  const key = fs.readFileSync(KEY_FILE, 'utf8').trim()
  for (const id of ['sankey-budget', 'chord-plans', 'network-services', 'sunburst-browsers', 'marimekko-market', 'radial-column-ring']) {
    const ex = core.getExample(id)
    if (!ex.premium) continue
    const r = await core.render(ex.spec, { seed: 7, licenseKey: key, ...NOENV })
    assert.strictEqual(r.meta.licensed, true, id)
    assert.strictEqual(r.meta.licenseKeySource, 'option')
    assert.doesNotMatch(r.svg, /wcc-unlicensed|unlicensed/, `${id} must not carry the watermark`)
    assert.ok(!r.svg.includes(key), 'the key must never appear in the output')
  }
  const spec = sankey()
  spec.chart = Object.assign({}, spec.chart, { licenseKey: key })
  const s = await core.render(spec, { seed: 7, licenseKey: '', ...NOENV })
  assert.strictEqual(s.meta.licenseKeySource, 'spec')
  assert.ok(!s.svg.includes(key))
  const e = await core.render(sankey(), { seed: 7, licenseKey: '', envLicenseKey: key })
  assert.strictEqual(e.meta.licenseKeySource, 'env')
})

test('browser-parity metrics: tabular vs proportional figures, Chromium-rounded line metrics', () => {
  const { fontSet } = require('../src/fonts')
  const inter = fontSet('inter')
  // SVG/HTML chart text is tabular (theme CSS); canvas measureText is proportional
  assert.equal(inter.measure('1111', 12), inter.measure('0000', 12))
  assert.ok(inter.measure('1111', 12, 400, 'normal', 'proportional') < inter.measure('0000', 12, 400, 'normal', 'proportional'))
  assert.deepEqual(inter.metrics(12), { ascent: 12, descent: 3, lineGap: 0, lineHeight: 15 })
  assert.deepEqual(inter.metrics(11), { ascent: 11, descent: 3, lineGap: 0, lineHeight: 14 })
})

test('headless window: canvas measureText uses the frozen fonts; drawing canvases stay null', async () => {
  const { JSDOM } = require('jsdom')
  const geometry = require('../src/geometry')
  const { fontSet } = require('../src/fonts')
  const w = new JSDOM('<!doctype html><body></body>').window
  geometry.install(w, { width: 100, height: 100 }, fontSet('inter'))
  const ctx = w.document.createElement('canvas').getContext('2d')
  ctx.font = '600 12px Inter, sans-serif'
  assert.equal(ctx.measureText('COGS 400').width, fontSet('inter').measure('COGS 400', 12, '600', 'normal', 'proportional'))
  const named = w.document.createElement('canvas')
  named.className = 'wcc-net-canvas'
  assert.equal(named.getContext('2d'), null)
})
