'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs')
const core = require('..')
const NO_KEY = { licenseKey: '', envLicenseKey: '' }
const newExamples = ['quint-timeline', 'quint-convergence', 'vitals-clock-demo', 'schedule-demo']
test('released RC7 validator/schema/types and four additional real Premium renderers', async () => {
 assert.equal(core.version.lib, '1.1.1-rc.7')
 assert.equal(core.version.validator, 'e1')
 for (const id of newExamples) {
  const { spec, type } = core.getExample(id)
  const v = await core.validate(spec)
  assert.equal(v.ok, true, JSON.stringify(v.errors))
  await assert.rejects(core.render(spec, NO_KEY), e => e.kind === 'license' && e.details.reason === 'license_required')
  const r = await core.render(spec, { ...NO_KEY, evaluation: true })
  assert.equal(r.meta.type, type)
  assert.equal(r.meta.tableSource, 'describe')
  assert.equal(r.meta.licensed, false)
  assert.ok(r.table.table.rows.length)
  assert.match(r.svg, /wcc-unlicensed|unlicensed/i)
  assert.doesNotMatch(r.svg, /needs west-coast-charts|NaN/)
  assert.match(r.svg, new RegExp('wcc-' + (type.startsWith('quint') ? 'quint' : type === 'schedule' ? 'schedule' : 'vitals')))
 }
})
test('Orient changes actual free donut geometry and preserves describe values', async () => {
 const spec = core.getExample('donut-orient').spec
 const a = await core.render(spec, NO_KEY)
 spec.chart.orient.angle = 0
 const b = await core.render(spec, NO_KEY)
 const paths = svg => [...svg.matchAll(/<path[^>]*d="([^"]+)"/g)].map(m => m[1])
 assert.notDeepEqual(paths(a.svg), paths(b.svg))
 assert.deepEqual(a.table.table.rows, b.table.table.rows)
 assert.equal(a.meta.premium, false)
})
const validFile = process.env.WCC_TEST_LICENSE_KEY_FILE
const expiredFile = process.env.WCC_TEST_EXPIRED_KEY_FILE
const foreignFile = process.env.WCC_TEST_FOREIGN_KEY_FILE
test('dedicated actual signer acceptance: thirteen Premium types plus expired/foreign rejection', {skip: !(validFile && expiredFile && foreignFile) && 'requires three dedicated private license-only fixture paths'}, async () => {
 const valid = fs.readFileSync(validFile, 'utf8').trim()
 const rejected = [expiredFile, foreignFile].map(f => fs.readFileSync(f, 'utf8').trim())
 const seen = new Set()
 for (const ex of core.listExamples().filter(e => e.premium)) {
  if (seen.has(ex.type)) continue
  const spec = core.getExample(ex.id).spec
  const r = await core.render(spec, {licenseKey: valid, envLicenseKey:''})
  assert.equal(r.meta.licensed, true, ex.type)
  assert.equal(r.meta.tableSource, 'describe')
  assert.doesNotMatch(r.svg, /wcc-unlicensed|unlicensed/i)
  assert.ok(!JSON.stringify(r).includes(valid), 'key must not reach output')
  seen.add(ex.type)
 }
 for (const t of core.listTypes().filter(t => t.tier === 'premium')) assert.ok(seen.has(t.type), t.type)
 assert.ok(seen.has('candlestick'), 'stock-enabled candlestick also exercises Premium')
 for (const key of rejected) {
  for (const evaluation of [false, true]) await assert.rejects(core.render(core.getExample('quint-timeline').spec, {licenseKey:key,envLicenseKey:'',evaluation}), e => {
   assert.ok(!JSON.stringify(e).includes(key), 'rejection must not include key')
   return e.kind === 'license' && e.details.reason === 'license_invalid'
  })
 }
})
