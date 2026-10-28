'use strict'
// Layout shims for a headless DOM (jsdom has no layout engine and no SVG geometry).
// Text is measured with the frozen font set (src/fonts.js), shapes from their attributes,
// groups as the union of their children; the HTML legend gets a small flex-wrap model.
// Everything here is a pure function of the DOM -> deterministic.
const fonts = require('./fonts')
// the font set of the window being rendered (install() sets it); default set otherwise
let active = fonts.fontSet(fonts.DEFAULT_SET)
const setOf = (el) => (el && el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.__wccFontSet) || active
const measure = (...a) => active.measure(...a)
const metrics = (...a) => active.metrics(...a)

const num = (v, d = 0) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : d
}
const EMPTY = () => ({ x: 0, y: 0, width: 0, height: 0 })

function styleProp(el, name, cssName) {
  for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
    const s = e.style && e.style.getPropertyValue(cssName)
    if (s) return s
    const a = e.getAttribute && e.getAttribute(name)
    if (a) return a
  }
  return null
}
function fontOf(el) {
  let size = styleProp(el, 'font-size', 'font-size')
  size = size ? num(size, 12) : 12
  const weight = styleProp(el, 'font-weight', 'font-weight') || 400
  const style = styleProp(el, 'font-style', 'font-style') || 'normal'
  return { size, weight, style }
}

