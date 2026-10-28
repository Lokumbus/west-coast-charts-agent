'use strict'
const fs = require('fs'), path = require('path'), {isBuiltin} = require('module')
function checkPackageImports(stage) {
 const pkg = JSON.parse(fs.readFileSync(path.join(stage,'package.json'),'utf8'))
 const allowed = new Set([...Object.keys(pkg.dependencies||{}),...Object.keys(pkg.peerDependencies||{})])
 const found=[]
 function walk(dir) {for(const ent of fs.readdirSync(dir,{withFileTypes:true})) {
  const file=path.join(dir,ent.name)
  if(ent.isDirectory()) {walk(file);continue}
  if(!/\.[cm]?js$/.test(ent.name)) continue
  const text=fs.readFileSync(file,'utf8')
  if(/(?:require(?:\.resolve)?\s*\(|import\s*\(|from\s+)\s*['"`]@wcc-agent\//.test(text)) throw Error('Bare workspace import in '+path.relative(stage,file))
  for(const m of text.matchAll(/(?:require(?:\.resolve)?\s*\(|import\s*\(|from\s+)\s*['"]([^'"]+)['"]/g)) {
   const spec=m[1]
   if(spec.startsWith('.')) {if(!path.resolve(path.dirname(file),spec).startsWith(stage+path.sep)) throw Error('Relative import escapes package: '+spec);continue}
   if(isBuiltin(spec)) continue
   const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]
   if(!allowed.has(name)) throw Error('Undeclared package import '+spec+' in '+path.relative(stage,file))
   found.push({file:path.relative(stage,file),specifier:spec})
  }
 }}
 walk(path.join(stage,'packages'))
 return found
}
module.exports={checkPackageImports}
if(require.main===module) console.log(JSON.stringify(checkPackageImports(path.resolve(process.argv[2]))))
