---
name: wcc-charts
description: Render, validate and read West Coast Charts specs headlessly with the `wcc` CLI (SVG/PNG plus a data table). Use when you need a chart image or want to check a chart spec without a browser.
---

# West Coast Charts from the command line (`wcc`)

`wcc` renders a chart spec (plain JSON chart options) to SVG or PNG without a browser. It also validates specs and returns what a chart shows as data.

## Ground rules
- stdout carries only the result (artifact or JSON). Logs and warnings go to stderr.
- When piped, output is JSON. On failure the **last stderr line** is `{"error":{"kind","message","hint","details","exit_code","retryable"}}`. Do what `hint` says: it is the corrected command, key or file.
- Exit codes: 0 ok · 1 internal · 2 usage/schema · 3 not_found · 4 license · 5 conflict · 6 confirmation_required. Source of truth: `wcc errors`.
- `wcc schema` describes every command, argument and output shape (clispec v0.3). `wcc schema chart render` narrows it to one command.
- Output is deterministic: the same spec, `--seed` and version give byte-identical SVG.
- wcc never prompts without a TTY. A missing `--yes` or `--force` makes it fail with exit 6 or 5.

## Workflow
1. Start from an example: `wcc examples list`, then `wcc examples get line-basic --spec-only > chart.json`.
2. Look up options when unsure: `wcc options schema plotOptions.bar --depth 2`.
3. Validate: `wcc chart validate chart.json`. Apply each issue's `fix` (`rename` / `set` / `remove`) and run it again.
4. Render: `wcc chart render chart.json > chart.svg`, or `wcc chart export chart.json --out chart.png`.
5. Check what the chart says without looking at it: `wcc chart table chart.json`. This returns a text summary and the data table.

## Spec cheatsheet
- Axis charts: `{"chart":{"type":"line|area|bar|scatter|heatmap|..."},"series":[{"name":"A","data":[1,2,3]}],"xaxis":{"categories":["x","y","z"]}}`
- Pie, donut and gauge: `"series":[44,25,15]` with `"labels":[...]`.
- Size comes from `chart.width`/`chart.height` or `--width/--height`. The default is 800x450.
- Specs are JSON only, so they cannot contain functions or formatters.
- Swap the data without editing the spec with `--data series.json`.

## Premium types
sankey, chord, gantt, tree, stock, map, marimekko, network and radialColumn need a licence key. The same goes for the layers radialColumn wave/matrix and network facet.
- Set `WCC_LICENSE_KEY` in the environment, or pass `--license-key-file <file>`. Do not put keys on the command line.
- Without a key the command exits 4, and the hint says where to get one. `--evaluation` renders a watermarked preview instead.
- `wcc types list` shows the tier of every type.
