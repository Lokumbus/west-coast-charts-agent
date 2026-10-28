#!/usr/bin/env node
'use strict'
// The old workspace bundler could accidentally include a complete Premium runtime.
// Only the audited single-package TGZ is a supported distribution in 0.2.0.
process.stderr.write('MCPB is not a supported release artifact. Build the audited TGZ with node scripts/build-distribution.cjs from the repository root, then configure its wcc-mcp stdio executable.\n')
process.exitCode = 1
