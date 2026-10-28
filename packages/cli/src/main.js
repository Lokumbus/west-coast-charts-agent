'use strict'
// wcc - agent-native CLI for West Coast Charts. clispec v0.3 (https://clispec.dev), exit codes declared in `wcc schema`.
const core = require('../../render-core')
const { WccError, isWccError, errorCatalog } = core
const { COMMANDS } = require('./commands')
const { closest, toWccError } = core
const VERSION = require('../package.json').version

const GLOBAL_ARGS = [
  { name: '--output', short: '-o', type: 'string', enum: ['auto', 'text', 'json', 'ndjson'], default: 'auto', description: 'Output format; auto = text on a TTY, json when piped. Also selects the error format (JSON envelope as the last stderr line).' },
  { name: '--json', type: 'boolean', description: 'Alias for --output json.' },
  { name: '--quiet', short: '-q', type: 'boolean', description: 'No log/warning lines on stderr (errors still reported).' },
  { name: '--help', short: '-h', type: 'boolean', description: 'Help; with --json the clispec document (same as `wcc schema`).' },
  { name: '--version', type: 'boolean', description: 'Print the version.' },
]
const ALIASES = { '--json': ['--output', 'json'] }
const GROUPS = ['chart', 'options', 'types', 'examples', 'skills']

