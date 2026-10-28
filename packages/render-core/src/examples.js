'use strict'
// Curated, JSON-only example specs (examples/*.json). Every example is a golden test too.
const fs = require('fs')
const path = require('path')
const { WccError, closest } = require('./errors')
const { isPremiumSpec } = require('./types')

const DIR = path.join(__dirname, '..', 'examples')
let cache = null
function all() {
  if (cache) return cache
  cache = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
      const id = f.replace(/\.json$/, '')
      const type = e.spec.chart.type
      return { id, type, title: e.title, description: e.description || '', tags: e.tags || [], premium: isPremiumSpec(e.spec), spec: e.spec }
    })
  return cache
}
function listExamples(filter = {}) {
  return all()
    .filter((e) => (!filter.type || e.type === filter.type) && (filter.premium === undefined || e.premium === filter.premium) && (!filter.tag || e.tags.includes(filter.tag)))
    .map(({ spec, ...rest }) => rest)
}
function getExample(id) {
  const e = all().find((x) => x.id === id)
  if (!e) {
    const c = closest(id, all().map((x) => x.id))
    throw new WccError('not_found', `No example "${id}".`, c ? `wcc examples get ${c}` : 'wcc examples list', { id, suggestion: c })
  }
  return JSON.parse(JSON.stringify(e))
}
module.exports = { listExamples, getExample }
