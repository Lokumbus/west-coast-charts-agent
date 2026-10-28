#!/usr/bin/env node
'use strict'
/* Writes packaging/server-card.json (static copy of /.well-known/mcp/server-card.json) and
 * packaging/smithery/config-schema.json (JSON Schema with x-from for `smithery mcp publish --config-schema`). */
const fs = require('fs')
const path = require('path')
const { z } = require('zod/v4')
const { buildServerCard } = require('../src/card')
const { configSchema } = require('../src/config')

;(async () => {
  const dir = path.join(__dirname, '..', 'packaging')
  const card = await buildServerCard({ authRequired: process.argv.includes('--auth') })
  fs.writeFileSync(path.join(dir, 'server-card.json'), JSON.stringify(card, null, 2) + '\n')
  const cs = z.toJSONSchema(configSchema, { io: 'input' })
  delete cs.$schema
  const s = JSON.stringify(cs)
  if (s.length > 1024) throw new Error(`Smithery config schema is ${s.length} bytes, limit 1 KB`)
  fs.writeFileSync(path.join(dir, 'smithery', 'config-schema.json'), JSON.stringify(cs, null, 2) + '\n')
  const pkg = require('../package.json')
  const manifest = {
    manifest_version: '0.3',
    name: 'west-coast-charts',
    display_name: 'West Coast Charts',
    version: pkg.version,
    description: 'Render, validate and describe charts headlessly: SVG/PNG plus a verification table for agents.',
    long_description: pkg.description + '\n\nAll tools are read-only and deterministic; nothing is written to disk and no network is used. Premium chart types need a licence key.',
    author: { name: 'West Coast Software', url: 'https://westcoast-charts.com' },
    repository: { type: 'git', url: 'https://github.com/Lokumbus/west-coast-charts-agent.git' },
    homepage: 'https://westcoast-charts.com',
    documentation: 'https://westcoast-charts.com/agents/',
    support: 'https://github.com/Lokumbus/west-coast-charts-agent/issues',
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/bin/wcc-mcp.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/bin/wcc-mcp.js'],
        env: { WCC_LICENSE_KEY: '${user_config.license_key}', WCC_DEFAULT_THEME: '${user_config.default_theme}', WCC_EVALUATION: '${user_config.evaluation}' }
      }
    },
    tools: card.tools.map((t) => ({ name: t.name, description: t.title })),
    prompts: card.prompts.map((p) => ({ name: p.name, description: p.description, arguments: (p.arguments || []).map((a) => a.name), text: p.description + ' ' + (p.arguments || []).map((a) => `${a.name}: \${arguments.${a.name}}`).join(', ') })),
    tools_generated: false,
    prompts_generated: false,
    keywords: ['charts', 'svg', 'png', 'visualization', 'dashboard', 'apexcharts', 'data'],
    license: 'MIT',
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
    user_config: {
      license_key: { type: 'string', title: 'Licence key (Premium)', description: 'Only needed for premium chart types (sankey, chord, radialColumn, ...). Leave empty for free types.', sensitive: true, required: false },
      default_theme: { type: 'string', title: 'Default theme', description: 'light or dark, used when a spec sets no theme.mode.', default: 'light', required: false },
      evaluation: { type: 'boolean', title: 'Evaluation mode', description: 'Without a licence key, render premium chart types with an "unlicensed" watermark instead of failing.', default: false, required: false }
    }
  }
  fs.writeFileSync(path.join(dir, 'mcpb', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  process.stderr.write(`server-card.json: ${card.tools.length} tools, ${card.prompts.length} prompts; config-schema.json ${s.length} bytes\n`)
})().catch((e) => {
  process.stderr.write(String(e.stack || e) + '\n')
  process.exit(1)
})
