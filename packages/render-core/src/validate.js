'use strict'
// Spec validation by the installed release validator; failures remain explicit.
// Issue shape follows E1: { kind, severity, path, pointer, message, hint, suggestion, alternatives, fix, exitCode }
const { paths } = require('./lib')
const { allTypeNames, isPremiumType } = require('./types')
const { WccError, closest } = require('./errors')

let e1
function loadE1() {
  if (e1) return e1
  const file = paths().validator
  try {
    const module = require(file), fn = module.validate || module.default?.validate
    if (typeof fn !== 'function') throw new Error('validate export missing')
    return (e1 = { validate: fn, file })
  } catch (error) {
    throw new WccError('internal', 'The installed library validator could not be loaded.', 'Reinstall the matching released Core package; no approximate validator is used.', { reason: error.message })
  }
}

/** validate(spec) -> { ok, errors, warnings, issues, validator } ; never throws for invalid specs */
function validate(spec, opts = {}) {
  const v = loadE1()
  let issues
  const validator = 'e1'
  try {
    const result = v.validate(spec, { premium: true, maxIssues: opts.maxIssues || 100 })
    issues = result.issues || [...(result.errors || []), ...(result.warnings || [])]
  } catch (error) {
    throw new WccError('internal', 'The installed library validator failed.', 'Check the JSON input and matching library installation; no approximate result is returned.', { reason: error.message })
  }
  // licensing is the renderer's job (needs the key); drop E1's license_required here
  issues = issues.filter((i) => i.kind !== 'license_required')
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity !== 'error')
  return { ok: errors.length === 0, errors, warnings, issues, validator }
}

function assertValid(spec, mode = 'strict') {
  if (mode === 'off') return { warnings: [] }
  const r = validate(spec)
  if (mode === 'strict' && !r.ok) {
    const f = r.errors[0]
    const more = r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ''
    throw new WccError('schema', `${f.message}${more}`, f.hint || null, { issues: r.errors, validator: r.validator })
  }
  return { warnings: mode === 'warn' ? r.issues : r.warnings }
}

module.exports = { validate, assertValid, validatorInfo: () => ({ validator: 'e1', file: loadE1().file }), isPremiumType }
