'use strict'
// Error kinds and their exit codes (declared machine-readably: errorCatalog(), `wcc schema`, `wcc errors`).
// clispec v0.3 lets every tool declare its own kind -> code mapping; this is ours.
const CATALOG = [
  { kind: 'internal', exit_code: 1, retryable: false, description: 'Bug or renderer crash. Report it with the spec; retrying will not help.' },
  { kind: 'usage', exit_code: 2, retryable: false, description: 'Bad command line: unknown command, flag or flag value. The hint holds the corrected command.' },
  { kind: 'schema', exit_code: 2, retryable: false, description: 'The chart spec is not valid JSON or fails validation. details.issues lists every issue with path, hint and fix.' },
  { kind: 'not_found', exit_code: 3, retryable: false, description: 'File, example, chart type or schema path does not exist. The hint names the closest match.' },
  { kind: 'license', exit_code: 4, retryable: false, description: 'A premium chart type or layer needs a valid licence key (env WCC_LICENSE_KEY or --license-key-file).' },
  { kind: 'conflict', exit_code: 5, retryable: false, description: 'The target exists with different content (e.g. an edited skill file); re-run with --force to replace it.' },
  { kind: 'confirmation_required', exit_code: 6, retryable: false, description: 'Overwriting a file needs confirmation; without a TTY re-run with --yes.' },
]
const EXIT = Object.fromEntries(CATALOG.map((c) => [c.kind, c.exit_code]))

class WccError extends Error {
  constructor(kind, message, hint = null, details = null) {
    super(message)
    if (!(kind in EXIT)) kind = 'internal'
    this.name = 'WccError'
    this.kind = kind
    this.exitCode = EXIT[kind]
    this.hint = hint || null
    this.details = details || null
  }
  toJSON() {
    const e = { kind: this.kind, message: this.message }
    if (this.hint) e.hint = this.hint
    if (this.details) e.details = this.details
    e.exit_code = this.exitCode
    return { error: e }
  }
}
const isWccError = (e) => !!e && e.name === 'WccError' && typeof e.kind === 'string'
const toWccError = (e) => (isWccError(e) ? e : new WccError('internal', (e && e.message) || String(e), 'This is a bug in wcc/render-core: report it with the spec and the output of `wcc version`; retrying will not help.', e && e.stack ? { stack: String(e.stack).split('\n').slice(0, 6) } : null))
const errorCatalog = () => CATALOG.map((c) => ({ ...c }))

/** Damerau-free Levenshtein, small strings */
function distance(a, b) {
  a = String(a).toLowerCase()
  b = String(b).toLowerCase()
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
function closest(word, candidates, max = 3) {
  let best = null
  let bd = Infinity
  for (const c of candidates) {
    const dd = distance(word, c)
    if (dd < bd) {
      bd = dd
      best = c
    }
  }
  return bd <= Math.max(max, Math.floor(String(word).length / 3)) ? best : null
}

module.exports = { WccError, isWccError, toWccError, errorCatalog, EXIT, closest, distance }
