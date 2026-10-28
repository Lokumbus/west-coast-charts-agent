'use strict'
// Headless render: WCC options spec -> standalone SVG (+ PNG via resvg) + the visualization-level table.
const nodeCrypto = require('crypto')
const { paths, source } = require('./lib')
const geometry = require('./geometry')
const fonts = require('./fonts')
const { WccError, toWccError } = require('./errors')
const { assertValid } = require('./validate')
const { isPremiumType, isPremiumSpec, premiumClaim, layersUsed, allTypeNames } = require('./types')
const { closest } = require('./errors')

const RENDER_CORE_VERSION = require('../package.json').version
const LICENSE_URL = 'https://westcoast-charts.com/pricing/#trial'
const SVG_NS = 'http://www.w3.org/2000/svg'
const DEFAULT_W = 800
const DEFAULT_H = 450

function seeded(a) {
  a = a >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clone(spec) {
  try {
    return JSON.parse(JSON.stringify(spec))
  } catch (e) {
    throw new WccError('schema', 'The spec is not JSON-serialisable: ' + e.message, 'Send plain JSON (no functions, no cycles).')
  }
}

// Rebuild plain data inside the jsdom realm: the library uses `instanceof Array`
// / constructor checks, which fail for arrays created in the Node realm.
function toRealm(win, v) {
  if (Array.isArray(v)) { const a = new win.Array(); for (const x of v) a.push(toRealm(win, x)); return a }
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o = new win.Object(); for (const k of Object.keys(v)) o[k] = toRealm(win, v[k]); return o
  }
  return v
}

function prepare(spec, opts) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new WccError('schema', 'The spec must be a JSON object of chart options.', 'Pass an object like {"chart":{"type":"line"},"series":[{"data":[1,2,3]}]}.')
  const s = clone(spec)
  if (opts.data !== undefined) s.series = clone(opts.data)
  // validate what the caller wrote, before the renderer adds its own chart.* settings
  const { warnings } = assertValid(s, opts.validate || 'strict')
  s.chart = s.chart || {}
  const num = (v) => (typeof v === 'number' && v > 0 ? v : typeof v === 'string' && /^\d+(\.\d+)?(px)?$/.test(v) ? parseFloat(v) : null)
  const width = Math.round(num(opts.width) || num(s.chart.width) || DEFAULT_W)
  const height = Math.round(num(opts.height) || num(s.chart.height) || DEFAULT_H)
  if (width > 8000 || height > 8000) throw new WccError('usage', `Canvas ${width}x${height} is too large (max 8000 px per side).`, 'Use --width/--height <= 8000.')
  s.chart.width = width
  s.chart.height = height
  s.chart.animations = Object.assign({}, s.chart.animations, { enabled: false })
  s.chart.deterministic = true // worker E2 contract (chart.deterministic / chart.seed)
  const seed = Number.isInteger(opts.seed) ? opts.seed : 1
  if (s.chart.seed === undefined) s.chart.seed = seed
  if (!s.chart.id) s.chart.id = 'wcc'
  s.chart.toolbar = Object.assign({}, s.chart.toolbar, { show: false })
  if (opts.theme) s.theme = Object.assign({}, s.theme, { mode: opts.theme })
  return { spec: s, width, height, seed, warnings }
}

function checkType(spec) {
  const t = spec.chart && spec.chart.type
  if (!t) throw new WccError('schema', 'chart.type is required.', 'Set chart.type, e.g. {"chart":{"type":"line"}}. List types: wcc types list')
  if (!allTypeNames().includes(t)) {
    const c = closest(t, allTypeNames())
    throw new WccError('not_found', `Unknown chart type "${t}".`, c ? `Use "chart":{"type":"${c}"}` : 'List types: wcc types list', { type: t, suggestion: c })
  }
  return t
}

