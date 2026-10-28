'use strict'
// Frozen font sets, used for BOTH text measurement (headless layout) and PNG rasterisation (resvg).
//   inter-4.1             (default) Inter 4.1 with tabular figures baked in (the theme sets
//                         font-variant-numeric: tabular-nums on all chart text), SIL OFL 1.1
//   liberation-sans-2.1.5 (fallback) metric-compatible with Arial/Helvetica, SIL OFL 1.1
// In the Inter set, glyphs Inter lacks are measured with Liberation Sans, which is also the
// second family in the SVG font stack, so resvg/browsers fall back the same way.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const opentype = require('opentype.js')
const { gposKerning } = require('./kerning')

const DIR = path.join(__dirname, '..', 'fonts')
const FILES = {
  'liberation-sans-2.1.5': {
    family: 'Liberation Sans',
    faces: {
      regular: ['LiberationSans-Regular.ttf', 'bade59d822652f76e6941aa87b40a87c13d1cc70db98ededb5011127efafd1d3'],
      bold: ['LiberationSans-Bold.ttf', '1b5f2da6f4cadce4c05b9ecebe3a6fcd374eb95ae443605e799f4c3287978939'],
      italic: ['LiberationSans-Italic.ttf', '93ff5260834141b6f9d8f2b846d427f3a5dc492dbdce8ebdad406e38a38f34bb'],
      boldItalic: ['LiberationSans-BoldItalic.ttf', '352e9dc2be89f210dbd3c0fd5dfaf97135de70e0beb5f22378601861462493a7'],
    },
  },
  'inter-4.1': {
    family: 'Inter', // name in the SVG (what browsers and the theme use)
    rasterFamily: 'WCC Inter Tabular', // the same faces with 'tnum' baked in (scripts/build-tabular-fonts.py), for resvg
    shaping: false,
    fallback: 'liberation-sans-2.1.5',
    // codepoint -> original (proportional) glyph id per face, for canvas-style measurement (no CSS tnum)
    proportional: ['WCCInterTabular.proportional.json', '83df324309ececc1bd399c87e4eca8ba7c127e9c5483cd289d83ee38065e2d17'],
    faces: {
      regular: ['WCCInterTabular-Regular.ttf', '55def8b2c5af5c9185be1680bd384e07a4e89a9a558050ab2b7afdc691dff68c'],
      medium: ['WCCInterTabular-Medium.ttf', '7215eb8039743254ecb92439794bea02fca7df16cd04d021f711c32de244dd8f'],
      semibold: ['WCCInterTabular-SemiBold.ttf', '03680970e2761c3199a969aa8ed3f0e4b6ca7f1975f4078b8ffdc173efc2cdca'],
      bold: ['WCCInterTabular-Bold.ttf', 'd985f6112f95d5ef48c0f75ef2053a70d809e7660c307dc8fd1461ca0d93ee01'],
      italic: ['WCCInterTabular-Italic.ttf', '994940bbbb0b6bf4ae23c572f885addc88715d376f04e1d1002377954af4a731'],
      boldItalic: ['WCCInterTabular-BoldItalic.ttf', '1f0e5c49300e11049c0ad87948292a2fd3b35657ef20d9e56e58ca96f1b4ab84'],
    },
  },
}
const DEFAULT_SET = 'inter-4.1'
const ALIASES = { inter: 'inter-4.1', liberation: 'liberation-sans-2.1.5', 'liberation-sans': 'liberation-sans-2.1.5' }
const FONT_SETS = Object.keys(FILES)

const loaded = {}
function load(id) {
  if (loaded[id]) return loaded[id]
  const out = {}
  const frozen = (f, sha) => {
    const b = fs.readFileSync(path.join(DIR, f))
    if (crypto.createHash('sha256').update(b).digest('hex') !== sha) throw new Error(`font ${f} does not match the frozen font set ${id}`)
    return b
  }
  const pj = FILES[id].proportional ? JSON.parse(frozen(...FILES[id].proportional).toString('utf8')) : null
  for (const [k, [f, sha]] of Object.entries(FILES[id].faces)) {
    const b = frozen(f, sha)
    out[k] = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
    out[k].__kern = gposKerning(b)
    const style = /-([A-Za-z]+)\.ttf$/.exec(f)[1]
    out[k].__prop = pj && pj[style] ? pj[style] : null
  }
  return (loaded[id] = out)
}

