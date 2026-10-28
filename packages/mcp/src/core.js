'use strict'
/*
 * Thin adapter over @wcc-agent/render-core (contract: docs/render-core-api.md v0.1).
 * The MCP server never touches the chart library directly; tests inject a fake core.
 */
const path = require('path')
const { McpToolError } = require('./errors')

const REQUIRED = ['render', 'validate', 'table', 'getSchema', 'listTypes', 'listExamples', 'getExample', 'errorCatalog']

function loadCore() {
  let core
  try {
    core = require(process.env.WCC_RENDER_CORE || '../../render-core')
  } catch (e) {
    return unavailable(`render core could not be loaded: ${e.message}`)
  }
  const missing = REQUIRED.filter((k) => typeof core[k] !== 'function')
  if (missing.length) return unavailable(`render core is missing ${missing.join(', ')}`, core)
  return core
}

/** a core whose every call fails with a clear internal error (server still starts and lists tools) */
function unavailable(reason, partial = {}) {
  const fail = () => {
    throw new McpToolError('internal', `West Coast Charts render core unavailable: ${reason}`, 'Install the server with its dependencies (npm i) or set WCC_RENDER_CORE to the render-core module path.')
  }
  const core = { unavailable: reason, version: partial.version }
  for (const k of REQUIRED) core[k] = typeof partial[k] === 'function' ? partial[k].bind(partial) : fail
  return core
}

/** directory with the library docs (guide/*.md, features/*.md) */
function docsDir() {
  if (process.env.WCC_DOCS_DIR) return process.env.WCC_DOCS_DIR
  const bundled = path.join(__dirname, '..', 'docs')
  if (process.env.WCC_LIB_ROOT) {
    const docs = path.join(process.env.WCC_LIB_ROOT, 'docs')
    if (require('fs').existsSync(path.join(docs, 'guide'))) return docs
  }
  try {
    const rc = path.dirname(require.resolve('../../render-core/package.json'))
    const lib = path.dirname(require.resolve('west-coast-charts/package.json', { paths: [rc] }))
    const d = path.join(lib, 'docs')
    if (require('fs').existsSync(path.join(d, 'guide'))) return d
  } catch (e) {
    /* fall through to the copy bundled by scripts/build-mcpb.js */
  }
  return bundled
}

function versionOf(core) {
  const v = core && core.version
  if (v && typeof v === 'object') return v
  return { renderCore: v || null, lib: null, fontSet: null }
}

module.exports = { loadCore, unavailable, docsDir, versionOf, REQUIRED }
