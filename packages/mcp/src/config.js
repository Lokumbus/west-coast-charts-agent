'use strict'
/*
 * Server configuration. One flat schema serves three consumers:
 *   - Smithery (exported `configSchema`, zod v4 with x-from / x-to metadata, <= 20 fields, < 1 KB)
 *   - CLI flags for stdio (Smithery converts field names to kebab-case flags: --license-key ...)
 *   - environment variables (WCC_LICENSE_KEY, ...), used by .mcpb user_config and server.json
 */
const { z } = require('zod/v4')

const configSchema = z.object({
  licenseKey: z
    .string()
    .optional()
    .meta({ 'x-from': { header: 'x-wcc-license-key' } })
    .describe('West Coast Charts Premium licence key. Needed only for premium chart types (sankey, chord, radialColumn, ...). Free types work without it.'),
  defaultTheme: z.enum(['light', 'dark']).default('light').describe('Theme used when a spec sets no theme.mode.'),
  maxPixels: z.number().int().min(10000).max(67108864).default(16777216).describe('Upper bound for width*height*scale^2 of one render (protects shared servers).'),
  evaluation: z.boolean().default(false).describe('Without a licence key, render premium types with an "unlicensed" watermark (opt-in preview) instead of failing with kind "license".')
})

const ENV = { licenseKey: 'WCC_LICENSE_KEY', defaultTheme: 'WCC_DEFAULT_THEME', maxPixels: 'WCC_MAX_PIXELS', evaluation: 'WCC_EVALUATION' }

/** env -> argv flags -> explicit overrides (later wins); unknown values fall back to defaults */
function resolveConfig({ env = process.env, argv = [], overrides = {} } = {}) {
  const raw = {}
  for (const [k, name] of Object.entries(ENV)) if (env[name] != null && env[name] !== '') raw[k] = env[name]
  const flags = parseFlags(argv)
  if (flags['license-key']) raw.licenseKey = flags['license-key']
  if (flags['default-theme']) raw.defaultTheme = flags['default-theme']
  if (flags['max-pixels']) raw.maxPixels = flags['max-pixels']
  if (flags.evaluation) raw.evaluation = flags.evaluation
  Object.assign(raw, overrides)
  if (raw.maxPixels != null) raw.maxPixels = Number(raw.maxPixels)
  if (typeof raw.evaluation === 'string') raw.evaluation = /^(1|true|yes)$/i.test(raw.evaluation)
  const r = configSchema.safeParse(raw)
  if (r.success) return r.data
  // keep the good fields, default the rest, never crash the server on a bad env var
  const out = configSchema.parse({})
  for (const k of Object.keys(raw)) {
    const one = configSchema.shape[k].safeParse(raw[k])
    if (one.success) out[k] = one.data
  }
  return out
}

function parseFlags(argv) {
  const f = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq > 0) f[a.slice(2, eq)] = a.slice(eq + 1)
    else if (argv[i + 1] != null && !argv[i + 1].startsWith('--')) f[a.slice(2)] = argv[++i]
    else f[a.slice(2)] = true
  }
  return f
}

module.exports = { configSchema, resolveConfig, parseFlags, ENV }
