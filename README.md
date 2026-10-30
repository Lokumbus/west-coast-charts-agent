# West Coast Charts agent tools

`west-coast-charts-agent` 0.2.3 provides the `wcc` CLI, the `wcc-mcp` stdio/HTTP server, and the headless render API. Use this version with West Coast Charts **1.1.x releases from 1.1.1 onward** and the matching validator, schema and describe module.

## Install

Node.js 20 or newer is required. The release installation command is:

```sh
npm install 'west-coast-charts@>=1.1.1 <1.2.0' west-coast-charts-agent@0.2.3
npx --no-install wcc --help
npx --no-install wcc version --json
npx --no-install wcc-mcp --help
npx --no-install wcc-mcp --version
```

This command selects agent tools 0.2.3 and a compatible West Coast Charts 1.1.x version. The agent package declares the optional peer range `>=1.1.1 <1.2.0`; npm resolves the matching Core version normally. Release availability and artifact checksums are recorded in the release metadata; this installation guide does not replace that verification. Version 0.2.1 remains the immutable, published installation-fix release. The public Core package and agent package contain no Premium implementation or licence issuer. No private workspace package or access token is needed for their published npm installation. MCP registry listing is a separate channel and is not asserted here.

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

The server uses stdio by default. Protocol output is on stdout; logs are on stderr. Seven tools cover rendering, validation, description, schemas, types, examples and example retrieval. SDK 1.32.2 supports MCP 2025-11-25 and its negotiated older revisions; this is not a claim of MCP 2026-07-28 conformance. See [MCP setup](packages/mcp/README.md). `--help` and `--version` exit without starting a server.

## Premium and Orient

Free Core includes the free chart types and Orient feature. The agent archive does **not** contain Premium implementations. To render Premium, obtain the complete matching West Coast Charts 1.1.x distribution separately. An installed complete `west-coast-charts` package is resolved normally; use `WCC_LIB_ROOT` only to select a separate extraction. Set `WCC_LICENSE_KEY` privately or use CLI `--license-key-file`. A key alone does not install Premium code. Existing MIT rights in independently licensed source remain unchanged.

Thirteen Premium types are recognized, including `quintTimeline`, `quintConvergence`, `vitalsClock` and `schedule`. Their real type modules must be present. A missing key produces a license error. Explicit `--evaluation` permits watermarked evaluation when the Premium runtime is installed. Invalid, expired or otherwise rejected keys remain rejected; evaluation is not a key bypass. Keys are not written into the SVG, table, logs or package.

## Source and tests

The source workspace keeps three private workspace packages. From a complete source checkout, `npm ci` installs the locked development dependencies and `npm test` runs the workspace tests. Select the complete test runtime through `WCC_LIB_ROOT`; Premium acceptance requires that separate runtime. Optional signing acceptance reads protected fixture paths without printing keys. A successful Core-only test run does not prove Premium support.

Release packaging is a maintainer operation, not an installed-package command. The internal pipeline must export an exact reviewed Git commit into an isolated staging directory, copy the explicit source/font/licence allowlist, resolve internal imports, pin public dependencies from the lockfile, and record file hashes. It must bind the tested Core and complete-runtime artifacts by exact version, commit and SHA256 before packing 0.2.3. Fresh consumers must install the resulting archive outside the workspace and prove CLI/MCP imports, rendering and licence failures without ancestor dependency fallback. The installed package does not include build scripts or tests. The older source-only `scripts/build-distribution.cjs` and isolated-install recipes contain RC7 fixture pins; they are not the 1.1.1 release pipeline and must not be used to claim current provenance.

Tooling: MIT. Font copyright, SIL OFL texts and modifications: [font provenance](packages/render-core/fonts/FONTS.md). Chart-library licenses and attribution remain in the separate library distribution. See [NOTICE](NOTICE).

## 0.2.1 installation correction

Version 0.2.0 missed one internal CLI import and can fail with `MODULE_NOT_FOUND` outside the development workspace, even on `--help`. That defect was corrected in immutable 0.2.1. Its packaging check rejects bare workspace imports, and installation acceptance runs in an operating-system temporary directory with an empty HOME and a module-resolution guard. The earlier in-repository installation proof was contaminated by ancestor workspace dependencies and is not an isolated-installation result. The 0.2.0 tag and archive remain unchanged.

## 0.2.2 HTTP authorization correction

Version 0.2.2 added fail-closed JWKS configuration: issuer, audience and required scopes must all be explicitly supplied; tokens must satisfy signature, issuer, audience, expiry and scope checks. Cached render resources are separated by issuer, subject and client identity. This correction requires 0.2.2; 0.2.1 is not rewritten or silently upgraded. Local stdio usage retains its existing filesystem permission boundary. See [HTTP deployment and authorization](packages/mcp/docs/guide/http-security.md) for the exact environment contract and supported protocol.
