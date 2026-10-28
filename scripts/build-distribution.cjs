#!/usr/bin/env node
'use strict'
// Explicit allowlist: no runtime, private fixtures, developer paths or node_modules.
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const { execFileSync } = require('child_process')
const root = path.resolve(__dirname, '..'), out = path.join(root, 'build')
const stage = path.join(out, 'agent-package')
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
fs.mkdirSync(out, { recursive: true })
fs.rmSync(stage, { recursive: true, force: true })
fs.mkdirSync(stage)
const copy = name => fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true })
for (const name of ['README.md', 'LICENSE', 'NOTICE', 'docs']) copy(name)
for (const name of ['cli', 'mcp', 'render-core']) {
  for (const part of ['src', 'package.json', 'LICENSE']) copy(`packages/${name}/${part}`)
  if (name !== 'render-core') copy(`packages/${name}/bin`)
}
for (const name of ['packages/cli/skill', 'packages/mcp/docs', 'packages/render-core/examples']) copy(name)
for (const f of fs.readdirSync(path.join(root, 'packages/render-core/fonts'), {withFileTypes:true})) if(f.isFile()) copy('packages/render-core/fonts/' + f.name)
const deps = {}
const lock = require('../package-lock.json')
for (const name of ['mcp', 'render-core']) {
  for (const dep of Object.keys(require(`../packages/${name}/package.json`).dependencies)) {
    if (dep.startsWith('@wcc-agent/')) continue
    const version = lock.packages['node_modules/' + dep]?.version
    if (!version) throw Error('Unpinned public dependency: ' + dep)
    deps[dep] = version
  }
}
const pkg = {
  name: 'west-coast-charts-agent', version: '0.2.0', description: 'CLI and MCP tools for real West Coast Charts validation, SVG/PNG rendering and chart description.',
  license: 'MIT', author: 'West Coast Software, Inh. Peter Kannengießer',
  repository: { type: 'git', url: 'git+https://github.com/Lokumbus/west-coast-charts-agent.git' },
  homepage: 'https://westcoast-charts.com/agents/', engines: { node: '>=20' },
  bin: { wcc: 'packages/cli/bin/wcc.js', 'wcc-mcp': 'packages/mcp/bin/wcc-mcp.js' },
  main: 'packages/render-core/src/index.js',
  exports: { '.': './packages/render-core/src/index.js', './render-core': './packages/render-core/src/index.js', './package.json': './package.json' },
  dependencies: deps,
  peerDependencies: { 'west-coast-charts': '^1.1.1-rc.7' }, peerDependenciesMeta: { 'west-coast-charts': { optional: true } },
  files: ['packages/', 'docs/', 'README.md', 'LICENSE', 'NOTICE', 'SOURCE-PROVENANCE.json']
}
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
function files(dir, prefix = '') {
 return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name]).sort()
}
const records = files(stage).map(name => ({ path: name, sha256: sha(fs.readFileSync(path.join(stage, name))), bytes: fs.statSync(path.join(stage, name)).size }))
for (const record of records) {
 if (/(?:^|\/)(?:node_modules|tmp|\.git|\.env)(?:\/|$)|(?:\.pem|\.key|premium\.min\.js)$/.test(record.path)) throw Error('Forbidden packaged path: ' + record.path)
 const data = fs.readFileSync(path.join(stage, record.path))
 if (/\.(?:js|json|md|txt)$/.test(record.path) && /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----|\b(?:sk_live_|rk_live_|whsec_)[A-Za-z0-9]{16,}/.test(data.toString())) throw Error('Credential-shaped content: ' + record.path)
}
const provenance = {
 schema: 'wcc-agent-source/1', version: pkg.version,
 baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
 derivation: 'Audited 0.2.0 working-tree source; no history, runtime or private fixtures in archive.',
 library: { version: '1.1.1-rc.7', commit: 'a33451c1974cae377cc4584e5631669b62ea101a', url: 'https://github.com/Lokumbus/west-coast-charts-core/releases/download/v1.1.1-rc.7/west-coast-charts-1.1.1-rc.7.tgz', sha256: '3b2758567c9e30d0d50c1bd4a7c09933f315cf1b68308ad544ee0f574e8b9a7f' },
 files: records
}
fs.writeFileSync(path.join(stage, 'SOURCE-PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n')
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: stage, encoding: 'utf8' }))[0]
const tarball = path.join(out, packed.filename)
const result = { package: pkg.name, version: pkg.version, tarball, sha256: sha(fs.readFileSync(tarball)), bytes: fs.statSync(tarball).size, files: packed.files.map(f => f.path), runtimeBundled: false, premiumImplementationBundled: false, dependencyLicenses: Object.fromEntries(Object.keys(deps).map(n => [n, lock.packages['node_modules/' + n].license])) }
fs.writeFileSync(path.join(out, 'distribution.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ tarball, sha256: result.sha256, bytes: result.bytes, files: result.files.length }))
