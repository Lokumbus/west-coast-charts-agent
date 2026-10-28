#!/usr/bin/env node
'use strict'
/*
 * wcc-mcp [--transport stdio|http] [--port 8787] [--host 127.0.0.1] [--license-key KEY]
 *         [--default-theme light|dark] [--max-pixels N]
 * stdio is the default. Logs go to stderr only (stdout belongs to the protocol).
 */
// determinism: date formatting must not depend on the host zone (same rule as the wcc CLI)
process.env.TZ = 'UTC'
const { parseFlags, resolveConfig } = require('../src/config')
const argv = process.argv.slice(2)
const f = parseFlags(argv)

if (f.help || f.h) {
  process.stderr.write('wcc-mcp: West Coast Charts MCP server\n  --transport stdio|http (default stdio)\n  --port N --host H (http)\n  --license-key KEY | env WCC_LICENSE_KEY\n  --default-theme light|dark\n  --max-pixels N\n  --evaluation | env WCC_EVALUATION=1 (premium without a key: watermarked preview)\nHTTP auth: WCC_MCP_AUTH_TOKENS, WCC_MCP_JWKS_URL, WCC_MCP_ISSUER, WCC_MCP_AUDIENCE, WCC_MCP_PUBLIC_URL\n')
  process.exit(0)
}
if (f.version) {
  process.stdout.write(require('../package.json').version + '\n')
  process.exit(0)
}

const config = resolveConfig({ argv })
const transport = f.transport || process.env.WCC_MCP_TRANSPORT || 'stdio'

if (transport === 'http') {
  const { listen } = require('../src/http')
  listen({ port: Number(f.port) || Number(process.env.PORT) || 8787, host: f.host || process.env.HOST || '127.0.0.1', config }).then((s) => {
    const a = s.address()
    process.stderr.write(`wcc-mcp: Streamable HTTP on http://${a.address}:${a.port}/mcp\n`)
  })
} else if (transport === 'stdio') {
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
  const { createServer } = require('../src/server')
  const server = createServer({ config })
  server.connect(new StdioServerTransport()).catch((e) => {
    process.stderr.write(`wcc-mcp: ${e.message}\n`)
    process.exit(1)
  })
} else {
  process.stderr.write(`wcc-mcp: unknown --transport '${transport}', use stdio or http\n`)
  process.exit(2)
}
