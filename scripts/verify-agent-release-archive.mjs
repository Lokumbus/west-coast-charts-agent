import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const descriptorPath = path.join(root, 'releases/west-coast-charts-agent-0.2.3.json')
const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'))
const archivePath = path.resolve(root, descriptor.archive)
const fail = (message) => { throw new Error(message) }
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

if (descriptor.schema !== 'wcc-npm-prepacked-release/1' || descriptor.name !== 'west-coast-charts-agent' || descriptor.version !== '0.2.3') fail('Unexpected release descriptor identity')
if (descriptor.archive !== 'releases/west-coast-charts-agent-0.2.3.tgz' || !archivePath.startsWith(`${root}${path.sep}`)) fail('Archive path is outside the pinned release location')
const archive = fs.readFileSync(archivePath)
if (archive.length !== descriptor.bytes || digest(archive) !== descriptor.sha256) fail('Release archive bytes or SHA-256 differ from the pinned descriptor')
if (archive.length > 20 * 1024 * 1024) fail('Release archive exceeds the 20 MiB verifier limit')

const list = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split(/\r?\n/).filter(Boolean)
if (list.length > 2000 || new Set(list).size !== list.length) fail('Archive has too many or duplicate entries')
for (const entry of list) {
  if (!entry.startsWith('package/') || entry.includes('\\') || entry.split('/').some((part) => part === '..' || part === '.')) fail(`Unsafe or unexpected archive path: ${entry}`)
  if (entry.includes('/node_modules/') || /(^|\/)(\.env|\.npmrc|\.git)(\/|$)/i.test(entry)) fail(`Forbidden release payload path: ${entry}`)
}
const readMember = (entry) => execFileSync('tar', ['-xOf', archivePath, entry], { maxBuffer: 16 * 1024 * 1024 })
const integrity = JSON.parse(readMember('package/INTEGRITY.json').toString('utf8'))
if (integrity.version !== descriptor.version || !Array.isArray(integrity.files)) fail('INTEGRITY.json does not match the release version')
const expected = new Set(['package/INTEGRITY.json'])
let totalBytes = 0
for (const item of integrity.files) {
  if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) fail('Malformed INTEGRITY.json entry')
  const entry = `package/${item.path}`
  if (expected.has(entry) || item.path.startsWith('/') || item.path.split('/').some((part) => part === '..' || part === '.')) fail(`Unsafe or duplicate integrity path: ${item.path}`)
  expected.add(entry)
  if (!list.includes(entry)) fail(`Integrity payload is absent from archive: ${item.path}`)
  const bytes = readMember(entry)
  totalBytes += bytes.length
  if (bytes.length > 8 * 1024 * 1024 || digest(bytes) !== item.sha256) fail(`Archive file hash/size check failed: ${item.path}`)
}
if (totalBytes > 20 * 1024 * 1024 || list.length !== expected.size || list.some((entry) => !expected.has(entry))) fail('Archive payload does not exactly match INTEGRITY.json')
const packageJson = JSON.parse(readMember('package/package.json').toString('utf8'))
if (packageJson.name !== descriptor.name || packageJson.version !== descriptor.version) fail('Packed package identity does not match descriptor')
const provenance = JSON.parse(readMember('package/SOURCE-PROVENANCE.json').toString('utf8'))
if (provenance.sourceCommit !== descriptor.sourceCommit || provenance.sourceTag !== descriptor.sourceTag || provenance.version !== descriptor.version) fail('Packed source provenance does not match descriptor')
if (provenance.library?.version !== descriptor.library.version || provenance.library?.commit !== descriptor.library.sourceCommit || provenance.library?.sha256 !== descriptor.library.archiveSha256 || provenance.library?.runtimeBundled !== false) fail('Packed Core peer provenance does not match descriptor')
if (JSON.stringify(packageJson.peerDependencies ?? {}) !== JSON.stringify(descriptor.peerDependencies)) fail('Packed root peer dependency does not match descriptor')
if (JSON.stringify(packageJson.peerDependenciesMeta ?? {}) !== JSON.stringify(descriptor.peerDependenciesMeta)) fail('Packed root peer metadata does not match descriptor')
for (const packagePath of ['package/packages/cli/package.json', 'package/packages/mcp/package.json', 'package/packages/render-core/package.json']) {
  const nested = JSON.parse(readMember(packagePath).toString('utf8'))
  if (nested.version !== descriptor.version) fail(`Nested package version mismatch: ${packagePath}`)
  if (nested.name === '@wcc-agent/render-core' && nested.peerDependencies?.['west-coast-charts'] !== descriptor.peerDependencies['west-coast-charts']) fail('Nested renderer peer dependency does not match descriptor')
}
console.log(JSON.stringify({ name: packageJson.name, version: packageJson.version, archive: descriptor.archive, sha256: descriptor.sha256, bytes: archive.length, payloadFiles: list.length, integrityEntries: integrity.files.length, peerDependencies: packageJson.peerDependencies }, null, 2))
