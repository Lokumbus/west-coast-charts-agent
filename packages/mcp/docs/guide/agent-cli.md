# `wcc`: command reference (v0.2.0)

**Machine-readable contract:** `wcc schema`. It validates against https://clispec.dev/schema/v0.3.json, and `wcc --help --json` prints the same document. Narrow it to one command with `wcc schema chart render`.

**Global flags** go before or after the command:
- `-o/--output auto|text|json|ndjson`. `auto` gives text on a TTY and JSON when piped.
- `--json` is an alias for `-o json`.
- `-q/--quiet`, `-h/--help`, `--version`.

**SPEC** is one of: a file path, `-` (stdin), `example:<id>`, or nothing, in which case stdin is read when it is not a TTY. On a TTY, a missing SPEC is a usage error, because wcc never prompts.

| command | effects | output | notes |
|---|---|---|---|
| `chart render SPEC` | read_only | opaque `image/svg+xml` / `image/png` | stdout carries only the artifact. PNG to a TTY is refused. |
| `chart export SPEC --out FILE [--yes]` | idempotent | `{path,format,bytes,sha256,changed,meta,table?}` | Same bytes give `changed:false`. A different existing file prompts on a TTY; without one it exits 6 with hint `… --yes`. |
| `chart validate SPEC` | read_only | `{ok,validator,errors,warnings}` | The report is printed on stdout even when invalid. Invalid specs exit 2 with an envelope. |
| `chart table SPEC` | read_only | `wcc-describe/1` | Schema-valid object, no extra keys. With the 1.1 library this is the full `chart.describe()` model (aggregates, scales, extrema; stacked charts add per-category totals and a `Total` column). The matching describe module is required; JSON callers get `meta.tableSource: "describe"` from `chart export --with-table`. |
| `options schema [PATH] [--depth N]` | read_only | JSON Schema 2020-12 | alias `schema get PATH` |
| `types list [--tier]` | read_only | `{items,total}` | |
| `examples list [--type --tag --premium --free]` | read_only | `{items,total}` | |
| `examples get ID [--spec-only]` | read_only | example or bare spec | |
| `skills show` (also bare `skills`) | read_only | opaque `text/markdown` | |
| `skills install [DIR] [--force]` | idempotent | `{path,changed,sha256}` | An edited file exits 5 with hint `… --force` |
| `errors` | read_only | `{items}` | exit codes |
| `version` | read_only | versions | |
| `schema [COMMAND…]` | read_only | clispec v0.3 doc | |

**Render flags:**
- `--data FILE`, `--format svg|png`, `--width`, `--height`
- `--seed N` (default 1), `--scale`, `--background`
- `--theme light|dark`, `--validate strict|warn|off`
- `--font-set inter-4.1|liberation-sans-2.1.5` (aliases `inter`, `liberation`; default `inter-4.1`). An unknown set is a usage error (exit 2).
- `--license-key-file FILE`
- `--evaluation` (opt-in preview: premium types render without a key, with the "unlicensed" watermark; `meta.licensed` false)
- `--license-key` exists but is hidden and prints a warning.

Licence key sources, first one present wins (no fallthrough, like the browser library, where a per-chart `chart.licenseKey` beats the global `setLicenseKey`):

1. `--license-key-file FILE` (or the hidden `--license-key`)
2. `chart.licenseKey` in the spec
3. env `WCC_LICENSE_KEY`

If the chosen key is invalid, the `license` error (`details.reason: license_invalid`) names the source in the message and in `details.keySource` (`option`, `spec` or `env`); it does not try the next source. `meta.licenseKeySource` reports the source used on success. Keys are never echoed into output, warnings or errors.

**Fonts.** Output uses the frozen `inter-4.1` set (Inter 4.1, SIL OFL; Liberation Sans as fallback family). An earlier curated browser-parity record reported 18 examples within 1 px of headless Chromium for marks and labels. That historical result is not a certification of current RC7 charts: the current acceptance run passed 127 functional tests, with zero skips, and did not repeat a universal browser-parity audit. The comparison script remains `packages/render-core/scripts/parity.js`. The headless viewport equals the chart width, so responsive breakpoints see the chart size. See `packages/render-core/fonts/FONTS.md` for font provenance and measurement details.

**Exit codes:**

| code | kind |
|---|---|
| 0 | ok |
| 1 | internal |
| 2 | usage, schema |
| 3 | not_found |
| 4 | license (`details.reason`: `license_required` or `license_invalid`) |
| 5 | conflict |
| 6 | confirmation_required |

In structured mode the last stderr line is `{"error":{kind,message,hint,details?,exit_code,retryable}}`. In text mode it is `wcc: error: … / hint: …`. wcc never emits ANSI.

## Examples
```sh
wcc examples get line-basic --spec-only > chart.json
wcc chart validate chart.json
wcc chart render chart.json > chart.svg
wcc chart export chart.json --out chart.png --scale 2
cat chart.json | wcc chart render --format png > chart.png
wcc chart table chart.json -o text
wcc options schema plotOptions.bar --depth 2
WCC_LICENSE_KEY=… wcc chart render example:sankey-budget > sankey.svg
wcc skills install .agents/skills
```

### Real output (library 1.1.1-rc.7)

A typo in a layer type. The report goes to stdout, the envelope to stderr, exit code 2:

```text
$ wcc chart validate dashboard.json
1 error(s)
  error plotOptions.radialColumn.layers[0].type: plotOptions.radialColumn.layers[0].type is "donught"; allowed: "pie", "donut", "radialBar", "heatmap", "polarArea", "gauge", "sunburst", "chord", "matrix", "arc", "nestedDonut", "goals", "wave".  -> Did you mean "donut"?
wcc: error: plotOptions.radialColumn.layers[0].type is "donught"; allowed: "pie", "donut", "radialBar", "heatmap", "polarArea", "gauge", "sunburst", "chord", "matrix", "arc", "nestedDonut", "goals", "wave".
  hint: Did you mean "donut"?
```

The verification table of a stacked column chart:

```text
$ wcc chart table stacked.json -o text
Stacked column chart with 2 series: A, B. 2 data points per series. Values range from 1 to 4. Category totals range from 4 (Q1) to 6 (Q2).

Category  A  B  Total
Q1        1  3  4
Q2        2  4  6
```
