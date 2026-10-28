'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path')
const {checkPackageImports}=require('./check-package-imports.cjs')
test('packaging rejects the previously missed io.js workspace import and undeclared dependencies',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wcc-import-guard-'))
 try {
 fs.mkdirSync(path.join(dir,'packages/cli/src'),{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({dependencies:{jsdom:'26.1.0'}}))
 const file=path.join(dir,'packages/cli/src/io.js')
 for(const source of ["require('@wcc-agent/render-core')","import('@wcc-agent/render-core')","require('undeclared-runtime')"]){fs.writeFileSync(file,source);assert.throws(()=>checkPackageImports(dir),/workspace import|Undeclared package/)}
 fs.writeFileSync(file,"require('node:fs'); require('../../render-core'); require('jsdom')");assert.equal(checkPackageImports(dir).length,1)
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
