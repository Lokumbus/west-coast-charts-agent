'use strict'
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { registerTools, RenderCache } = require('./tools')
const { registerResources } = require('./resources')
const { registerPrompts } = require('./prompts')
const { loadCore } = require('./core')
const { resolveConfig } = require('./config')
const { toolError } = require('./errors')
const pkg = require('../package.json')

const NAME = 'west-coast-charts'
const INSTRUCTIONS = `West Coast Charts: render, validate and describe charts (ApexCharts-compatible JSON options) headlessly.
Workflow: list_chart_types -> list_examples/get_example -> get_schema for unsure options -> validate_chart until ok -> render_chart -> check the verification table.
All tools are read-only and deterministic. Errors are isError results {error:{kind,message,hint,details}}; follow the hint. Premium types need a licence key (kind "license", details.reason license_required|license_invalid). Verification tables use the wcc-describe/1 shape.
Docs: resource wcc://docs/agent-quickstart.`

/**
 * SDK hook: input validation failures and unknown tools also come back as isError results,
 * in the same envelope as our own errors (never as JSON-RPC protocol errors).
 */
class WccMcpServer extends McpServer {
  createToolError(message) {
    const m = String(message)
    let kind = 'internal'
    let hint = null
    if (/Input validation error|Invalid arguments/i.test(m)) {
      kind = 'usage'
      hint = 'Arguments do not match the tool inputSchema (see tools/list). For spec options use get_schema; spec.chart.type is required.'
    } else if (/not found|disabled/i.test(m)) {
      kind = 'not_found'
      hint = 'Available tools: render_chart, validate_chart, describe_chart, get_schema, list_chart_types, list_examples, get_example.'
    }
    return toolError({ kind, message: m.replace(/^MCP error -?\d+: /, ''), hint })
  }
}

/**
 * createServer({ config, core }) -> McpServer
 * Shape matches Smithery's TypeScript convention (export default createServer({ config })).
 */
function createServer({ config, core } = {}) {
  const ctx = {
    config: config || resolveConfig(),
    core: core || loadCore(),
    renders: new RenderCache(32),
    version: pkg.version
  }
  const server = new WccMcpServer(
    { name: NAME, title: 'West Coast Charts', version: pkg.version, websiteUrl: 'https://westcoast-charts.com' },
    { instructions: INSTRUCTIONS, capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } } }
  )
  registerTools(server, ctx)
  registerResources(server, ctx)
  registerPrompts(server, ctx)
  server.wcc = ctx
  return server
}

module.exports = { createServer, WccMcpServer, NAME, INSTRUCTIONS }