// ---- transforms (translate / scale / matrix / rotate as affine) ----
function parseTransform(t) {
  let m = [1, 0, 0, 1, 0, 0]
  if (!t) return m
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g
  let r
  while ((r = re.exec(t))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number)
    let n
    if (r[1] === 'matrix' && a.length === 6) n = a
    else if (r[1] === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]
    else if (r[1] === 'scale') n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]
    else if (r[1] === 'rotate') {
      const c = Math.cos(((a[0] || 0) * Math.PI) / 180)
      const s = Math.sin(((a[0] || 0) * Math.PI) / 180)
      const cx = a[1] || 0
      const cy = a[2] || 0
      n = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
    }
    if (n && n.every(Number.isFinite)) m = mul(m, n)
  }
  return m
}
function mul(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
}
function applyBox(m, b) {
  if (!b || (b.width === 0 && b.height === 0 && b.x === 0 && b.y === 0)) return b
  const pts = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
const union = (a, b) => {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

// ---- path bbox (all commands, abs/rel; curves by their control hull, arcs by endpoints +- radius) ----
function pathBox(d) {
  if (!d) return null
  const toks = String(d).match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)
  if (!toks) return null
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (px, py) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  const n = () => parseFloat(toks[i++])
  const counts = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++]
    const lc = cmd.toLowerCase()
    const rel = cmd !== cmd.toUpperCase()
    if (lc === 'z') {
      x = sx
      y = sy
      if (i < toks.length && !/[a-zA-Z]/.test(toks[i])) i++
      continue
    }
    if (!counts[lc] || i + counts[lc] > toks.length) break
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    if (lc === 'm' || lc === 'l' || lc === 't') {
      x = ox + n()
      y = oy + n()
      if (lc === 'm') {
        sx = x
        sy = y
        cmd = rel ? 'l' : 'L'
      }
    } else if (lc === 'h') x = ox + n()
    else if (lc === 'v') y = oy + n()
    else if (lc === 'c' || lc === 's' || lc === 'q') {
      const k = counts[lc] / 2
      for (let j = 0; j < k - 1; j++) add(ox + n(), oy + n())
      x = ox + n()
      y = oy + n()
    } else if (lc === 'a') {
      const rx = Math.abs(n())
      const ry = Math.abs(n())
      i += 3
      const px = x
      const py = y
      x = ox + n()
      y = oy + n()
      // conservative: extend by the radius around the chord
      const r = Math.max(rx, ry)
      const cx = (px + x) / 2
      const cy = (py + y) / 2
      const half = Math.hypot(x - px, y - py) / 2
      if (r > half) {
        add(cx - r, cy - r)
        add(cx + r, cy + r)
      }
    }
    add(x, y)
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// rendered text only: <title>/<desc> children are tooltips, not glyphs
function textOf(el) {
  let out = ''
  for (const c of Array.from(el.childNodes || [])) {
    if (c.nodeType === 3) out += c.nodeValue
    else if (c.nodeType === 1 && !/^(title|desc)$/i.test(c.localName)) out += textOf(c)
  }
  return out
}

function textBox(el) {
  const f = fontOf(el)
  const m = metrics(f.size)
  const tspans = Array.from(el.children || []).filter((c) => c.tagName && c.tagName.toLowerCase() === 'tspan')
  const multi = tspans.length > 1 && tspans.filter((t) => t.hasAttribute('x') || t.hasAttribute('dy')).length > 1
  let width
  let lines = 1
  if (multi) {
    width = Math.max(...tspans.map((t) => measure(textOf(t), fontOf(t).size, fontOf(t).weight, fontOf(t).style)))
    lines = tspans.length
  } else width = measure(textOf(el), f.size, f.weight, f.style)
  if (!textOf(el)) return EMPTY()
  const lh = f.size * 1.2
  let x = num(el.getAttribute('x'))
  let y = num(el.getAttribute('y'))
  if (!el.hasAttribute('x') && tspans[0]) x = num(tspans[0].getAttribute('x'))
  if (!el.hasAttribute('y') && tspans[0]) y = num(tspans[0].getAttribute('y'))
  const anchor = styleProp(el, 'text-anchor', 'text-anchor') || 'start'
  if (anchor === 'middle') x -= width / 2
  else if (anchor === 'end') x -= width
  return { x, y: y - m.ascent, width, height: m.ascent + m.descent + (lines - 1) * lh }
}

function ownBox(el) {
  const tag = (el.localName || el.tagName || '').toLowerCase()
  const a = (k) => num(el.getAttribute(k))
  switch (tag) {
    case 'text':
      return textBox(el)
    case 'tspan':
    case 'textpath':
      return textBox(el)
    case 'rect':
    case 'image':
    case 'foreignobject':
    case 'use':
      return { x: a('x'), y: a('y'), width: a('width'), height: a('height') }
    case 'circle':
      return { x: a('cx') - a('r'), y: a('cy') - a('r'), width: 2 * a('r'), height: 2 * a('r') }
    case 'ellipse':
      return { x: a('cx') - a('rx'), y: a('cy') - a('ry'), width: 2 * a('rx'), height: 2 * a('ry') }
    case 'line': {
      const x = Math.min(a('x1'), a('x2'))
      const y = Math.min(a('y1'), a('y2'))
      return { x, y, width: Math.abs(a('x2') - a('x1')), height: Math.abs(a('y2') - a('y1')) }
    }
    case 'polyline':
    case 'polygon':
      return pathBox('M' + (el.getAttribute('points') || ''))
    case 'path':
      return pathBox(el.getAttribute('d'))
    case 'defs':
    case 'clippath':
    case 'mask':
    case 'lineargradient':
    case 'radialgradient':
    case 'pattern':
    case 'filter':
    case 'title':
    case 'desc':
    case 'style':
    case 'marker':
      return null
    default: {
      // g, svg, a, switch ...: union of the children, each in its own transform
      let b = null
      for (const c of Array.from(el.children || [])) {
        if (c.getAttribute && c.getAttribute('display') === 'none') continue
        let cb = ownBox(c)
        if (!cb) continue
        const t = c.getAttribute && c.getAttribute('transform')
        if (t) cb = applyBox(parseTransform(t), cb)
        b = union(b, cb)
      }
      return b
    }
  }
}
const bbox = (el) => {
  const b = ownBox(el) || EMPTY()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

function ctm(el) {
  // transforms of el and its SVG ancestors (nested <svg x y> as translation)
  let m = [1, 0, 0, 1, 0, 0]
  const chain = []
  for (let e = el; e && e.nodeType === 1 && e.namespaceURI === 'http://www.w3.org/2000/svg'; e = e.parentNode) chain.unshift(e)
  chain.forEach((e, idx) => {
    if (idx > 0 && e.localName === 'svg') m = mul(m, [1, 0, 0, 1, num(e.getAttribute('x')), num(e.getAttribute('y'))])
    const t = e.getAttribute('transform')
    if (t) m = mul(m, parseTransform(t))
  })
  return m
}
const matrixObj = (m) => ({
  a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5],
  inverse() {
    const det = m[0] * m[3] - m[1] * m[2] || 1
    return matrixObj([m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det])
  },
  multiply(o) {
    return matrixObj(mul(m, [o.a, o.b, o.c, o.d, o.e, o.f]))
  },
})
const rect = (b) => ({ x: b.x, y: b.y, left: b.x, top: b.y, width: b.width, height: b.height, right: b.x + b.width, bottom: b.y + b.height, toJSON() { return this } })

// ---- HTML: px from inline style, the legend as flex-wrap rows ----
function legendLayout(el, maxWidth) {
  active = setOf(el)
  const items = Array.from(el.querySelectorAll('.apexcharts-legend-series')).filter((s) => s.style.display !== 'none' && !/apexcharts-hidden-(zero|null)-series/.test(s.className))
  const pos = (/apx-legend-position-(\w+)/.exec(el.className) || [])[1] || 'bottom'
  const out = []
  for (const s of items) {
    const marg = (s.style.margin || '4px 12px').split(/\s+/).map((v) => num(v))
    const my = marg[0] || 0
    const mx = marg.length > 1 ? marg[1] : my
    const mk = s.querySelector('.apexcharts-legend-marker')
    // theme CSS (Presets.js) sizes the WCC markers by class; plain ApexCharts markers carry inline sizes
    const kind = mk && /wcc-legend-marker-(line|dot|square)/.exec(mk.className)
    const themed = mk && /\bwcc-legend-marker\b/.test(mk.className)
    const WCC_MK = { line: [12, 3, 2], dot: [8, 8, 4], square: [9, 9, 2.5] }
    const tm = themed ? WCC_MK[(kind && kind[1]) || 'square'] : null
    const mw = mk ? (tm ? tm[0] : num(mk.style.width, 12) || 12) : 0
    const mh = mk ? (tm ? tm[1] : num(mk.style.height, 12) || 12) : 0
    const mr = mk ? (tm ? tm[2] : Math.min(mw, mh) / 2) : 0
    const tx = s.querySelector('.apexcharts-legend-text')
    const f = tx ? { size: num(tx.style.fontSize, 14) || 14, weight: tx.style.fontWeight || 400 } : { size: 12, weight: 400 }
    const text = tx ? tx.textContent : ''
    const tw = measure(text, f.size, f.weight)
    const gap = mk ? (themed ? 6 : 1) : 0 // marker margin-right (text's -15px margin / 15px padding cancel out)
    const h = Math.max(mh, metrics(f.size).lineHeight) // line-height: normal
    out.push({ el: s, mk, tx, text, f, mw, mh, mr, tw, gap, mx, my, w: mx * 2 + mw + gap + tw, h: my * 2 + h, ih: h })
  }
  const PAD = 10
  const rows = []
  if (pos === 'left' || pos === 'right') {
    for (const it of out) rows.push({ items: [it], w: it.w, h: it.h })
  } else {
    let row = { items: [], w: 0, h: 0 }
    for (const it of out) {
      if (row.items.length && row.w + it.w > maxWidth - 2 * PAD) {
        rows.push(row)
        row = { items: [], w: 0, h: 0 }
      }
      row.items.push(it)
      row.w += it.w
      row.h = Math.max(row.h, it.h)
    }
    if (row.items.length) rows.push(row)
  }
  const width = (pos === 'left' || pos === 'right' ? Math.max(0, ...rows.map((r) => r.w)) : maxWidth - 0) + (pos === 'left' || pos === 'right' ? 2 * PAD : 0)
  const height = rows.reduce((s, r) => s + r.h, 0)
  return { pos, rows, width: out.length ? width : 0, height: out.length ? height : 0, pad: PAD }
}

// Text-measurement-only 2D context. Premium layouts size labels with canvas measureText (they skip it when the
// UA says jsdom, so render.js gives the window a neutral headless UA). Browsers measure canvas text WITHOUT
// the theme's tabular-nums, so this measures proportional figures. Only anonymous, detached canvases get it:
// a canvas the library means to draw on (it has a class, e.g. the network edge layer) gets null, exactly as
// before, so drawing code keeps its SVG path. No ImageData either, so the canvas renderer stays off.
function parseCanvasFont(font) {
  const m = /^\s*(?:(italic|oblique|normal)\s+)?(?:(normal|small-caps)\s+)?(?:(normal|bold|bolder|lighter|\d{3})\s+)?([\d.]+)px/i.exec(font || '')
  if (!m) return { size: 10, weight: 400, style: 'normal' }
  return { size: +m[4], weight: m[3] || 400, style: m[1] || 'normal' }
}
function installCanvasMeasure(window) {
  const C = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype
  if (!C) return
  C.getContext = function (type) {
    if (String(type).toLowerCase() !== '2d' || this.className || this.isConnected) return null
    const canvas = this
    let font = '10px sans-serif'
    return {
      canvas,
      get font() {
        return font
      },
      set font(v) {
        font = String(v)
      },
      measureText(text) {
        const set = (active = setOf(canvas))
        const f = parseCanvasFont(font)
        const width = set.measure(String(text == null ? '' : text), f.size, f.weight, f.style, 'proportional')
        const mt = set.metrics(f.size)
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: mt.ascent, actualBoundingBoxDescent: mt.descent, fontBoundingBoxAscent: mt.ascent, fontBoundingBoxDescent: mt.descent }
      },
    }
  }
}

