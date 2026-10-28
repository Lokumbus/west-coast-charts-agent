'use strict'
/* Registry packaging stays valid and in sync with the server definition. */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const Ajv = require('ajv')
const addFormats = require('ajv-formats')
const pkg = require('../package.json')
const serverJson = require('../packaging/server.json')
const { buildServerCard } = require('../src/card')
const { configSchema } = require('../src/config')
const { z } = require('zod/v4')

test('server.json validates against the official registry schema (2025-12-11)', () => {
  const ajv = new Ajv({ strict: false, allErrors: true })
  addFormats(ajv)
  const v = ajv.compile(require('./server.schema.2025-12-11.json'))
  assert.ok(v(serverJson), JSON.stringify(v.errors))
})

test('server.json is consistent with package.json (mcpName, version)', () => {
  assert.equal(serverJson.name, pkg.mcpName)
  assert.equal(serverJson.version, pkg.version)
  for (const p of serverJson.packages) assert.equal(p.version, pkg.version)
})

test('committed server-card.json matches the live definition (run npm run server-card)', async () => {
  const live = await buildServerCard({})
  const file = require('../packaging/server-card.json')
  assert.deepEqual(JSON.parse(JSON.stringify(live)), file)
})

test('Smithery config schema: flat, <= 20 fields, < 1 KB, secret via x-from header', () => {
  const js = z.toJSONSchema(configSchema, { io: 'input' })
  delete js.$schema
  assert.ok(JSON.stringify(js).length < 1024)
  assert.ok(Object.keys(js.properties).length <= 20)
  for (const p of Object.values(js.properties)) assert.ok(['string', 'number', 'integer', 'boolean'].includes(p.type))
  assert.deepEqual(js.properties.licenseKey['x-from'], { header: 'x-wcc-license-key' })
  assert.deepEqual(require('../packaging/smithery/config-schema.json'), JSON.parse(JSON.stringify(js)))
})

test('mcpb manifest lists exactly the live tools and prompts', async () => {
  const m = require('../packaging/mcpb/manifest.json')
  const card = await buildServerCard({})
  assert.equal(m.manifest_version, '0.3')
  assert.equal(m.version, pkg.version)
  assert.deepEqual(m.tools.map((t) => t.name).sort(), card.tools.map((t) => t.name).sort())
  assert.deepEqual(m.prompts.map((p) => p.name).sort(), card.prompts.map((p) => p.name).sort())
  assert.equal(m.user_config.license_key.sensitive, true)
  assert.equal(m.server.mcp_config.env.WCC_LICENSE_KEY, '${user_config.license_key}')
})