// advance width without GSUB shaping (opentype.js cannot run Inter's GSUB lookups): cmap glyphs + GPOS/kern pairs,
// which is what browsers do for Latin text without contextual alternates
// proportional: use the face's original (non-tabular) forms, as canvas measureText does (CSS tnum does not apply)
function advance(font, text, size, proportional) {
  const scale = size / font.unitsPerEm
  const pm = proportional && font.__prop
  let w = 0
  let prev = null
  for (const ch of text) {
    const pg = pm ? pm[ch.codePointAt(0)] : undefined
    const g = pg != null ? font.glyphs.get(pg) : font.charToGlyph(ch)
    if (prev) w += font.__kern(prev.index, g.index)
    w += g.advanceWidth || 0
    prev = g
  }
  return w * scale
}

function weightOf(w) {
  if (w === 'bold' || w === 'bolder') return 700
  if (w === 'normal' || w === 'lighter' || w == null || w === '') return 400
  return +w || 400
}

function pickFace(f, weight, style) {
  const w = weightOf(weight)
  const it = style === 'italic' || style === 'oblique'
  if (it) return w >= 600 ? f.boldItalic : f.italic
  if (w >= 700 || (w >= 600 && !f.semibold)) return f.bold
  if (w >= 600) return f.semibold
  if (w >= 500 && f.medium) return f.medium
  return f.regular
}

const sets = {}
/** the frozen font set `name` (id or alias): { id, family, stack, measure(), metrics(), files } */
function fontSet(name) {
  const id = ALIASES[name] || name || DEFAULT_SET
  if (!FILES[id]) return null
  if (sets[id]) return sets[id]
  const def = FILES[id]
  const adv = def.shaping === false ? (face, t, size, p) => advance(face, t, size, p) : (face, t, size) => face.getAdvanceWidth(t, size)
  const fb = def.fallback ? fontSet(def.fallback) : null
  const cache = new Map()
  const families = [def.family].concat(fb ? [fb.family] : [])
  const set = {
    id,
    family: def.family,
    rasterFamily: def.rasterFamily || def.family,
    stack: families.map((f) => `'${f}'`).join(', ') + ', Arial, Helvetica, sans-serif',
    // numeric: 'tabular' (SVG/HTML chart text: the theme sets font-variant-numeric: tabular-nums) or
    // 'proportional' (canvas measureText, which CSS does not reach)
    measure(text, size = 12, weight = 400, style = 'normal', numeric = 'tabular') {
      text = String(text == null ? '' : text)
      if (!text) return 0
      const prop = numeric === 'proportional'
      const key = text + '\u0000' + size + '\u0000' + weight + '\u0000' + style + (prop ? '\u0000p' : '')
      let v = cache.get(key)
      if (v === undefined) {
        const face = pickFace(load(id), weight, style)
        if (!fb) v = adv(face, text, size, prop)
        else {
          // per-run fallback: characters the primary face lacks are measured with the fallback set
          v = 0
          let run = ''
          let runFb = null
          const flush = () => {
            if (run) v += runFb ? fb.measure(run, size, weight, style, numeric) : adv(face, run, size, prop)
            run = ''
          }
          for (const ch of text) {
            const missing = face.charToGlyphIndex(ch) === 0 && !/\s/.test(ch)
            if (run && missing !== runFb) flush()
            runFb = missing
            run += ch
          }
          flush()
        }
        v = Math.round(v * 1000) / 1000
        if (cache.size > 50000) cache.clear()
        cache.set(key, v)
      }
      return v
    },
    // Chromium (Skia) rounds hhea ascent/descent/lineGap to whole pixels per font size; SVG text boxes are
    // ascent+descent tall and CSS line-height:normal is the sum of all three
    metrics(size = 12) {
      const f = load(id).regular
      const hh = f.tables.hhea
      const k = size / f.unitsPerEm
      const ascent = Math.round(hh.ascender * k)
      const descent = Math.round(-hh.descender * k)
      const lineGap = Math.round((hh.lineGap || 0) * k)
      return { ascent, descent, lineGap, lineHeight: ascent + descent + lineGap }
    },
    files: () => Object.values(def.faces).map(([f]) => path.join(DIR, f)).concat(fb ? fb.files() : []),
  }
  return (sets[id] = set)
}

const dflt = fontSet(DEFAULT_SET)
module.exports = {
  DEFAULT_SET,
  FONT_SETS,
  ALIASES,
  fontSet,
  // back-compat: default set
  FONT_SET: dflt.id,
  FAMILY: dflt.family,
  measure: (...a) => dflt.measure(...a),
  metrics: (...a) => dflt.metrics(...a),
  fontFiles: () => dflt.files(),
  load: () => load(DEFAULT_SET),
}