function install(window, size, fontSet) {
  window.__wccFontSet = fontSet || fonts.fontSet(fonts.DEFAULT_SET)
  const use = (el) => (active = setOf(el))
  installCanvasMeasure(window)
  const proto = window.SVGElement.prototype
  proto.getBBox = function () {
    use(this)
    return bbox(this)
  }
  proto.getComputedTextLength = function () {
    use(this)
    const f = fontOf(this)
    return measure(textOf(this), f.size, f.weight, f.style)
  }
  proto.getSubStringLength = function (start, count) {
    use(this)
    const f = fontOf(this)
    return measure(textOf(this).substr(start, count), f.size, f.weight, f.style)
  }
  proto.getNumberOfChars = function () {
    return textOf(this).length
  }
  proto.getTotalLength = function () {
    const b = bbox(this)
    return b.width + b.height
  }
  proto.getPointAtLength = function () {
    return { x: 0, y: 0 }
  }
  proto.getCTM = function () {
    return matrixObj(ctm(this))
  }
  proto.getScreenCTM = proto.getCTM
  proto.getBoundingClientRect = function () {
    use(this)
    return rect(applyBox(ctm(this), bbox(this)) || EMPTY())
  }
  if (window.SVGSVGElement) {
    window.SVGSVGElement.prototype.createSVGPoint = function () {
      return { x: 0, y: 0, matrixTransform(m) { return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f } } }
    }
    window.SVGSVGElement.prototype.createSVGMatrix = function () {
      return matrixObj([1, 0, 0, 1, 0, 0])
    }
  }

  const H = window.HTMLElement.prototype
  const htmlBox = (el) => {
    if (el.classList && el.classList.contains('apexcharts-legend')) {
      const svgW = num((el.parentNode && el.parentNode.style.width) || size.width, size.width)
      const L = legendLayout(el, svgW)
      let h = L.height
      const mh = num(el.style.maxHeight, 0)
      if (mh && h > mh) h = mh
      const r = parseFloat(el.style.right)
      const x = !Number.isFinite(parseFloat(el.style.left)) && Number.isFinite(r) ? svgW - r - L.width : num(el.style.left)
      return { x, y: num(el.style.top), width: L.width, height: h }
    }
    let w = num(el.style && el.style.width, NaN)
    let h = num(el.style && el.style.height, NaN)
    if (!Number.isFinite(w)) {
      // block element: as wide as its parent (the container is sized by the renderer)
      let p = el.parentNode
      while (p && p.nodeType === 1 && !Number.isFinite(w)) {
        w = num(p.style && p.style.width, NaN)
        p = p.parentNode
      }
      if (!Number.isFinite(w)) w = size.width
    }
    if (!Number.isFinite(h)) h = 0
    return { x: 0, y: 0, width: w, height: h }
  }
  H.getBoundingClientRect = function () {
    use(this)
    return rect(htmlBox(this))
  }
  for (const [k, dim] of [
    ['clientWidth', 'width'],
    ['clientHeight', 'height'],
    ['offsetWidth', 'width'],
    ['offsetHeight', 'height'],
    ['scrollWidth', 'width'],
    ['scrollHeight', 'height'],
  ]) {
    Object.defineProperty(H, k, {
      configurable: true,
      get() {
        use(this)
        return htmlBox(this)[dim]
      },
    })
  }
}

module.exports = { install, bbox, pathBox, legendLayout, parseTransform, fontOf }