function makeWindow(width, height, seed, fontSet) {
  const { JSDOM } = require('jsdom') // lazy: list/schema commands stay fast
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="wcc-root" style="width:${width}px;height:${height}px"></div></body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://headless.wcc.invalid/',
  })
  const w = dom.window
  geometry.install(w, { width, height }, fontSet)
  w.Math.random = seeded(seed ^ 0x5eed)
  // neutral UA: the library skips canvas text measurement when the UA says jsdom; geometry.js supplies a
  // measurement-only canvas context with the frozen fonts, so premium label layout matches browsers
  Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 (X11; Linux x86_64) WCC-Headless/render-core', configurable: true })
  // the chart is the whole "page": responsive breakpoints (window.innerWidth) see the chart width, so a
  // 420 px export picks the same layout the chart shows when it fills a 420 px viewport
  for (const [k, v] of [['innerWidth', width], ['outerWidth', width], ['innerHeight', height], ['outerHeight', height]])
    Object.defineProperty(w, k, { value: v, configurable: true })
  w.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  w.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  w.matchMedia = () => ({ matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
  if (!(w.crypto && w.crypto.subtle)) Object.defineProperty(w, 'crypto', { value: nodeCrypto.webcrypto, configurable: true })
  w.console = { log() {}, info() {}, debug() {}, warn: (...a) => w.__wccWarnings.push(a.join(' ')), error: (...a) => w.__wccWarnings.push(a.join(' ')) }
  w.__wccWarnings = []
  w.WCC_HEADLESS = true
  return { dom, w }
}

function loadLib(w, needPremium, spec) {
  const p = paths()
  w.eval(source(p.full))
  const W = w.WestCoastCharts
  if (!W) throw new WccError('internal', 'West Coast Charts did not load in the headless DOM.')
  W.headless = true
  if (needPremium) {
    if (!p.premium) throw new WccError('not_found', 'This installation contains Free Core only; the Premium runtime is not installed.', 'Install your separately obtained complete Premium library package. A licence key does not download or bundle Premium code.', { reason: 'premium_runtime_missing' })
    const special = { quintTimeline: 'quint', quintConvergence: 'quint', vitalsClock: 'vitals', schedule: 'schedule' }[spec.chart.type]
    if (special && !p.layers.some(layer => layer.name === special)) throw new WccError('not_found', 'The installed Premium runtime is missing the ' + special + ' module.', 'Install the matching complete Premium release.', { reason: 'premium_module_missing', module: special })
    w.eval(source(p.premium))
    if (w.WestCoastChartsPremium && !W.setLicenseKey) W.use(w.WestCoastChartsPremium)
    for (const l of p.layers) {
      w.eval(source(l.file))
      if (w[l.global]) W.use(w[l.global])
    }
    // map charts: the named map data module ('world' is the library default); custom maps need registerMap
    const mo = (spec && spec.plotOptions && spec.plotOptions.map) || {}
    const name = typeof mo.map === 'string' ? mo.map : 'world'
    if (spec && spec.chart && spec.chart.type === 'map' && p.maps[name]) w.eval(source(p.maps[name]))
  }
  // The full free bundle already contains Orient; loading its standalone module
  // again would register another lifecycle handler.
  w.eval(source(p.describe)) // auto-installs chart.describe()
  return W
}

async function settle(w, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => w.setTimeout(r, 0))
}

const DROP = ['.apexcharts-tooltip', '.apexcharts-xcrosshairs', '.apexcharts-ycrosshairs', '.apexcharts-zoom-rect', '.apexcharts-selection-rect', '.apexcharts-toolbar', '.wcc-overlay', '.apexcharts-xaxistooltip', '.apexcharts-yaxistooltip', '.wcc-focus-ring', 'foreignObject']

