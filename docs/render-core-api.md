# @wcc-agent/render-core: API contract (v0.2, implemented)

Consumers are `packages/cli` (`wcc`) and `packages/mcp`. The public wrapper exports this API as `west-coast-charts-agent/render-core`.

- Public API: `west-coast-charts-agent/render-core`, CommonJS, Node >= 20; source workspace `@wcc-agent/render-core` remains private.
- Library: the released West Coast Charts 1.1.1-rc.7 distribution, resolved from explicit `WCC_LIB_ROOT` or the installed `west-coast-charts/package.json`. No developer-worktree fallback is used.
- Real validator: `dist/agent/validate.common.js`; options: `dist/schema/wcc-options.schema.json`; description: `dist/agent/describe.min.js`. All must come from that same installation. Missing components fail explicitly.
- `chart.describe()` is loaded only from that library's matching module; no `WCC_DESCRIBE_FILE` override or table fallback is used.

```js
const core = require('west-coast-charts-agent/render-core')
```

## Spec (input)

A spec is a plain WCC options object, which is exactly what `new WestCoastCharts(el, options)` takes.

- It is JSON only. Functions such as formatters are not supported.
- `chart.type` is required.
- The optional `opts.data` (an array) replaces `spec.series`.
- Validation runs on the user's spec, before the renderer injects `chart.deterministic`, `seed`, size and so on.

## Functions

All async functions reject only with `WccError`. Nothing is printed; diagnostics go to `meta.warnings`.

### `render(spec, opts?) -> Promise<RenderResult>`

| opt | default | meaning |
|---|---|---|
| format | `'svg'` | `'svg'` or `'png'` |
| width / height | `chart.width`/`height`, else 800x450 | px, max 8000 |
| seed | 1 | sets `chart.seed` (E2) and the seeded `Math.random` (mulberry32) |
| scale | 1 | PNG pixel ratio, 0.25 to 4 |
| background | PNG `#ffffff`, SVG none | |
| theme | – | `'light'` or `'dark'`, sets `theme.mode` |
| validate | `'strict'` | `'strict'` rejects with `schema`; `'warn'` puts the issues into `meta.warnings`; `'off'` skips validation |
| licenseKey | – | explicit key (CLI: `--license-key-file`). Precedence: `licenseKey` > `spec.chart.licenseKey` > `envLicenseKey`; the first present wins, no fallthrough. `resolveLicenseKey(spec, opts) -> {key, source: 'option'\|'spec'\|'env'\|null}` is exported. |
| envLicenseKey | `process.env.WCC_LICENSE_KEY` | pass `''` to ignore the env |
| fontSet | `'inter-4.1'` | `'inter-4.1'` or `'liberation-sans-2.1.5'` (aliases `inter`, `liberation`); unknown → `usage` |
| evaluation | false | opt-in. Renders premium charts without a key, with the library's "unlicensed" watermark; `meta.licensed` is false. CLI `--evaluation`, MCP `evaluation` config / `WCC_EVALUATION=1` / `--evaluation`. Without it a premium type and no key is the `license` error (exit 4). |
| table | true | also extract the table |

```ts
RenderResult = {
  format: 'svg'|'png', svg?: string, png?: Buffer,
  table: Describe | null,
  meta: { type, premium, licensed, licenseKeySource: 'option'|'spec'|'env'|null,
          width, height, seed, libVersion, renderCoreVersion,
          fontSet: 'inter-4.1'|'liberation-sans-2.1.5',
          tableSource: 'describe'|null,          // actual chart.describe(), never a placeholder
          ms, warnings: Issue[] }
}
```

Determinism: the same spec, opts, lib build, fonts and `TZ=UTC` give a byte-identical `svg`, `png` and `table`. `meta.ms` is excluded. Animations are off, ids are seeded, and the font metrics are frozen. The CLI forces `TZ=UTC`, and MCP should do the same.

### `table(spec, opts?) -> Promise<Describe>`

This renders the chart without serialising it and returns E2's `wcc-describe/1`, schema-valid, with no extra keys. With `opts.withMeta: true` it returns `{table, meta}` instead; `meta` is the render meta without `format`, and `meta.tableSource` says where the table came from:

- `'describe'` is the full E2 model: `series`, `marks`, `scales`, `aggregate` and so on.

Until v0.2 the source was a top-level `source` key inside the table; that made the object fail the schema (`additionalProperties: false`). Consumers (MCP) still accept that shape and move the key out.

**Breaking change from v0.1:** the rows are now at `table.table.rows`, no longer `table.rows`. The cells are strings, as E2 specifies.

### `validate(spec, opts?) -> Promise<{ok, errors, warnings, issues, validator: 'e1'}>`

The Issue shape is E1's:

