'use strict'
const fs = require('fs')
const path = require('path')
const { WccError, closest } = require('../../render-core')

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

function notFoundFile(file, flag) {
  const dir = path.dirname(path.resolve(file))
  let c = null
  try {
    c = closest(path.basename(file), fs.readdirSync(dir))
  } catch (e) {
    /* dir missing */
  }
  const fixed = c ? path.join(path.dirname(file), c) : null
  return new WccError('not_found', `No such file: ${file}${flag ? ` (${flag})` : ''}.`, fixed ? `Did you mean ${fixed}?` : 'Check the path; use "-" to read the spec from stdin.', { path: file, suggestion: fixed })
}

function parseJson(text, where) {
  try {
    return JSON.parse(text)
  } catch (e) {
    const m = /position (\d+)/.exec(e.message)
    let loc = ''
    if (m) {
      const pos = +m[1]
      const before = text.slice(0, pos)
      loc = ` at line ${before.split('\n').length}, column ${pos - before.lastIndexOf('\n')}`
    }
    throw new WccError('schema', `${where} is not valid JSON${loc}: ${e.message}`, 'Fix the JSON syntax (specs are plain JSON: no functions, no comments, double-quoted keys).', { source: where })
  }
}

function readJsonFile(file, flag) {
  if (!fs.existsSync(file)) throw notFoundFile(file, flag)
  return parseJson(fs.readFileSync(file, 'utf8'), file)
}

async function readSpec(ref, ctx) {
  let spec
  if (ref === undefined || ref === '-') {
    if (ref === undefined && ctx.io.stdin.isTTY) throw new WccError('usage', 'No chart spec given.', `${ctx.cmdname} chart.json   (or pipe it: cat chart.json | ${ctx.cmdname} -)`)
    spec = parseJson(await readAll(ctx.io.stdin), 'stdin')
  } else spec = readJsonFile(ref)
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new WccError('schema', 'The spec must be a JSON object of chart options.', 'Example: {"chart":{"type":"line"},"series":[{"name":"A","data":[1,2,3]}]}')
  return spec
}

function licenseKey(ctx) {
  const f = ctx.flags
  if (f['--license-key-file'] !== undefined) {
    if (!fs.existsSync(f['--license-key-file'])) throw notFoundFile(f['--license-key-file'], '--license-key-file')
    return fs.readFileSync(f['--license-key-file'], 'utf8').trim()
  }
  if (f['--license-key'] !== undefined) {
    ctx.log('warning: --license-key puts the key in argv (visible in ps and shell history); prefer WCC_LICENSE_KEY or --license-key-file', true)
    return String(f['--license-key'])
  }
  return undefined
}

function renderOpts(ctx) {
  const f = ctx.flags
  const o = { seed: f['--seed'] === undefined ? 1 : f['--seed'], validate: f['--validate'] || 'strict' }
  if (f['--format'] !== undefined) o.format = f['--format']
  if (f['--width'] !== undefined) o.width = f['--width']
  if (f['--height'] !== undefined) o.height = f['--height']
  if (f['--scale'] !== undefined) o.scale = f['--scale']
  if (f['--background'] !== undefined) o.background = f['--background']
  if (f['--theme'] !== undefined) o.theme = f['--theme']
  if (f['--evaluation']) o.evaluation = true
  if (f['--font-set'] !== undefined) o.fontSet = f['--font-set']
  // precedence (render-core resolveLicenseKey): --license-key-file / --license-key > chart.licenseKey in the spec > WCC_LICENSE_KEY
  const k = licenseKey(ctx)
  o.licenseKey = k === undefined ? '' : k
  o.envLicenseKey = ctx.io.env.WCC_LICENSE_KEY || '' // never let render-core re-read a different env than the CLI saw
  return o
}

/** TTY-only prompt; without a TTY the answer is "no" (caller raises confirmation_required). */
function confirm(ctx, question) {
  const { stdin, stderr } = ctx.io
  if (!stdin.isTTY || !stderr.isTTY) return Promise.resolve(false)
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: stdin, output: stderr })
    rl.question(question + ' [y/N] ', (a) => {
      rl.close()
      resolve(/^y(es)?$/i.test(a.trim()))
    })
  })
}

module.exports = { readSpec, readJsonFile, licenseKey, renderOpts, confirm, readAll }