function legendToSvg(w, root, svg) {
  const lg = root.querySelector('.apexcharts-legend')
  if (!lg || lg.style.display === 'none' || !lg.querySelector('.apexcharts-legend-series')) return
  const W = parseFloat(svg.getAttribute('width')) || 0
  const L = geometry.legendLayout(lg, W)
  if (!L.rows.length) return
  const doc = svg.ownerDocument
  const g = doc.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'wcc-legend-static')
  let y = parseFloat(lg.style.top) || 0
  const rightPx = parseFloat(lg.style.right)
  const left = !Number.isFinite(parseFloat(lg.style.left)) && Number.isFinite(rightPx) ? W - rightPx - L.width : parseFloat(lg.style.left) || 0
  const align = /apexcharts-align-(\w+)/.exec(lg.className)
  for (const row of L.rows) {
    let x
    if (L.pos === 'left' || L.pos === 'right') x = left + L.pad
    else if (align && align[1] === 'left') x = L.pad
    else if (align && align[1] === 'right') x = W - L.pad - row.w
    else x = (W - row.w) / 2
    for (const it of row.items) {
      const cx = x + it.mx
      const cy = y + it.my + it.ih / 2
      if (it.mk) {
        const color = it.mk.style.color || it.mk.style.backgroundColor || it.mk.style.background || '#888'
        const m = doc.createElementNS(SVG_NS, 'rect')
        const mh = it.mh
        m.setAttribute('x', fmt(cx))
        m.setAttribute('y', fmt(cy - mh / 2))
        m.setAttribute('width', fmt(it.mw))
        m.setAttribute('height', fmt(mh))
        m.setAttribute('rx', fmt(Math.min(it.mr, it.mw / 2, mh / 2)))
        m.setAttribute('fill', color)
        g.appendChild(m)
      }
      const t = doc.createElementNS(SVG_NS, 'text')
      t.setAttribute('x', fmt(cx + it.mw + it.gap))
      t.setAttribute('y', fmt(cy))
      t.setAttribute('dominant-baseline', 'central')
      t.setAttribute('font-size', String(it.f.size))
      if (it.f.weight && String(it.f.weight) !== '400') t.setAttribute('font-weight', String(it.f.weight))
      t.setAttribute('fill', (it.tx && it.tx.style.color) || '#373d3f')
      t.textContent = it.text
      g.appendChild(t)
      x += it.w
    }
    y += row.h
  }
  svg.appendChild(g)
}
const fmt = (n) => String(Math.round(n * 100) / 100)

function serialize(w, root, width, height, fontSet) {
  const FONT_STACK = fontSet.stack
  const paper = root.querySelector('svg.apexcharts-svg') || root.querySelector('svg')
  if (!paper) throw new WccError('internal', 'The chart produced no SVG.')
  const svg = paper.cloneNode(true)
  for (const sel of DROP) svg.querySelectorAll(sel).forEach((e) => e.remove())
  // interactive-only attributes
  for (const a of ['tabindex', 'focusable', 'transform']) svg.removeAttribute(a)
  svg.setAttribute('role', 'img')
  svg.removeAttribute('aria-roledescription')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  // keyboard hint makes no sense in a static image
  const desc = svg.querySelector('desc')
  if (desc) desc.textContent = desc.textContent.replace(/\s*Use arrow keys[^.]*\.[^.]*\.?/, '').trim()
  // background: CSS background on <svg> is not painted by every renderer -> a rect
  const bg = /background:\s*([^;]+)/.exec(svg.getAttribute('style') || '')
  if (bg && !/transparent|rgba\(0, 0, 0, 0\)/.test(bg[1])) {
    const r = svg.ownerDocument.createElementNS(SVG_NS, 'rect')
    r.setAttribute('class', 'wcc-background')
    r.setAttribute('width', '100%')
    r.setAttribute('height', '100%')
    r.setAttribute('fill', bg[1].trim())
    const first = Array.from(svg.children).find((c) => !/^(title|desc|defs)$/i.test(c.localName))
    svg.insertBefore(r, first || null)
  }
  svg.removeAttribute('style')
  legendToSvg(w, root, svg)
  // frozen font set: layout was measured with it, so the file names it first (Arial is metric-compatible)
  svg.setAttribute('font-family', FONT_STACK)
  // the theme CSS (not part of the SVG) draws all chart text with tabular figures; keep that for viewers
  svg.setAttribute('style', 'font-variant-numeric:tabular-nums')
  svg.querySelectorAll('[font-family]').forEach((e) => e.setAttribute('font-family', FONT_STACK))
  svg.querySelectorAll('[style*="font-family"]').forEach((e) => e.style.setProperty('font-family', FONT_STACK))
  let s = new w.XMLSerializer().serializeToString(svg)
  s = s.replace(/&nbsp;/g, '&#160;')
  return s
}