```
{ kind: 'unknown_option'|'type_mismatch'|'invalid_value'|'deprecated'|'license_required',
  severity: 'error'|'warning', path, pointer, message, hint, suggestion, alternatives, fix: {op:'rename'|'set'|'remove',...}|null, exitCode }
```

`license_required` issues are dropped here because licensing is decided by `render` with the key.

### Other functions

- `getSchema(path?, {depth?}) -> JSON Schema`: the full schema, or the subtree at a dotted path with the `$defs` it references. An unknown key raises `not_found`, with the hint `wcc options schema <fixed.path>`.
- `listTypes() -> {type, tier: 'core'|'types'|'premium'|'premium-layer', premium, module?, option?}[]`
- `listExamples({type?, tag?, premium?}) -> {id, type, title, description, tags, premium}[]`
- `getExample(id) -> {..., spec}`. An unknown id raises `not_found`, with the hint `wcc examples get <closest>`.
- `errorCatalog() -> {kind, exit_code, retryable, description}[]`
- `version -> {renderCore, lib, fontSet, validator}`
- Also exported: `WccError`, `isWccError`, `toWccError`, `closest`, `LICENSE_URL`.

## Errors

```ts
class WccError extends Error { kind; exitCode; message; hint: string|null; details: object|null
  toJSON(): { error: { kind, message, hint?, details?, exit_code } } }
```

| exit | kind | when |
|---|---|---|
| 0 | – | ok |
| 1 | internal | bug or renderer crash. The hint says to report it. |
| 2 | usage | bad command line. The hint is the corrected command. |
| 2 | schema | invalid JSON, or the spec fails validation. `details.issues` holds E1 issues with `fix`. |
| 3 | not_found | file, example, chart type or option path |
| 4 | license | `details.reason` is `'license_required'` (no key) or `'license_invalid'`. The hint mentions `WCC_LICENSE_KEY`, `--license-key-file`, `--evaluation` and `https://westcoast-charts.com/pricing/#trial`. |
| 5 | conflict | an idempotent write whose target differs (CLI `skills install` without `--force`) |
| 6 | confirmation_required | an overwrite with no TTY and no `--yes` (CLI `chart export`) |

The CLI envelope adds `retryable`, which is false for all kinds today. clispec v0.3 does not fix any exit table; this mapping is ours, and it is declared in `wcc schema` and `wcc errors`.

## Licence behaviour

- These need a key verified by the library's `setLicenseKey` (ECDSA):
  - Premium types: `sankey chord gantt tree stock map marimekko network radialColumn`.
  - Layer modules: radialColumn `wave` and `matrix`, network `facet`.
- A missing or invalid key raises `license` (exit 4).
- `evaluation:true` is the only way to get watermarked output, and it is opt-in.

## Side effects

- All render-core functions are read_only.
- In the CLI, `chart export` and `skills install` are idempotent and report `changed`. Everything else is read_only.

## Browser parity

`node packages/render-core/scripts/parity.js [--out DIR] [id…]` renders each curated example with render-core and in headless Chromium (same spec, same fonts and viewport = chart width), then compares mark geometry (`tag.class` in order), text boxes, the legend, and pixels (pixelmatch). What makes the headless layout match:

- Inter with tabular figures baked in (the theme's `tabular-nums`) plus GPOS kerning; canvas `measureText` (used by premium layouts) measures proportional figures, as browsers do.
- Chromium vertical metrics: hhea values rounded per size; legend rows use `line-height: normal`.
- Theme legend markers sized as in the theme CSS (line 12×3, square 9×9, dot 8×8, 6 px gap).
- `window.innerWidth` = chart width; a neutral headless UA, so the library's canvas text measurement runs (only anonymous detached canvases get the measuring context; drawing canvases get `null`).

## 0.2.0 acceptance and compatibility

The RC7 acceptance suite has 127 passing tests with zero skips when dedicated
valid/expired/foreign-signature fixture files are explicitly provided. These
fixtures are not distributed. Validation is always the real `e1` validator;
rendered/table results always have `meta.tableSource: "describe"`. There is no
production stub mode to enable. The MCP adapter still understands an explicitly
injected legacy core's labelled table shape for compatibility; the shipped core
never emits it.

Existing error kinds and exit codes are retained. Missing matching library files
fail with `not_found`; missing Premium implementation is
`details.reason: "premium_runtime_missing"`. No key is a `license` error with
`license_required`; a rejected key is `license_invalid`. All are errors, not
successful placeholder charts. MCP reports tool errors through `isError: true`
and its documented error envelope. The `wcc://version` resource contains
`server`, `renderCore`, `lib`, `fontSet`, `fontSets`, and `validator`, so consumers
can assert the actual installed release rather than infer it from tool versions.
