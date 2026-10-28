# West Coast Charts MCP server 0.2.1

Install `west-coast-charts-agent` and the matching released Core runtime using the two GitHub assets in the root [README](../../README.md). The executable is `wcc-mcp`; `wcc-mcp --help` and `wcc-mcp --version` terminate without starting the server. No unpublished `@westcoastcharts/mcp` npm package is required.

## Local stdio

Use an absolute executable path in your MCP client:

```json
{"mcpServers":{"west-coast-charts":{"command":"/absolute/project/node_modules/.bin/wcc-mcp","args":[]}}}
```

For Premium, pass `WCC_LIB_ROOT` pointing to a separately obtained complete matching library and `WCC_LICENSE_KEY` through the client's private environment. Do not put a key in public configuration or source control. No key is needed for free charts. `WCC_EVALUATION=1` explicitly enables watermarked Premium evaluation only when the Premium runtime is present; a supplied invalid key is still rejected.

## Tools

- `render_chart`: real SVG or PNG plus the verification table.
- `validate_chart`: matching RC7 validator with errors, warnings and fix suggestions.
- `describe_chart`: the actual `wcc-describe/1` model, with `tableSource: "describe"`.
- `get_schema`: bounded slices of the matching options schema.
- `list_chart_types`, `list_examples`, `get_example`: discover supported types and JSON examples.

Examples and typed options may include Premium vocabulary without including Premium implementation. Missing runtime modules fail explicitly. No production validator or table stubs are used. Resources include tool guides, errors, version metadata, recent renders, and library documentation when the selected runtime contains it. Prompts: `pick_chart_type` and `build_dashboard`.

## HTTP (optional)

`wcc-mcp --transport http` starts the optional Streamable HTTP service. Read `wcc-mcp --help` for host, port, origin and bearer-token options. Keep it on loopback unless you deliberately configure authentication and deployment controls; this archive does not deploy a hosted service. Tool requests are JSON-only and do not evaluate user JavaScript.

## Distribution status

The supported release format is the single agent `.tgz`, with native PNG dependencies selected by npm for the installation platform. The repository's MCP registry metadata has no published packages listed until a real registry entry exists. MCPB metadata is a template, not a downloadable bundle; no zero-hash or nonexistent bundle is advertised. Use the tested stdio executable in desktop clients.