async function getTable(w, root, chart, W) {
  if (typeof chart.describe !== 'function') throw new WccError('internal', 'The installed describe module did not attach chart.describe().', 'Install matching released runtime and agent modules.')
  try {
    const table = await chart.describe({ format: 'json' })
    if (!table || typeof table !== 'object' || table.schema !== 'wcc-describe/1') throw new Error('Unsupported describe result')
    return { table: JSON.parse(JSON.stringify(table)), source: 'describe' }
  } catch (error) {
    throw new WccError('internal', 'chart.describe() failed for this chart.', 'Check this chart type against the installed library release. No DOM approximation is returned.', { reason: error.message })
  }
}

const KEY_SOURCE_LABEL = { option: 'the licenseKey option (--license-key-file)', spec: 'chart.licenseKey in the spec', env: 'WCC_LICENSE_KEY' }
/**
 * Licence key precedence, mirroring the browser library (chart.licenseKey beats the page-wide
 * WestCoastCharts.setLicenseKey(); WCC_LICENSE_KEY is the headless equivalent of setLicenseKey):
 *   1. opts.licenseKey  (explicit operator key: CLI --license-key-file / MCP config; '' = not given)
 *   2. spec chart.licenseKey
 *   3. opts.envLicenseKey, else process.env.WCC_LICENSE_KEY
 * Like the browser, there is no fallthrough: an invalid key at one level is not retried with the next.
 */
function resolveLicenseKey(spec, opts) {
  if (typeof opts.licenseKey === 'string' && opts.licenseKey.trim()) return { key: opts.licenseKey.trim(), source: 'option' }
  const sk = spec.chart && spec.chart.licenseKey
  if (typeof sk === 'string' && sk.trim()) return { key: sk.trim(), source: 'spec' }
  const ek = opts.envLicenseKey !== undefined ? opts.envLicenseKey : process.env.WCC_LICENSE_KEY
  if (typeof ek === 'string' && ek.trim()) return { key: ek.trim(), source: 'env' }
  return { key: '', source: null }
}

async function verifyLicense(W, key) {
  if (!key) return null
  try {
    return await W.setLicenseKey(key)
  } catch (e) {
    return null
  }
}

/** core pipeline shared by render() and table() */
async function run(spec0, opts = {}, want = { svg: true, table: true }) {
  const t0 = process.hrtime.bigint()
  const { spec, width, height, seed, warnings } = prepare(spec0, opts)
  const type = checkType(spec)
  const layers = layersUsed(spec)
  const premium = isPremiumSpec(spec) // incl. candlestick + plotOptions.stock.enabled (premium stock)
  const fontSet = fonts.fontSet(opts.fontSet || fonts.DEFAULT_SET)
  if (!fontSet) {
    const c = closest(String(opts.fontSet), fonts.FONT_SETS.concat(Object.keys(fonts.ALIASES)))
    throw new WccError('usage', `Unknown font set "${opts.fontSet}".`, `Use --font-set ${c || fonts.DEFAULT_SET} (available: ${fonts.FONT_SETS.join(', ')}).`, { fontSet: opts.fontSet, available: fonts.FONT_SETS })
  }
  const { key, source: keySource } = resolveLicenseKey(spec, opts)
  if (key) spec.chart.licenseKey = key // the library's own watermark check reads chart.licenseKey first, keep it in step
  const evaluation = !!opts.evaluation && !key
  if (premium && !key && !evaluation) {
    throw new WccError('license', `Chart type "${type}"${layers.length ? ' with layer ' + layers.join(', ') : ''} is a premium feature and needs a licence key.`, `Set WCC_LICENSE_KEY=<key> (or --license-key-file <file>, or chart.licenseKey in the spec) and re-run; to preview with an "unlicensed" watermark add --evaluation; trial: ${LICENSE_URL}`, { reason: 'license_required', type, layers, licenseUrl: LICENSE_URL })
  }
  const { dom, w } = makeWindow(width, height, seed, fontSet)
  let chart = null
  try {
    const W = loadLib(w, premium, spec)
    let licensed = false
    if (premium && !evaluation) {
      const lic = await verifyLicense(W, key)
      if (!lic) throw new WccError('license', `The licence key from ${KEY_SOURCE_LABEL[keySource]} is not valid for this version of West Coast Charts premium (wrong signature, expired, wrong major version or host binding).`, `Fix or replace the key in ${KEY_SOURCE_LABEL[keySource]}, or get a key at ${LICENSE_URL}`, { reason: 'license_invalid', type, keySource, licenseUrl: LICENSE_URL })
      licensed = true
    }
    const root = w.document.getElementById('wcc-root')
    chart = new W(root, toRealm(w, spec))
    await chart.render()
    await settle(w)
    const out = { svg: null, table: null }
    let tableSource = null
    if (want.table) {
      const t = await getTable(w, root, chart, W)
      out.table = t.table
      tableSource = t.source
      if (t.warning) warnings.push({ kind: 'runtime_warning', severity: 'warning', path: '', message: t.warning })
    }
    if (want.svg) out.svg = serialize(w, root, width, height, fontSet)
    const libWarnings = w.__wccWarnings.map((m) => ({ kind: 'runtime_warning', severity: 'warning', path: '', message: m }))
    return { ...out, meta: { type, premium, licensed, licenseKeySource: key ? keySource : null, width, height, seed, tableSource, libVersion: paths().version, renderCoreVersion: RENDER_CORE_VERSION, fontSet: fontSet.id, ms: Number(process.hrtime.bigint() - t0) / 1e6, warnings: [...warnings, ...libWarnings] } }
  } catch (e) {
    throw toWccError(e)
  } finally {
    try {
      if (chart) chart.destroy()
    } catch (e) {
      /* ignore */
    }
    w.close()
  }
}

