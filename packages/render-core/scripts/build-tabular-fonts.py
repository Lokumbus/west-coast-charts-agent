#!/usr/bin/env python3
"""
Derive the runtime faces of the `inter-4.1` font set from the pristine Inter 4.1 release files in fonts/src/.

The WCC theme CSS sets `font-variant-numeric: tabular-nums` on every chart <text> and on the legend text, so
browsers draw Inter's tabular forms (digits, () [] {} - , . : ; < > = + − × ÷ ...). resvg cannot apply OpenType
features, and opentype.js cannot run Inter's GSUB. So this script bakes the 'tnum' single substitutions into the
cmap. Layout measurement (opentype.js) and PNG rasterisation (resvg) then see exactly the glyphs Chromium shows.

The result is an OFL "Modified Version". Inter declares no Reserved Font Name, but the family is renamed
anyway ("WCC Inter Tabular"), so it is never confused with Inter. The render core maps 'Inter' to it only
inside resvg; the SVG artifact keeps font-family 'Inter' and the CSS `font-variant-numeric: tabular-nums`.

Canvas text (premium layouts measure with CanvasRenderingContext2D.measureText) is NOT affected by the CSS, so
browsers measure proportional figures there. The original cmap entries that were swapped are written to
WCCInterTabular.proportional.json (codepoint -> original glyph id, per face) so the render core can measure
those proportional forms from the same faces (all glyphs are retained).

Deterministic: fixed head.modified/created timestamps, no other changes.
    python3 scripts/build-tabular-fonts.py   (needs fontTools; output sha256s go into src/fonts.js and FONTS.md)
"""
import hashlib, json, os
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'fonts', 'src')
OUT = os.path.join(HERE, '..', 'fonts')
FAMILY = 'WCC Inter Tabular'
STYLES = {'Regular': 'Regular', 'Medium': 'Medium', 'SemiBold': 'SemiBold', 'Bold': 'Bold', 'Italic': 'Italic', 'BoldItalic': 'Bold Italic'}
EPOCH = 0x7C259DC0  # fixed timestamp (seconds since 1904) for reproducible bytes


def tnum_map(font):
    gsub = font['GSUB'].table
    m = {}
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag != 'tnum':
            continue
        for li in fr.Feature.LookupListIndex:
            lk = gsub.LookupList.Lookup[li]
            for st in lk.SubTable:
                t = lk.LookupType
                if t == 7:
                    t, st = st.ExtensionLookupType, st.ExtSubTable
                if t == 1:
                    m.update(st.mapping)
        break
    return m


prop = {}
for style, sub in STYLES.items():
    src = os.path.join(SRC, f'Inter-{style}.ttf')
    f = TTFont(src, recalcTimestamp=False)
    m = tnum_map(f)
    n = 0
    order = {g: i for i, g in enumerate(f.getGlyphOrder())}
    prop[style] = {str(cp): order[g] for cp, g in sorted(f.getBestCmap().items()) if g in m}
    for table in f['cmap'].tables:
        for cp, g in list(table.cmap.items()):
            if g in m:
                table.cmap[cp] = m[g]
                n += 1
    name = f['name']
    full = f'{FAMILY} {sub}'.replace(' Regular', '')
    ps = f'WCCInterTabular-{style}'
    for rec in list(name.names):
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID == 4:
            rec.string = full
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID == 3:
            rec.string = f'{ps};derived-from-Inter-4.1;tnum-baked'
        elif rec.nameID in (17,):
            rec.string = sub
    f['head'].created = EPOCH
    f['head'].modified = EPOCH
    out = os.path.join(OUT, f'{ps}.ttf')
    f.save(out)
    print(f'{ps}.ttf', hashlib.sha256(open(out, 'rb').read()).hexdigest(), f'({n} cmap entries -> tabular forms)')

pj = os.path.join(OUT, 'WCCInterTabular.proportional.json')
with open(pj, 'w') as fh:
    json.dump(prop, fh, sort_keys=True, separators=(',', ':'))
    fh.write('\n')
print('WCCInterTabular.proportional.json', hashlib.sha256(open(pj, 'rb').read()).hexdigest())
