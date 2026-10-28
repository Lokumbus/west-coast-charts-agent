'use strict'
/*
 * Error envelope shared with the CLI (`wcc`): { error: { kind, message, hint, details } }.
 * Every tool failure is returned as a CallToolResult with isError: true (never a JSON-RPC
 * protocol error), so the calling model can read the hint and self-correct.
 */

/** kinds as defined in docs/render-core-api.md; LICENSE_KIND is the one the brief calls "license_required" */
const KINDS = ['internal', 'usage', 'schema', 'not_found', 'license', 'conflict', 'confirmation_required']
const LICENSE_KIND = 'license'
const TRIAL_URL = process.env.WCC_TRIAL_URL || 'https://westcoast-charts.com/pricing/#trial'

class McpToolError extends Error {
  constructor(kind, message, hint = null, details = null) {
    super(message)
    this.kind = kind
    this.hint = hint
    this.details = details
  }
}

/** normalise anything thrown (WccError from render-core, zod error, plain Error) to the envelope */
function toEnvelope(err) {
  if (err && typeof err === 'object' && typeof err.kind === 'string') {
    return {
      kind: KINDS.includes(err.kind) ? err.kind : 'internal',
      message: String(err.message || err.kind),
      hint: err.hint == null ? null : String(err.hint),
      details: err.details == null ? null : err.details
    }
  }
  return {
    kind: 'internal',
    message: err && err.message ? String(err.message) : String(err),
    hint: 'This is a bug in the West Coast Charts MCP server or render core. Retry once; if it persists report the spec that triggers it.',
    details: null
  }
}

/** content[0]: short human/model readable line; content[1]: the JSON envelope (same as `wcc --json`) */
function toolError(err) {
  const e = toEnvelope(err)
  const head = `${e.kind}: ${e.message}${e.hint ? `\nhint: ${e.hint}` : ''}`
  return {
    isError: true,
    content: [
      { type: 'text', text: head },
      { type: 'text', text: JSON.stringify({ error: e }) }
    ]
    // no structuredContent: SDK clients validate it against the tool's outputSchema even for
    // isError results, so the machine-readable envelope travels as the second text block
  }
}

function licenseError(type) {
  return new McpToolError(
    LICENSE_KIND,
    `Chart type '${type}' is a West Coast Charts Premium type and needs a valid licence key.`,
    `Set WCC_LICENSE_KEY in the MCP server environment (or the x-wcc-license-key header over HTTP). Free 30-day trial key: ${TRIAL_URL}. Free alternatives without key: call list_chart_types and pick a type with premium:false.`,
    { type, reason: 'license_required', trialUrl: TRIAL_URL }
  )
}

module.exports = { McpToolError, toEnvelope, toolError, licenseError, KINDS, LICENSE_KIND, TRIAL_URL }
