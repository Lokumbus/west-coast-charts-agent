'use strict'
// Options JSON Schema (worker E1: dist/schema/wcc-options.schema.json) and sub-schema lookup by dotted path.
const fs = require('fs')
const { paths } = require('./lib')
const { WccError, closest } = require('./errors')

let root = undefined
function load() {
  if (root !== undefined) return root
  const p = paths().schema
  root = p ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
  return root
}
const deref = (s, r) => {
  let guard = 0
  while (s && s.$ref && guard++ < 20) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref)
    s = m ? Object.assign({}, r.$defs[m[1]], omit(s, '$ref')) : s
  }
  return s
}
const omit = (o, k) => {
  const c = Object.assign({}, o)
  delete c[k]
  return c
}
function branches(s, r) {
  s = deref(s, r)
  const alts = s.anyOf || s.oneOf || s.allOf
  return alts ? alts.map((a) => deref(a, r)) : [s]
}
function child(s, key, r) {
  for (const b of branches(s, r)) {
    if (/^\[\d*\]$/.test(key) || /^\d+$/.test(key)) {
      if (b.items) return deref(b.items, r)
      continue
    }
    if (b.properties && b.properties[key]) return deref(b.properties[key], r)
    if (b.type === 'array' && b.items) {
      const it = child(b.items, key, r)
      if (it) return it
    }
  }
  return null
}
function keysOf(s, r) {
  const out = new Set()
  for (const b of branches(s, r)) {
    if (b.properties) Object.keys(b.properties).forEach((k) => out.add(k))
    if (b.items) for (const bi of branches(b.items, r)) if (bi.properties) Object.keys(bi.properties).forEach((k) => out.add(k))
  }
  return Array.from(out)
}
function refsIn(node, r, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    node.forEach((n) => refsIn(n, r, acc))
    return acc
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      const m = /^#\/\$defs\/(.+)$/.exec(v)
      if (m && !acc.has(m[1])) {
        acc.add(m[1])
        refsIn(r.$defs[m[1]], r, acc)
      }
    } else refsIn(v, r, acc)
  }
  return acc
}
function prune(node, depth) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((n) => prune(n, depth))
  const out = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'properties' && v && typeof v === 'object') {
      if (depth <= 0) {
        out['x-wcc-keys'] = Object.keys(v)
        continue
      }
      out.properties = {}
      for (const [pk, pv] of Object.entries(v)) out.properties[pk] = prune(pv, depth - 1)
    } else out[k] = prune(v, depth)
  }
  return out
}

/** getSchema(path?, {depth?}) -> JSON Schema node; depth limits nested properties (bounded output) */
function getSchema(path = '', opts = {}) {
  const r = load()
  if (!r) throw new WccError('not_found', 'The options schema is not built yet (worker E1: dist/schema/wcc-options.schema.json).', 'Build it with: node tools/agent/gen-schema.cjs in the west-coast-charts repo')
  const segs = String(path || '')
    .replace(/\[(\d*)\]/g, '.[$1]')
    .split('.')
    .filter(Boolean)
  let node = r
  const walked = []
  for (const s of segs) {
    const n = child(node, s, r)
    if (!n) {
      const keys = keysOf(node, r)
      const c = closest(s, keys)
      const at = walked.join('.')
      const fixed = c ? [...walked, c].join('.') : null
      throw new WccError('not_found', `No option "${s}"${at ? ' in ' + at : ' at the top level'}.`, fixed ? `wcc options schema ${fixed}` : `Known keys: ${keys.slice(0, 30).join(', ')}`, { path, known: keys.slice(0, 100), suggestion: fixed })
    }
    node = n
    walked.push(s)
  }
  let out = segs.length ? Object.assign({}, node) : omit(r, '$defs')
  if (segs.length) {
    const defs = refsIn(out, r)
    if (defs.size) out.$defs = Object.fromEntries(Array.from(defs).sort().map((d) => [d, r.$defs[d]]))
    out = Object.assign({ $schema: r.$schema, 'x-wcc-path': segs.join('.'), 'x-wcc-version': r['x-wcc-version'] }, out)
  }
  if (Number.isInteger(opts.depth)) out = prune(out, opts.depth)
  return out
}
function topKeys() {
  const r = load()
  return r ? Object.keys(r.properties) : null
}

module.exports = { getSchema, topKeys }
