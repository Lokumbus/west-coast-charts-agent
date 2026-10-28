'use strict'
/* Smithery-compatible entry: default export createServer({ config }) + named configSchema. */
const { createServer } = require('./server')
const { configSchema, resolveConfig } = require('./config')

function smitheryCreateServer({ config } = {}) {
  return createServer({ config: resolveConfig({ overrides: config || {} }) }).server
}

module.exports = smitheryCreateServer
module.exports.default = smitheryCreateServer
module.exports.configSchema = configSchema
module.exports.createServer = createServer
module.exports.resolveConfig = resolveConfig
