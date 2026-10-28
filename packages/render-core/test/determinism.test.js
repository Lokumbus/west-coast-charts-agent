'use strict'
// Golden determinism: every curated example renders byte-identically across runs, and matches the
// committed sha256 manifest (UPDATE_GOLDEN=1 rewrites it after an intended change).
process.env.TZ = 'UTC'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const core = require('..')

const MANIFEST = path.join(__dirname, 'golden', 'manifest.json')
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const golden = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {}
const next = {}
const update = process.env.UPDATE_GOLDEN === '1'

for (const ex of core.listExamples()) {
  test(`golden ${ex.id}`, async () => {
    const spec = core.getExample(ex.id).spec
    const opts = { seed: 7, evaluation: ex.premium, licenseKey: '', envLicenseKey: '' }
    const a = await core.render(spec, opts)
    const b = await core.render(spec, opts)
    assert.strictEqual(a.svg, b.svg, 'two renders must be byte-identical')
    assert.match(a.svg, /^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    assert.ok(a.table && a.table.table && a.table.table.rows.length > 0, 'table has rows')
    const h = sha(a.svg)
    next[ex.id] = h
    if (!update && golden[ex.id]) assert.strictEqual(h, golden[ex.id], `golden drift for ${ex.id} (UPDATE_GOLDEN=1 to accept)`)
  })
}

test('png is byte-identical across runs', async () => {
  const spec = core.getExample('line-basic').spec
  const a = await core.render(spec, { format: 'png', seed: 3 })
  const b = await core.render(spec, { format: 'png', seed: 3 })
  assert.ok(a.png.equals(b.png))
  assert.strictEqual(a.png.slice(1, 4).toString(), 'PNG')
})

test('premium without key -> license error (exit 4, reason license_required)', async () => {
  await assert.rejects(core.render(core.getExample('sankey-budget').spec, { licenseKey: '', envLicenseKey: '' }), (e) => e.kind === 'license' && e.exitCode === 4 && e.details.reason === 'license_required' && /WCC_LICENSE_KEY/.test(e.hint))
})

test('invalid premium key -> license error (reason license_invalid)', async () => {
  await assert.rejects(core.render(core.getExample('sankey-budget').spec, { licenseKey: 'not-a-key' }), (e) => e.kind === 'license' && e.details.reason === 'license_invalid')
})

test('validation runs on the user spec (before headless injection)', async () => {
  await assert.rejects(core.render({ chart: { type: 'line', heigth: 3 }, series: [{ data: [1, 2] }] }), (e) => e.kind === 'schema' && e.exitCode === 2 && /chart.height/.test(e.hint))
})

test('unknown chart type -> not_found with did-you-mean', async () => {
  await assert.rejects(core.render({ chart: { type: 'lnie' }, series: [{ data: [1] }] }, { validate: 'off' }), (e) => e.kind === 'not_found' && /line/.test(e.hint))
})

test.after(() => {
  if (update || !fs.existsSync(MANIFEST)) {
    const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]))
    fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n')
  }
})