// resvg gets every frozen face (Inter + Liberation Sans); the SVG's font stack picks the family, per-glyph fallback follows it
const ALL_FONT_FILES = () => [...new Set(fonts.FONT_SETS.flatMap((id) => fonts.fontSet(id).files()))]

function toPng(svg, { scale = 1, background = '#ffffff', fontSet } = {}) {
  const dflt = fonts.fontSet(fontSet) || fonts.fontSet(fonts.DEFAULT_SET)
  // resvg cannot apply font-variant-numeric: point the SVG family at the tnum-baked faces of the same set
  for (const id of fonts.FONT_SETS) {
    const f = fonts.fontSet(id)
    if (f.rasterFamily !== f.family) svg = svg.split(`'${f.family}'`).join(`'${f.rasterFamily}'`)
  }
  const { Resvg } = require('@resvg/resvg-js')
  if (!(scale >= 0.25 && scale <= 4)) throw new WccError('usage', `--scale ${scale} is out of range.`, 'Use a scale between 0.25 and 4, e.g. --scale 2.')
  const r = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    background,
  font: { fontFiles: ALL_FONT_FILES(), loadSystemFonts: false, defaultFontFamily: dflt.rasterFamily, sansSerifFamily: dflt.rasterFamily, serifFamily: dflt.rasterFamily, monospaceFamily: dflt.rasterFamily, cursiveFamily: dflt.rasterFamily, fantasyFamily: dflt.rasterFamily },
    shapeRendering: 2,
    textRendering: 1,
  })
  return Buffer.from(r.render().asPng())
}

async function render(spec, opts = {}) {
  const format = opts.format || 'svg'
  if (format !== 'svg' && format !== 'png') throw new WccError('usage', `Unknown format "${format}".`, 'Use --format svg or --format png.')
  const r = await run(spec, opts, { svg: true, table: opts.table !== false })
  const res = { format, table: r.table, meta: r.meta }
  if (format === 'svg') res.svg = r.svg
  else res.png = toPng(r.svg, { scale: opts.scale || 1, background: opts.background || '#ffffff', fontSet: r.meta.fontSet })
  res.meta.ms = Math.round(res.meta.ms * 10) / 10
  return res
}

// table(spec, opts) -> wcc-describe/1 (schema-valid, no extra keys).
// table(spec, {withMeta: true}) -> {table, meta}; meta.tableSource is 'describe'; unsupported descriptions fail explicitly.
async function table(spec, opts = {}) {
  const r = await run(spec, opts, { svg: false, table: true })
  if (opts.withMeta) {
    r.meta.ms = Math.round(r.meta.ms * 10) / 10
    return { table: r.table, meta: r.meta }
  }
  return r.table
}

module.exports = { render, table, toPng, resolveLicenseKey, _prepare: prepare, _drop: DROP, LICENSE_URL, RENDER_CORE_VERSION, measure: (...a) => fonts.measure(...a) }
