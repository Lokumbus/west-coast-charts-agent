'use strict'
const { render, table, resolveLicenseKey, LICENSE_URL, RENDER_CORE_VERSION } = require('./render')
const { validate, validatorInfo } = require('./validate')
const { WccError, isWccError, toWccError, errorCatalog, closest } = require('./errors')
const { listTypes } = require('./types')
const { getSchema } = require('./schema')
const { listExamples, getExample } = require('./examples')
const { FONT_SET, FONT_SETS } = require('./fonts')
const { paths } = require('./lib')

module.exports = {
  render,
  table,
  resolveLicenseKey,
  FONT_SETS,
  validate: async (spec, opts) => validate(spec, opts),
  getSchema,
  listTypes,
  listExamples,
  getExample,
  errorCatalog,
  WccError,
  isWccError,
  toWccError,
  closest,
  LICENSE_URL,
  get version() {
    return { renderCore: RENDER_CORE_VERSION, lib: paths().version, fontSet: FONT_SET, fontSets: FONT_SETS, validator: validatorInfo().validator }
  },
}
