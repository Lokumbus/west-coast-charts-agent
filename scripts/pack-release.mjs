#!/usr/bin/env node
/*
 * Copyright (c) 2026 WestCoast Software. MIT License.
 * Build the prepacked npm archive for the version in package.json from the committed tree.
 * Usage: node scripts/pack-release.mjs --library-tgz <west-coast-charts-x.y.z.tgz> --library-commit <sha> [--library-tag vX]
 * Local packaging only: this script never publishes, pushes or tags.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim()
const fail = (m) => { throw new Error(m) }

if (git('status', '--porcelain')) fail('Working tree is not clean; commit first so the archive binds an exact commit')
const sourceCommit = git('rev-parse', 'HEAD')
const srcPkgBytes = fs.readFileSync(path.join(root, 'package.json'))
const srcPkg = JSON.parse(srcPkgBytes)
const version = srcPkg.version
const libTgz = arg('--library-tgz') || fail('--library-tgz required')
const libBytes = fs.readFileSync(libTgz)
const libPkg = JSON.parse(execFileSync('tar', ['-xOzf', libTgz, 'package/package.json']))
const libIntegrity = execFileSync('tar', ['-xOzf', libTgz, 'package/INTEGRITY.json'])
const range = srcPkg.dependencies?.['west-coast-charts'] || fail('west-coast-charts dependency missing')

const stage = fs.mkdtempSync(path.join(os.tmpdir(), `wcc-agent-${version}-`))
const out = path.join(stage, 'package')
fs.mkdirSync(out)
const generated = new Set(['SOURCE-PROVENANCE.json', 'INTEGRITY.json'])
const files = srcPkg.files.filter((f) => !generated.has(f))
for (const f of files) {
  if (f.includes('*') || f.endsWith('/')) fail(`files entries must be explicit paths: ${f}`)
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true })
  fs.copyFileSync(path.join(root, f), path.join(out, f))
}
// distribution package.json: no workspaces, no private flag
const { workspaces, private: _p, ...distPkg } = srcPkg
const distPkgText = JSON.stringify(distPkg, null, 2) + '\n'
fs.writeFileSync(path.join(out, 'package.json'), distPkgText)

const prev = JSON.parse(fs.readFileSync(path.join(root, 'SOURCE-PROVENANCE.json'), 'utf8'))
const entry = (f) => { const b = fs.readFileSync(path.join(out, f)); return { path: f, bytes: b.length, sha256: sha(b) } }
const provenance = {
  ...prev,
  version,
  sourceCommit,
  sourceTag: null,
  buildKind: 'exact-commit-distribution',
  dependencyRange: range,
  library: {
    version: libPkg.version,
    commit: arg('--library-commit') || fail('--library-commit required'),
    tag: arg('--library-tag') || null,
    sha256: sha(libBytes),
    bytes: libBytes.length,
    manifestSha256: sha(libIntegrity),
    runtimeBundled: false,
    relation: 'regular dependency (not bundled); the listed version is the Core archive this release was verified against',
  },
  sourcePackageSha256: sha(srcPkgBytes),
  sourceLockSha256: sha(fs.readFileSync(path.join(root, 'package-lock.json'))),
  sourceFiles: files.map((f) => ({ ...entry(f), mode: '100644' })),
  transforms: [{ path: 'package.json', sourceSha256: sha(srcPkgBytes), sha256: sha(Buffer.from(distPkgText)), reason: 'Distribution package.json: workspaces removed; otherwise identical to the committed root package.json.' }],
  files: [...files, 'package.json'].map(entry),
}
delete provenance.peerDependencyRange
const lockLib = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages['node_modules/west-coast-charts']
if (lockLib) provenance.dependencies = { ...prev.dependencies, 'west-coast-charts': { version: lockLib.version, resolved: lockLib.resolved, integrity: lockLib.integrity, license: lockLib.license, note: 'lockfile resolution at packing time; consumers resolve the declared range' } }
fs.writeFileSync(path.join(out, 'SOURCE-PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n')
const integrity = { version, files: [...files, 'package.json', 'SOURCE-PROVENANCE.json'].map((f) => ({ path: f, sha256: entry(f).sha256 })) }
fs.writeFileSync(path.join(out, 'INTEGRITY.json'), JSON.stringify(integrity, null, 2) + '\n')

const packed = execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', path.join(root, 'releases')], { cwd: out, encoding: 'utf8' }).trim().split('\n').pop()
const archiveRel = `releases/${packed}`
const archive = fs.readFileSync(path.join(root, archiveRel))
const descriptor = {
  schema: 'wcc-npm-prepacked-release/1', name: srcPkg.name, version, archive: archiveRel,
  sha256: sha(archive), bytes: archive.length, sourceCommit, sourceTag: null,
  library: { version: provenance.library.version, sourceCommit: provenance.library.commit, archiveSha256: provenance.library.sha256 },
  dependencies: { 'west-coast-charts': range },
  peerDependencies: {}, peerDependenciesMeta: {},
  mcpName: srcPkg.mcpName, bin: srcPkg.bin,
  integrityFile: 'package/INTEGRITY.json',
}
fs.writeFileSync(path.join(root, `releases/${srcPkg.name}-${version}.json`), JSON.stringify(descriptor, null, 2) + '\n')
for (const f of ['SOURCE-PROVENANCE.json', 'INTEGRITY.json']) fs.copyFileSync(path.join(out, f), path.join(root, f))
fs.rmSync(stage, { recursive: true, force: true })
console.log(JSON.stringify({ archive: archiveRel, sha256: descriptor.sha256, bytes: descriptor.bytes, sourceCommit }, null, 2))
