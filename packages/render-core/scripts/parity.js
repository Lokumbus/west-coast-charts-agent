#!/usr/bin/env node
'use strict'
/*
 * Browser parity: render each curated example with render-core (jsdom + frozen fonts + resvg) and in
 * headless Chromium (same lib dist, same prepared spec, bundled Inter via @font-face), then compare
 *   - structure: every mark (path/rect/circle/... under the plot) by Chromium getBBox(), pairwise in DOM order
 *   - text: every <text> (axis labels, titles, data labels) content + bbox, incl. "clipped" (outside the canvas)
 *   - legend: item marker/text boxes (HTML legend in the browser, static SVG legend in render-core)
 *   - pixels: pixelmatch of Chromium screenshot vs resvg PNG
 * Browser work runs under an explicit WCC_BROWSER_LOCK or the temporary-directory lock.
 *
 *   node scripts/parity.js [--out DIR] [id ...]       -> DIR/report.json + DIR/report.md (+ per-example PNGs)
 * Dev tool only: needs puppeteer, pngjs, pixelmatch (resolved from the lib checkout's node_modules or PARITY_NODE_MODULES).
 */
process.env.TZ = 'UTC'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const LOCK = process.env.WCC_BROWSER_LOCK || path.join(require('os').tmpdir(), 'wcc-browser.lock')
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const OUT = path.resolve(outIdx >= 0 ? args.splice(outIdx, 2)[1] : path.join(__dirname, '..', '..', '..', 'tmp', 'parity'))
const ONE = args[0] === '--browser-one' ? args[1] : null

const core = require('..')
const { paths } = require('../src/lib')
const { _prepare, _drop } = require('../src/render')
const fonts = require('../src/fonts')
const NM = process.env.PARITY_NODE_MODULES || path.join(paths().root, 'node_modules')
const need = (m) => require(path.join(NM, m))

const SEED = 7

