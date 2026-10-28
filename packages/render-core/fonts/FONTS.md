# Frozen font sets

The bundled fonts are used for BOTH text measurement (layout in the headless DOM) and PNG rasterisation (resvg, `loadSystemFonts: false`). That keeps layout and pixels in agreement and independent of the machine. If you change any file here, the golden output changes: bump the set id in `src/fonts.js` and re-record the goldens (`UPDATE_GOLDEN=1`).

## `inter-4.1` (default)
Inter is the first family in the WCC theme presets. The SVG font stack is `'Inter', 'Liberation Sans', Arial, Helvetica, sans-serif`. Any glyph Inter lacks is measured with Liberation Sans, the next family in the stack, so resvg and browsers fall back the same way.

**Tabular figures.** The theme CSS sets `font-variant-numeric: tabular-nums` on every chart `<text>` and on the legend text, so browsers draw Inter's tabular digits and punctuation. resvg applies no OpenType features, and opentype.js cannot run Inter's GSUB. So the runtime faces are derived from the pristine release files by `scripts/build-tabular-fonts.py` (fontTools): the 122 `tnum` single substitutions are baked into the cmap, the family is renamed to **WCC Inter Tabular**, and the head timestamps are fixed so the output is byte-reproducible. Under the OFL these are a *Modified Version*; Inter declares no Reserved Font Name, but they are renamed anyway. The SVG keeps `font-family: 'Inter'` plus `style="font-variant-numeric:tabular-nums"` (correct in any browser); only the PNG path maps `'Inter'` to `'WCC Inter Tabular'` inside resvg.

**Canvas measurement.** Premium layouts size some labels with canvas `measureText`, which CSS does not reach, so browsers measure *proportional* figures there. `WCCInterTabular.proportional.json` keeps the original cmap entries (codepoint → glyph id, per face; every glyph is retained in the derived faces), and the render core's measurement-only canvas context uses them.

Text widths come from the cmap advances plus GPOS `kern` pair kerning. `src/kerning.js` reads that kerning itself, because opentype.js 2.0 can run neither Inter's GSUB lookups nor its GPOS Extension lookups. The widths match Chromium to within about 0.02 px. Vertical metrics follow Chromium: hhea ascent/descent/lineGap rounded to whole pixels per size (SVG text box = ascent + descent; CSS `line-height: normal` = all three). Contextual alternates (`calt`) are not applied; browsers apply them only to rare sequences such as arrows and case-sensitive forms.

Runtime files (pinned in `src/fonts.js`):

| file | sha256 |
|---|---|
| WCCInterTabular-Regular.ttf | 55def8b2c5af5c9185be1680bd384e07a4e89a9a558050ab2b7afdc691dff68c |
| WCCInterTabular-Medium.ttf | 7215eb8039743254ecb92439794bea02fca7df16cd04d021f711c32de244dd8f |
| WCCInterTabular-SemiBold.ttf | 03680970e2761c3199a969aa8ed3f0e4b6ca7f1975f4078b8ffdc173efc2cdca |
| WCCInterTabular-Bold.ttf | d985f6112f95d5ef48c0f75ef2053a70d809e7660c307dc8fd1461ca0d93ee01 |
| WCCInterTabular-Italic.ttf | 994940bbbb0b6bf4ae23c572f885addc88715d376f04e1d1002377954af4a731 |
| WCCInterTabular-BoldItalic.ttf | 1f0e5c49300e11049c0ad87948292a2fd3b35657ef20d9e56e58ca96f1b4ab84 |
| WCCInterTabular.proportional.json | 83df324309ececc1bd399c87e4eca8ba7c127e9c5483cd289d83ee38065e2d17 |

Sources (`fonts/src/`, in the repo for provenance and rebuilds; not in the package `files`):

| file | sha256 |
|---|---|
| Inter-Regular.ttf | 40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82 |
| Inter-Medium.ttf | 97ad806f526e41546d46365bb3a393145f75b7b1568913db74549ad8b8dba872 |
| Inter-SemiBold.ttf | 78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3 |
| Inter-Bold.ttf | 288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f |
| Inter-Italic.ttf | bbc051dd204b5019a1aa0bc0ae2aa8a05ab13e7a3f979fa357631dc7feb6833a |
| Inter-BoldItalic.ttf | 948405a16cdc62701da5f4005ed068ca5f4d27061d98f7974ccfc37831d9581d |

- **Source:** the official Inter 4.1 release, https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip (`extras/ttf/`).
- **Rebuild:** `python3 scripts/build-tabular-fonts.py` (fontTools 4.65; prints the sha256s above).
- **Weight mapping:** ≤ 400 → Regular, 500 → Medium, 600 → SemiBold, ≥ 700 or `bold` → Bold.
- **Licence:** SIL OFL 1.1 (`LICENSE-Inter.txt`, copied verbatim from the release; it covers the derived faces too).

## `liberation-sans-2.1.5` (fallback, `--font-set liberation`)
Liberation Sans is metric-compatible with Arial and Helvetica.

| file | sha256 |
|---|---|
| LiberationSans-Regular.ttf | bade59d822652f76e6941aa87b40a87c13d1cc70db98ededb5011127efafd1d3 |
| LiberationSans-Bold.ttf | 1b5f2da6f4cadce4c05b9ecebe3a6fcd374eb95ae443605e799f4c3287978939 |
| LiberationSans-Italic.ttf | 93ff5260834141b6f9d8f2b846d427f3a5dc492dbdce8ebdad406e38a38f34bb |
| LiberationSans-BoldItalic.ttf | 352e9dc2be89f210dbd3c0fd5dfaf97135de70e0beb5f22378601861462493a7 |

- **Source:** Debian fonts-liberation 1:2.1.5-3.
- **Licence:** SIL OFL 1.1 (`LICENSE-Liberation.txt`).

The OFL allows bundling and redistributing the fonts with software, provided the licence text travels with them. It does: both licence files are in this directory and in `package.json` `files`.
