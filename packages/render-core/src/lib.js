'use strict'
// Resolve an explicitly supplied runtime or the installed public package. Never
// search developer worktrees or mix add-ons from a different library release.
const fs = require('fs')
const path = require('path')
const { WccError } = require('./errors')
function libRoot() {
  if (process.env.WCC_LIB_ROOT) return path.resolve(process.env.WCC_LIB_ROOT)
  try { return path.dirname(require.resolve('west-coast-charts/package.json')) }
  catch (_) { throw new WccError('not_found', 'The WestCoast Charts runtime is not installed.', 'Install the released west-coast-charts Core package alongside west-coast-charts-agent, or set WCC_LIB_ROOT to an explicitly selected release.') }
}
function required(file, label) {
  if (!fs.existsSync(file)) throw new WccError('not_found', `The installed library is missing ${label}.`, 'Install the complete released Core distribution with its matching agent validator, describe module and schema. No approximate fallback is used.', { file: path.basename(file) })
  return file
}
let cached = null
function paths() {
  if (cached) return cached
  const root = libRoot(), dist = path.join(root, 'dist'), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const premium = path.join(dist, 'west-coast-charts-premium.min.js')
  cached = {
    root, version: pkg.version,
    full: required(path.join(dist, 'west-coast-charts.full.min.js'), 'the full free runtime'),
    premium: fs.existsSync(premium) ? premium : null,
    layers: ['wave-ring', 'matrix-core', 'network-facet', 'quint', 'vitals', 'schedule'].map(name => ({ name, file: path.join(dist, 'layers', name + '.min.js'), global: 'WestCoastChartsLayer_' + name.replace(/-(\w)/g, (_, c) => c.toUpperCase()) })).filter(layer => fs.existsSync(layer.file)),
    orient: path.join(dist, 'features', 'orient.min.js'),
    featureRuntime: path.join(dist, 'features', 'runtime.min.js'),
    maps: Object.fromEntries(['world', 'us-states'].map(name => [name, path.join(dist, 'maps', name + '.js')]).filter(([, file]) => fs.existsSync(file))),
    validator: required(path.join(dist, 'agent', 'validate.common.js'), 'the matching validator'),
    describe: required(path.join(dist, 'agent', 'describe.min.js'), 'the matching describe module'),
    schema: required(path.join(dist, 'schema', 'wcc-options.schema.json'), 'the matching options schema'),
  }
  return cached
}
const sources = new Map()
function source(file) {
  if (!sources.has(file)) sources.set(file, fs.readFileSync(file, 'utf8'))
  return sources.get(file)
}
module.exports = { paths, source, required }