function pageHtml(ex, prepared, coreSvg) {
  const p = paths()
  const premium = ex.premium
  const fontDir = path.join(__dirname, '..', 'fonts')
  const faces = [
    ['Inter', 400, 'normal', 'Inter-Regular.ttf'], ['Inter', 500, 'normal', 'Inter-Medium.ttf'], ['Inter', 600, 'normal', 'Inter-SemiBold.ttf'],
    ['Inter', 700, 'normal', 'Inter-Bold.ttf'], ['Inter', 400, 'italic', 'Inter-Italic.ttf'], ['Inter', 700, 'italic', 'Inter-BoldItalic.ttf'],
    ['Liberation Sans', 400, 'normal', 'LiberationSans-Regular.ttf'], ['Liberation Sans', 700, 'normal', 'LiberationSans-Bold.ttf'],
  ]
  const ff = faces.map(([f, w, s, file]) => `@font-face{font-family:'${f}';font-weight:${w};font-style:${s};src:url('file://${path.join(fontDir, /^Inter-/.test(file) ? 'src' : '', file)}')}`).join('\n')
  const scripts = [p.full].concat(premium ? [p.premium].concat(p.layers.map((l) => l.file)) : [])
  const use = premium ? `if (window.WestCoastChartsPremium && !W.setLicenseKey) W.use(window.WestCoastChartsPremium);${p.layers.map((l) => `if (window.${l.global}) W.use(window.${l.global});`).join('')}` : ''
  // map charts: the same map data module render-core loads, evaluated after premium is installed
  const mo = (ex.spec.plotOptions && ex.spec.plotOptions.map) || {}
  const mapFile = premium && ex.spec.chart.type === 'map' && p.maps[typeof mo.map === 'string' ? mo.map : 'world']
  const useAll = use + (mapFile ? `;(0, eval)(${JSON.stringify(fs.readFileSync(mapFile, 'utf8'))});` : '')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${ff}
html,body{margin:0;padding:0;background:#fff}#wcc-root{width:${prepared.width}px;height:${prepared.height}px;position:relative}#core{position:absolute;left:0;top:${prepared.height + 50}px}</style>
${scripts.map((s) => `<script src="file://${s}"></script>`).join('\n')}
</head><body><div id="wcc-root"></div><div id="core">${coreSvg}</div>
<script>
window.__done = (async () => {
  const W = window.WestCoastCharts; ${useAll}
  await document.fonts.load('12px Inter'); await document.fonts.load('600 12px Inter'); await document.fonts.load('500 12px Inter'); await document.fonts.load('700 12px Inter')
  const chart = new W(document.getElementById('wcc-root'), ${JSON.stringify(prepared.spec)})
  await chart.render()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise((r) => setTimeout(r, 300))
  await document.fonts.ready
  return true
})()
</script></body></html>`
}

// runs in the page: extract comparable geometry from an <svg> (+ optional HTML legend root)
function extractInPage(DROP) {
  const R = (n) => Math.round(n * 100) / 100
  function grab(svg, legendRoot) {
    const base = svg.getBoundingClientRect()
    const W = +svg.getAttribute('width'), H = +svg.getAttribute('height')
    const skip = (el) => el.closest('defs,clipPath,mask,marker,pattern,title,desc,.wcc-legend-static,.wcc-unlicensed' + (DROP.length ? ',' + DROP.join(',') : ''))
    const box = (el) => { const r = el.getBoundingClientRect(); return [R(r.left - base.left), R(r.top - base.top), R(r.width), R(r.height)] }
    const visible = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity !== 0 }
    const marks = []
    for (const el of svg.querySelectorAll('path,rect,circle,ellipse,line,polygon,polyline')) {
      if (skip(el) || !visible(el)) continue
      if (el.tagName === 'rect' && el.parentNode === svg) continue // background rect (render-core adds one)
      const b = box(el)
      if (b[2] === 0 && b[3] === 0) continue
      marks.push({ k: el.tagName + '.' + String(el.getAttribute('class') || '').split(/\s+/).filter((c) => /^apexcharts-|^wcc-/.test(c)).sort().join('.'), b })
    }
    const texts = []
    for (const el of svg.querySelectorAll('text')) {
      if (skip(el) || !visible(el)) continue
      const t = Array.from(el.childNodes).filter((n) => n.nodeType === 3 || n.tagName === 'tspan').map((n) => n.textContent).join('').trim()
      if (!t) continue
      const b = box(el)
      // zero box = not laid out (a culled / collapsed node): no drawn text, like zero marks above
      if (b[2] === 0 && b[3] === 0) continue
      texts.push({ t, b, clipped: b[0] < -0.5 || b[1] < -0.5 || b[0] + b[2] > W + 0.5 || b[1] + b[3] > H + 0.5 })
    }
    const legend = []
    if (legendRoot) {
      for (const s of legendRoot.querySelectorAll('.apexcharts-legend-series')) {
        const tx = s.querySelector('.apexcharts-legend-text'), mk = s.querySelector('.apexcharts-legend-marker')
        if (!tx || getComputedStyle(s).display === 'none') continue
        // text box = the glyph box (range), like SVG text bbox
        const rg = document.createRange(); rg.selectNodeContents(tx); const rr = rg.getBoundingClientRect()
        legend.push({ t: tx.textContent.trim(), text: [R(rr.left - base.left), R(rr.top - base.top), R(rr.width), R(rr.height)], marker: mk ? box(mk) : null })
      }
    } else {
      const g = svg.querySelector('.wcc-legend-static')
      if (g) {
        const kids = Array.from(g.children)
        for (let i = 0; i < kids.length; i++) {
          if (kids[i].tagName !== 'text') continue
          const prev = kids[i - 1] && kids[i - 1].tagName === 'rect' ? kids[i - 1] : null
          legend.push({ t: kids[i].textContent.trim(), text: box(kids[i]), marker: prev ? box(prev) : null })
        }
      }
    }
    return { marks, texts, legend, W, H }
  }
  const root = document.getElementById('wcc-root')
  const b = root.querySelector('svg.apexcharts-svg') || root.querySelector('svg')
  return { browser: grab(b, root.querySelector('.apexcharts-legend')), core: grab(document.querySelector('#core svg'), null) }
}

async function browserOne(id) {
  const puppeteer = need('puppeteer')
  const dir = path.join(OUT, id)
  const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'))
  const html = path.join(dir, 'page.html')
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-lcd-text'] })
  try {
    const p = await b.newPage()
    await p.emulateTimezone('UTC')
    await p.setViewport({ width: job.width, height: job.height * 2 + 100, deviceScaleFactor: 1 })
    const errors = []
    p.on('pageerror', (e) => errors.push(String(e)))
    await p.goto('file://' + html)
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await p.waitForFunction('window.__done', { timeout: 20000 }).catch((e) => {
      throw new Error(`page did not start: ${errors.join(' | ') || e.message}`)
    })
    await p.evaluate('window.__done')
    const geo = await p.evaluate(extractInPage, job.drop)
    await (await p.$('#wcc-root')).screenshot({ path: path.join(dir, 'browser.png'), clip: { x: 0, y: 0, width: job.width, height: job.height } })
    fs.writeFileSync(path.join(dir, 'geo.json'), JSON.stringify({ ...geo, errors }))
  } finally {
    await b.close()
  }
}

function compare(geo) {
  const out = {}
  // marks: pair in DOM order per kind
  const byKind = (arr) => arr.reduce((m, x) => ((m[x.k] = m[x.k] || []).push(x.b), m), {})
  const A = byKind(geo.browser.marks), B = byKind(geo.core.marks)
  let n = 0, within = 0, max = 0, missing = 0
  const worst = []
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const a = A[k] || [], b = B[k] || []
    missing += Math.abs(a.length - b.length)
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = Math.max(...a[i].map((v, j) => Math.abs(v - b[i][j])))
      n++
      if (d <= 1) within++
      if (d > max) max = d
      if (d > 1) worst.push({ k, i, browser: a[i], core: b[i], d: Math.round(d * 100) / 100 })
    }
  }
  worst.sort((x, y) => y.d - x.d)
  out.marks = { browser: geo.browser.marks.length, core: geo.core.marks.length, paired: n, unpaired: missing, within1px: n ? Math.round((within / n) * 1000) / 10 : 100, maxDelta: Math.round(max * 100) / 100, worst: worst.slice(0, 5) }
  // texts: pair by content; a repeated label (tick values, duplicated / offscreen names) pairs
  // with its nearest same-content box, closest pairs first (not by order of occurrence)
  const tdist = (t, c) => Math.max(Math.abs(t.b[0] - c.b[0]), Math.abs(t.b[1] + t.b[3] / 2 - (c.b[1] + c.b[3] / 2)), Math.abs(t.b[2] - c.b[2]))
  const pool = new Map()
  for (const t of geo.core.texts) (pool.get(t.t) || pool.set(t.t, []).get(t.t)).push(t)
  const bpool = new Map()
  for (const t of geo.browser.texts) (bpool.get(t.t) || bpool.set(t.t, []).get(t.t)).push(t)
  let tn = 0, tw = 0, tmax = 0, onlyBrowser = []
  const tworst = []
  for (const [txt, bs] of bpool) {
    const cs = pool.get(txt) || []
    const cand = []
    bs.forEach((t, i) => cs.forEach((c, j) => cand.push([tdist(t, c), i, j])))
    cand.sort((x, y) => x[0] - y[0])
    const ub = new Set(), uc = new Set()
    for (const [d, i, j] of cand) {
      if (ub.has(i) || uc.has(j)) continue
      ub.add(i)
      uc.add(j)
      // positions: compare x/y of the box and the width (font metrics); height differs by line-box model
      tn++
      if (d <= 1) tw++
      if (d > tmax) tmax = d
      if (d > 1) tworst.push({ t: txt, browser: bs[i].b, core: cs[j].b, d: Math.round(d * 100) / 100 })
    }
    bs.forEach((t, i) => ub.has(i) || onlyBrowser.push(txt))
    pool.set(txt, cs.filter((c, j) => !uc.has(j)))
  }
  const onlyCore = [...pool.values()].flat().map((t) => t.t)
  tworst.sort((x, y) => y.d - x.d)
  out.texts = { browser: geo.browser.texts.length, core: geo.core.texts.length, paired: tn, within1px: tn ? Math.round((tw / tn) * 1000) / 10 : 100, maxDelta: Math.round(tmax * 100) / 100, onlyBrowser, onlyCore, clippedBrowser: geo.browser.texts.filter((t) => t.clipped).map((t) => t.t), clippedCore: geo.core.texts.filter((t) => t.clipped).map((t) => t.t), worst: tworst.slice(0, 5) }
  // legend
  const la = geo.browser.legend, lb = geo.core.legend
  let lmax = 0
  const lrows = (l) => new Set(l.map((x) => Math.round(x.text[1] + x.text[3] / 2))).size
  for (let i = 0; i < Math.min(la.length, lb.length); i++) {
    const a = la[i], b = lb[i]
    const d = Math.max(Math.abs(a.text[0] - b.text[0]), Math.abs(a.text[1] + a.text[3] / 2 - (b.text[1] + b.text[3] / 2)), a.marker && b.marker ? Math.max(Math.abs(a.marker[0] - b.marker[0]), Math.abs(a.marker[1] + a.marker[3] / 2 - (b.marker[1] + b.marker[3] / 2))) : 0)
    lmax = Math.max(lmax, d)
  }
  out.legend = { browser: la.length, core: lb.length, rowsBrowser: lrows(la), rowsCore: lrows(lb), maxDelta: Math.round(lmax * 100) / 100, items: la.map((a, i) => ({ t: a.t, browser: a.text, core: lb[i] && lb[i].text })) }
  return out
}

function pixelDiff(dir, w, h) {
  const { PNG } = need('pngjs')
  let pm = need('pixelmatch')
  pm = pm.default || pm
  const a = PNG.sync.read(fs.readFileSync(path.join(dir, 'browser.png')))
  const b = PNG.sync.read(fs.readFileSync(path.join(dir, 'core.png')))
  if (a.width !== b.width || a.height !== b.height) return { error: `size ${a.width}x${a.height} vs ${b.width}x${b.height}` }
  const diff = new PNG({ width: a.width, height: a.height })
  const n = pm(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.15, includeAA: false })
  fs.writeFileSync(path.join(dir, 'diff.png'), PNG.sync.write(diff))
  return { diffPixels: n, diffPct: Math.round((n / (a.width * a.height)) * 10000) / 100 }
}

function grade(r) {
  const p = r.pixels.diffPct, m = r.cmp.marks, t = r.cmp.texts, l = r.cmp.legend
  const legendOk = l.browser === l.core && l.rowsBrowser === l.rowsCore && l.maxDelta <= 3
  // clipped text counts only where the core clips more than Chromium (a library scroll
  // viewport or a chart wider than its canvas clips the same labels in both)
  const cb = t.clippedBrowser.slice()
  const clipped = t.clippedCore.filter((x) => { const i = cb.indexOf(x); if (i > -1) cb.splice(i, 1); return i < 0 }).length > 0
  if (m.unpaired === 0 && m.within1px >= 99 && t.within1px >= 95 && t.onlyBrowser.length === 0 && legendOk && !clipped && p < 1.5) return 'match'
  if (m.within1px >= 95 && t.within1px >= 85 && legendOk && !clipped && p < 4) return 'close'
  return 'diverges'
}

async function main() {
  if (ONE) return browserOne(ONE)
  const ids = args.length ? args : core.listExamples().map((e) => e.id)
  fs.mkdirSync(OUT, { recursive: true })
  const results = []
  for (const id of ids) {
    const ex = core.getExample(id)
    const dir = path.join(OUT, id)
    fs.mkdirSync(dir, { recursive: true })
    const opts = { seed: SEED, evaluation: ex.premium, licenseKey: '', envLicenseKey: '' }
    const t0 = Date.now()
    const svg = await core.render(ex.spec, opts)
    const png = await core.render(ex.spec, { ...opts, format: 'png' })
    const coreMs = Date.now() - t0
    fs.writeFileSync(path.join(dir, 'core.svg'), svg.svg)
    fs.writeFileSync(path.join(dir, 'core.png'), png.png)
    const prepared = _prepare(ex.spec, opts)
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ width: prepared.width, height: prepared.height, drop: _drop }))
    fs.writeFileSync(path.join(dir, 'page.html'), pageHtml(ex, prepared, svg.svg.replace(/^<\?xml[^>]*>/, '')))
    const t1 = Date.now()
    // short hold: one example's browser work per lock acquisition
    execFileSync('flock', ['-w', '600', LOCK, process.execPath, __filename, '--out', OUT, '--browser-one', id], { stdio: 'inherit' })
    const browserMs = Date.now() - t1
    const geo = JSON.parse(fs.readFileSync(path.join(dir, 'geo.json'), 'utf8'))
    const r = { id, premium: ex.premium, fontSet: svg.meta.fontSet, cmp: compare(geo), pixels: pixelDiff(dir, prepared.width, prepared.height), pageErrors: geo.errors, ms: { core: coreMs, browser: browserMs } }
    r.grade = grade(r)
    results.push(r)
    const c = r.cmp
    console.log(`${id.padEnd(20)} ${r.grade.padEnd(9)} marks ${c.marks.within1px}%≤1px (max ${c.marks.maxDelta}, unpaired ${c.marks.unpaired}) text ${c.texts.within1px}% (max ${c.texts.maxDelta}${c.texts.clippedCore.length ? ', CLIPPED ' + c.texts.clippedCore.join('|') : ''}) legend ${c.legend.core}/${c.legend.browser} rows ${c.legend.rowsCore}/${c.legend.rowsBrowser} Δ${c.legend.maxDelta} px ${r.pixels.diffPct}%`)
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2))
  const md = ['| example | grade | marks ≤1px | marks maxΔ | text ≤1px | text maxΔ | clipped (core/browser) | legend items/rows core vs browser, maxΔ | pixel diff |', '|---|---|---|---|---|---|---|---|---|']
  for (const r of results) {
    const c = r.cmp
    md.push(`| ${r.id}${r.premium ? ' (premium)' : ''} | ${r.grade} | ${c.marks.within1px}% (${c.marks.paired}${c.marks.unpaired ? ', ' + c.marks.unpaired + ' unpaired' : ''}) | ${c.marks.maxDelta} | ${c.texts.within1px}% (${c.texts.paired}) | ${c.texts.maxDelta} | ${c.texts.clippedCore.length}/${c.texts.clippedBrowser.length} | ${c.legend.core}/${c.legend.rowsCore} vs ${c.legend.browser}/${c.legend.rowsBrowser}, ${c.legend.maxDelta} | ${r.pixels.diffPct}% |`)
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n') + '\n')
  console.log('report:', path.join(OUT, 'report.md'))
}

main().catch((e) => {
  console.error(e && e.stack || e)
  process.exit(1)
})
