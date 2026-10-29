#!/usr/bin/env node
'use strict'
// Determinism: dates are formatted in local time, so pin the zone before anything reads the clock.
process.env.TZ = 'UTC'
require('../src/main')
  .main(process.argv.slice(2), { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, env: process.env })
  .then((code) => {
    process.exitCode = code
  })
