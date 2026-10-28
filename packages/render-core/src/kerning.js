'use strict'
// Minimal GPOS pair-kerning reader (feature 'kern', PairPos formats 1+2, Extension lookups),
// because opentype.js 2.0 skips GPOS Extension lookups (type 9), where Inter keeps most of its kerning.
// Browsers apply 'kern' by default, so layout widths must include it. Pure function of the font bytes.

function reader(buf) {
  return {
    u16: (o) => buf.readUInt16BE(o),
    i16: (o) => buf.readInt16BE(o),
    u32: (o) => buf.readUInt32BE(o),
    tag: (o) => buf.toString('latin1', o, o + 4),
  }
}

function tableOffset(buf, tag) {
  const r = reader(buf)
  const n = r.u16(4)
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16
    if (r.tag(rec) === tag) return r.u32(rec + 8)
  }
  return -1
}

function coverage(r, off) {
  const fmt = r.u16(off)
  const map = new Map()
  if (fmt === 1) {
    const n = r.u16(off + 2)
    for (let i = 0; i < n; i++) map.set(r.u16(off + 4 + i * 2), i)
  } else {
    const n = r.u16(off + 2)
    for (let i = 0; i < n; i++) {
      const o = off + 4 + i * 6
      const s = r.u16(o), e = r.u16(o + 2), idx = r.u16(o + 4)
      for (let g = s; g <= e; g++) map.set(g, idx + g - s)
    }
  }
  return map
}

function classDef(r, off) {
  const map = new Map()
  const fmt = r.u16(off)
  if (fmt === 1) {
    const start = r.u16(off + 2), n = r.u16(off + 4)
    for (let i = 0; i < n; i++) map.set(start + i, r.u16(off + 6 + i * 2))
  } else {
    const n = r.u16(off + 2)
    for (let i = 0; i < n; i++) {
      const o = off + 4 + i * 6
      const s = r.u16(o), e = r.u16(o + 2), c = r.u16(o + 4)
      for (let g = s; g <= e; g++) map.set(g, c)
    }
  }
  return map
}

const popcount = (v) => { let c = 0; while (v) { c += v & 1; v >>= 1 } return c }
// byte offset of XAdvance inside a ValueRecord, or -1
const xAdvAt = (fmt) => (fmt & 4 ? popcount(fmt & 3) * 2 : -1)

function pairSubtable(r, off) {
  const fmt = r.u16(off)
  const cov = coverage(r, off + r.u16(off + 2))
  const vf1 = r.u16(off + 4), vf2 = r.u16(off + 6)
  const s1 = popcount(vf1) * 2, s2 = popcount(vf2) * 2
  const xa = xAdvAt(vf1)
  if (fmt === 1) {
    const sets = new Map()
    const nSets = r.u16(off + 8)
    return (a, b) => {
      const ci = cov.get(a)
      if (ci === undefined || ci >= nSets) return null
      let set = sets.get(ci)
      if (!set) {
        set = new Map()
        const so = off + r.u16(off + 10 + ci * 2)
        const n = r.u16(so)
        for (let i = 0; i < n; i++) {
          const o = so + 2 + i * (2 + s1 + s2)
          set.set(r.u16(o), xa < 0 ? 0 : r.i16(o + 2 + xa))
        }
        sets.set(ci, set)
      }
      return set.has(b) ? set.get(b) : null
    }
  }
  if (fmt === 2) {
    const cd1 = classDef(r, off + r.u16(off + 8)), cd2 = classDef(r, off + r.u16(off + 10))
    const c1n = r.u16(off + 12), c2n = r.u16(off + 14)
    return (a, b) => {
      if (!cov.has(a)) return null
      const c1 = cd1.get(a) || 0, c2 = cd2.get(b) || 0
      if (c1 >= c1n || c2 >= c2n) return null
      const o = off + 16 + (c1 * c2n + c2) * (s1 + s2)
      return xa < 0 ? 0 : r.i16(o + xa)
    }
  }
  return () => null
}

/** buf: font file bytes -> (leftGlyphIndex, rightGlyphIndex) => kerning in font units */
function gposKerning(buf, script = 'latn') {
  const base = tableOffset(buf, 'GPOS')
  if (base < 0) return () => 0
  const r = reader(buf)
  const sl = base + r.u16(base + 4), fl = base + r.u16(base + 6), ll = base + r.u16(base + 8)
  let langSys = -1
  const nScripts = r.u16(sl)
  for (const want of [script, 'DFLT']) {
    for (let i = 0; i < nScripts && langSys < 0; i++) {
      if (r.tag(sl + 2 + i * 6) !== want) continue
      const so = sl + r.u16(sl + 2 + i * 6 + 4)
      const d = r.u16(so)
      if (d) langSys = so + d
    }
    if (langSys >= 0) break
  }
  if (langSys < 0) return () => 0
  const lookups = new Set()
  const nf = r.u16(langSys + 4)
  for (let i = 0; i < nf; i++) {
    const fi = r.u16(langSys + 6 + i * 2)
    const rec = fl + 2 + fi * 6
    if (r.tag(rec) !== 'kern') continue
    const fo = fl + r.u16(rec + 4)
    const n = r.u16(fo + 2)
    for (let j = 0; j < n; j++) lookups.add(r.u16(fo + 4 + j * 2))
  }
  const fns = []
  for (const li of [...lookups].sort((a, b) => a - b)) {
    const lo = ll + r.u16(ll + 2 + li * 2)
    let type = r.u16(lo)
    const n = r.u16(lo + 4)
    const subs = []
    for (let j = 0; j < n; j++) {
      let so = lo + r.u16(lo + 6 + j * 2)
      let t = type
      if (t === 9) {
        t = r.u16(so + 2)
        so = so + r.u32(so + 4)
      }
      if (t === 2) subs.push(pairSubtable(r, so))
    }
    if (subs.length) fns.push(subs)
  }
  return (a, b) => {
    let k = 0
    for (const subs of fns) {
      for (const f of subs) {
        const v = f(a, b)
        if (v !== null) {
          k += v
          break
        }
      }
    }
    return k
  }
}

module.exports = { gposKerning }
