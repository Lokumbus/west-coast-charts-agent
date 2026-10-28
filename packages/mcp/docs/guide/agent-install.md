# West Coast Charts agent tools

`west-coast-charts-agent` 0.2.0 provides the `wcc` CLI, the `wcc-mcp` stdio/HTTP server, and the headless render API. It targets the released West Coast Charts **1.1.1-rc.7** runtime and its matching validator, schema and describe module.

## Install

Node.js 20 or newer is recommended. Install the two release assets in one project:

```sh
npm install \
  https://github.com/Lokumbus/west-coast-charts-core/releases/download/v1.1.1-rc.7/west-coast-charts-1.1.1-rc.7.tgz \
  https://github.com/Lokumbus/west-coast-charts-agent/releases/download/v0.2.0/west-coast-charts-agent-0.2.0.tgz
npx --no-install wcc --help
npx --no-install wcc version --json
npx --no-install wcc-mcp --help
npx --no-install wcc-mcp --version
```

The agent release URL is the publication target until its GitHub release is published. No npm registry publication or MCP registry listing is claimed. During preparation, substitute the locally built agent `.tgz` for the second URL. All remaining dependencies are public npm packages. No workspace checkout, private npm scope, or access token is required.

## Render and verify

```sh
npx --no-install wcc examples get line-basic
npx --no-install wcc chart validate example:line-basic
npx --no-install wcc chart render example:line-basic > chart.svg
npx --no-install wcc chart render example:line-basic --format png > chart.png
npx --no-install wcc chart table example:line-basic
npx --no-install wcc options schema chart.orient
```

Specs are plain JSON, not executable JavaScript. Validation uses the real matching `dist/agent/validate.common.js`; every verification table comes from the real chart's `describe()`. Missing modules or failed renders are errors, never successful placeholder output. `wcc schema` describes every command and its exit status.

## MCP

Configure a local MCP client with the installed executable's absolute path:

```json
{"mcpServers":{"west-coast-charts":{"command":"/absolute/project/node_modules/.bin/wcc-mcp","args":[]}}}
```

The server uses stdio by default. Protocol output is on stdout; logs are on stderr. Seven tools cover rendering, validation, description, schemas, types, examples and example retrieval. See [MCP setup](packages/mcp/README.md). `--help` and `--version` exit without starting a server.

## Premium and Orient

Free Core includes the free chart types and Orient feature. The agent archive does **not** contain Premium implementations. To render Premium, obtain the complete matching RC7 distribution separately and select its extracted package root with `WCC_LIB_ROOT`; set `WCC_LICENSE_KEY` privately or use CLI `--license-key-file`. A key alone does not install Premium code. Existing MIT rights in independently licensed source remain unchanged.

Thirteen Premium types are recognized, including `quintTimeline`, `quintConvergence`, `vitalsClock` and `schedule`. Their real type modules must be present. A missing key produces a license error. Explicit `--evaluation` permits watermarked evaluation when the Premium runtime is installed. Invalid, expired or otherwise rejected keys remain rejected; evaluation is not a key bypass. Keys are not written into the SVG, table, logs or package.

## Source and tests

The public distribution is built with `node scripts/build-distribution.cjs`. The source repository keeps its three private workspace packages; the release archive bundles their original source into one installable package with public dependencies. `npm test` exercises a complete runtime selected through `WCC_LIB_ROOT`; Premium tests require a complete licensed/evaluation-capable runtime. Optional key acceptance tests read private fixture paths from the environment and never print their contents.

Tooling: MIT. Font copyright, SIL OFL texts and modifications: [font provenance](packages/render-core/fonts/FONTS.md). Chart-library licenses and attribution remain in the separate library distribution. See [NOTICE](NOTICE).