function shq(s) {
  s = String(s)
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

function schemaDoc(narrow) {
  const cmds = COMMANDS.filter((c) => !narrow || c.name === narrow || c.name.startsWith(narrow + ' '))
  if (narrow && !cmds.length) {
    const c = closest(narrow, COMMANDS.map((x) => x.name))
    throw new WccError('not_found', `No command "${narrow}".`, c ? `wcc schema ${c}` : 'wcc schema', { command: narrow, suggestion: c })
  }
  return {
    clispec: '0.3',
    name: 'wcc',
    version: VERSION,
    description: 'Render, validate and describe West Coast Charts specs headlessly (SVG/PNG + data table). Deterministic: same spec + --seed + version => same bytes.',
    output: { tty: 'text', piped: 'json' },
    global_args: GLOBAL_ARGS,
    commands: cmds.map(({ run, args, ...c }) => {
      const out = Object.assign({}, c, { args: (args || []).filter((a) => !a.hidden).map(({ hidden, ...a }) => a) })
      return out
    }),
    errors: errorCatalog().map((e) => ({ kind: e.kind, exit_code: e.exit_code, retryable: e.retryable, description: e.description })),
    'x-wcc': {
      env: { WCC_LICENSE_KEY: 'Premium licence key (preferred; never pass keys on argv).', NO_COLOR: 'Respected; wcc never emits ANSI.', TZ: 'Forced to UTC for deterministic date formatting.' },
      spec_input: 'SPEC = file path, "-" for stdin, or example:<id>. Stdin is read when SPEC is omitted and stdin is not a TTY.',
      determinism: 'Fonts are frozen (inter-4.1: Inter 4.1, Liberation Sans 2.1.5 as fallback family); animations off; seeded PRNG; TZ=UTC.',
      envelope: '{"error":{"kind","message","hint?","details?","exit_code","retryable"}} as the last stderr line when the output format is structured.',
      aliases: { 'skills': 'skills show', 'schema get PATH': 'options schema PATH', '--json': '--output json' },
    },
  }
}

function helpText(cmd) {
  if (cmd) {
    const lines = [`wcc ${cmd.name} - ${cmd.description}`, '', `effects: ${cmd.effects}   output: ${cmd.output_kind}${cmd.media_type ? ' (' + cmd.media_type + ')' : ''}`, '']
    for (const a of (cmd.args || []).filter((x) => !x.hidden)) lines.push(`  ${(a.name + (a.type === 'boolean' || a.positional ? '' : ' <' + a.type + '>')).padEnd(28)} ${a.description || ''}${a.enum ? ' [' + a.enum.join('|') + ']' : ''}`)
    if (cmd['x-example']) lines.push('', `example: ${cmd['x-example']}`)
    lines.push('', `Machine-readable: wcc schema ${cmd.name}`)
    return lines.join('\n') + '\n'
  }
  const lines = ['wcc - West Coast Charts for agents and scripts (headless SVG/PNG, validation, data tables)', '', 'Usage: wcc [-o auto|text|json|ndjson] <noun> <verb> [args]', '', 'Commands:']
  for (const c of COMMANDS) lines.push(`  ${c.name.padEnd(18)} ${c.effects.padEnd(10)} ${c.description}`)
  lines.push('', 'Machine-readable description of every command, arg, output shape and error kind:', '  wcc schema            (clispec v0.3; `wcc --help --json` prints the same)', '  wcc errors            (exit codes: 0 ok, 1 internal, 2 usage/schema, 3 not_found, 4 license, 5 conflict, 6 confirmation_required)', '', 'Premium types need WCC_LICENSE_KEY (or --license-key-file).', 'Start: wcc examples list ; wcc examples get line-basic --spec-only | wcc chart render > chart.svg')
  return lines.join('\n') + '\n'
}

/** argv -> { globals, words, rest } ; globals may appear anywhere */
function parse(argv) {
  const globals = {}
  const words = []
  const rest = []
  let i = 0
  let inCmd = false
  for (; i < argv.length; i++) {
    let a = argv[i]
    if (a === '--') {
      rest.push(...argv.slice(i))
      break
    }
    let val
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    if (eq > 0) {
      val = a.slice(eq + 1)
      a = a.slice(0, eq)
    }
    const g = GLOBAL_ARGS.find((x) => x.name === a || x.short === a)
    if (g) {
      if (ALIASES[g.name]) {
        globals[ALIASES[g.name][0]] = ALIASES[g.name][1]
        continue
      }
      if (g.type === 'boolean') globals[g.name] = true
      else {
        if (val === undefined) val = argv[++i]
        globals[g.name] = val
      }
      continue
    }
    if (!inCmd && !a.startsWith('-') && words.length < 2 && (words.length === 0 || GROUPS.includes(words[0]))) {
      words.push(a)
      continue
    }
    inCmd = true
    rest.push(eq > 0 ? argv[i] : a)
  }
  return { globals, words, rest }
}

function resolveCommand(words, rest) {
  let w = words.slice()
  // aliases
  if (w[0] === 'skills' && w.length === 1) w = ['skills', 'show']
  if (w[0] === 'schema' && w.length === 1 && rest[0] === 'get') return { cmd: COMMANDS.find((c) => c.name === 'options schema'), rest: rest.slice(1) }
  if (w[0] === 'schema') return { cmd: COMMANDS.find((c) => c.name === 'schema'), rest: w.slice(1).concat(rest) }
  const name = w.join(' ')
  let cmd = COMMANDS.find((c) => c.name === name)
  if (!cmd && w.length === 2) {
    cmd = COMMANDS.find((c) => c.name === w[0])
    if (cmd) return { cmd, rest: [w[1]].concat(rest) }
  }
  if (!cmd && w.length === 1) {
    const one = COMMANDS.find((c) => c.name === w[0])
    if (one) return { cmd: one, rest }
  }
  if (!cmd) {
    const names = COMMANDS.map((c) => c.name)
    if (GROUPS.includes(w[0]) && w.length === 1) {
      const verbs = names.filter((n) => n.startsWith(w[0] + ' '))
      throw new WccError('usage', `"${w[0]}" needs a verb: ${verbs.map((v) => v.split(' ')[1]).join(', ')}.`, `wcc ${verbs[0]} ${rest.map(shq).join(' ')}`.trim(), { commands: verbs })
    }
    const c = closest(name, names, 4)
    throw new WccError('usage', name ? `Unknown command "${name}".` : 'No command given.', c ? `wcc ${c} ${rest.map(shq).join(' ')}`.trim() : 'wcc --help', { command: name, suggestion: c, commands: names })
  }
  return { cmd, rest }
}

function coerce(arg, raw, ctx) {
  const bad = (why) => {
    const hint = arg.enum ? ctx.cmdline({ replace: [arg.name, arg.enum[0]] }) : `${arg.name} expects ${arg.type}`
    return new WccError('usage', `Invalid value "${raw}" for ${arg.name}: ${why}.`, hint, { arg: arg.name, value: raw, allowed: arg.enum || null })
  }
  let v = raw
  if (arg.type === 'integer') {
    if (!/^-?\d+$/.test(String(raw))) throw bad('expected an integer')
    v = parseInt(raw, 10)
  } else if (arg.type === 'number') {
    v = Number(raw)
    if (raw === '' || !Number.isFinite(v)) throw bad('expected a number')
  }
  if (arg.enum && !arg.enum.includes(v)) {
    const c = closest(String(raw), arg.enum)
    const err = bad(`expected one of ${arg.enum.join(', ')}`)
    if (c) err.hint = ctx.cmdline({ replace: [arg.name, c] })
    throw err
  }
  return v
}

function parseCommand(cmd, rest, ctx) {
  const decl = cmd.args || []
  const flags = {}
  const pos = []
  for (let i = 0; i < rest.length; i++) {
    let a = rest[i]
    if (a === '--') {
      pos.push(...rest.slice(i + 1))
      break
    }
    if (a.startsWith('-') && a !== '-') {
      let val
      const eq = a.indexOf('=')
      if (eq > 0) {
        val = a.slice(eq + 1)
        a = a.slice(0, eq)
      }
      const d = decl.find((x) => !x.positional && x.name === a)
      if (!d) {
        const known = decl.filter((x) => !x.positional && !x.hidden).map((x) => x.name)
        const c = closest(a, known.concat(GLOBAL_ARGS.map((g) => g.name)), 3)
        throw new WccError('usage', `Unknown flag ${a} for "wcc ${cmd.name}".`, c ? ctx.cmdline({ rename: [a, c] }) : `wcc ${cmd.name} --help`, { flag: a, suggestion: c, known })
      }
      if (d.type === 'boolean') {
        flags[d.name] = val === undefined ? true : !/^(false|0|no)$/i.test(val)
        continue
      }
      if (val === undefined) {
        if (i + 1 >= rest.length) throw new WccError('usage', `${d.name} needs a value (${d.type}).`, `wcc ${cmd.name} ${d.name} <${d.enum ? d.enum.join('|') : d.type}>`, { arg: d.name })
        val = rest[++i]
      }
      flags[d.name] = coerce(d, val, ctx)
    } else pos.push(a)
  }
  const posDecl = decl.filter((x) => x.positional)
  const variadic = posDecl.some((x) => /\[\]$/.test(x.type))
  if (!variadic && pos.length > Math.max(1, posDecl.length)) {
    throw new WccError('usage', `Too many arguments for "wcc ${cmd.name}": ${pos.slice(posDecl.length).join(' ')}.`, `wcc ${cmd.name} ${posDecl.map((p) => p.name).join(' ')}`.trim(), { extra: pos.slice(posDecl.length) })
  }
  return { flags, pos }
}

async function main(argv, io) {
  io = Object.assign({ env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }, io || {})
  const { globals, words, rest: rest0 } = parse(argv)
  let fmt = globals['--output'] || 'auto'
  const badFmt = !['auto', 'text', 'json', 'ndjson'].includes(fmt)
  if (badFmt) fmt = 'json'
  const mode = fmt === 'auto' ? (io.stdout.isTTY ? 'text' : 'json') : fmt
  const structured = mode === 'json' || mode === 'ndjson'
  const quiet = !!globals['--quiet']
  const logs = []
  const ctx = {
    io,
    version: VERSION,
    flags: {},
    pos: [],
    cmdname: 'wcc',
    schemaDoc,
    log: (msg, force) => {
      if (!quiet || force) io.stderr.write(`wcc: ${msg}\n`)
    },
    info: (msg) => {
      if (!quiet && io.stderr.isTTY) io.stderr.write(`wcc: ${msg}\n`)
    },
    warn: (ws) => {
      for (const w of ws || []) ctx.log(`warning: ${w.path ? w.path + ': ' : ''}${w.message}${w.hint ? ' (' + w.hint + ')' : ''}`)
    },
    cmdline: ({ add = [], replace = null, rename = null } = {}) => {
      const a = argv.slice()
      if (rename) {
        const i = a.findIndex((x) => x === rename[0] || x.startsWith(rename[0] + '='))
        if (i >= 0) a[i] = a[i].replace(rename[0], rename[1])
      }
      if (replace) {
        const i = a.findIndex((x) => x === replace[0] || x.startsWith(replace[0] + '='))
        if (i >= 0) {
          if (a[i].includes('=')) a[i] = `${replace[0]}=${replace[1]}`
          else a[i + 1] = replace[1]
        }
      }
      return ['wcc', ...a, ...add.filter((x) => !a.includes(x))].map(shq).join(' ')
    },
  }
  const fail = (err) => {
    const e = isWccError(err) ? err : toWccError(err)
    const env = e.toJSON()
    const cat = errorCatalog().find((c) => c.kind === e.kind)
    env.error.retryable = cat ? cat.retryable : false
    if (structured) io.stderr.write(JSON.stringify(env) + '\n')
    else io.stderr.write(`wcc: error: ${e.message}\n${e.hint ? `  hint: ${e.hint}\n` : ''}`)
    return e.exitCode
  }
  try {
    if (badFmt) throw new WccError('usage', `Invalid value "${globals['--output']}" for --output.`, ctx.cmdline({ replace: ['--output', 'json'] }).replace(/ -o \S+/, ' -o json'), { allowed: GLOBAL_ARGS[0].enum })
    if (globals['--version'] && !words.length) {
      io.stdout.write(structured ? JSON.stringify({ cli: VERSION, ...core.version }) + '\n' : `wcc ${VERSION}\n`)
      return 0
    }
    if (!words.length) {
      if (globals['--help'] || !argv.length) {
        if (globals['--help'] && structured && globals['--output']) io.stdout.write(JSON.stringify(schemaDoc('')) + '\n')
        else io.stdout.write(helpText())
        return argv.length ? 0 : 2
      }
      if (rest0.length) throw new WccError('usage', `Unknown flag ${rest0[0]}.`, 'wcc --help', { flag: rest0[0] })
    }
    const { cmd, rest } = resolveCommand(words, rest0)
    if (globals['--help']) {
      if (globals['--output'] && structured) io.stdout.write(JSON.stringify(schemaDoc(cmd.name)) + '\n')
      else io.stdout.write(helpText(cmd))
      return 0
    }
    const parsed = parseCommand(cmd, rest, ctx)
    ctx.flags = parsed.flags
    ctx.pos = parsed.pos
    ctx.cmdname = `wcc ${cmd.name}`
    if (io.env.WCC_TEST_INTERNAL_FAULT === '1') throw new Error('injected internal fault (WCC_TEST_INTERNAL_FAULT=1)')
    const res = await cmd.run(ctx)
    if (res.bytes) io.stdout.write(res.bytes)
    else if (res.data !== undefined) {
      let out
      if (mode === 'ndjson') out = res.data && Array.isArray(res.data.items) ? res.data.items.map((x) => JSON.stringify(x)).join('\n') + (res.data.items.length ? '\n' : '') : JSON.stringify(res.data) + '\n'
      else if (mode === 'json') out = JSON.stringify(res.data, null, io.stdout.isTTY ? 2 : 0) + '\n'
      else out = res.text !== undefined ? res.text : JSON.stringify(res.data, null, 2) + '\n'
      io.stdout.write(out)
    }
    if (res.error) return fail(res.error)
    return 0
  } catch (err) {
    return fail(err)
  }
}

module.exports = { main, schemaDoc, parse, VERSION }
