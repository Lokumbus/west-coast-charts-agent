#!/usr/bin/env node
'use strict'
const fs = require('fs'), path = require('path'), assert = require('assert/strict')
const { createRequire } = require('module'), { spawnSync } = require('child_process')
const dir = fs.realpathSync(path.resolve(process.argv[2] || ''))
if (!process.argv[2]) throw Error('Pass the fresh installation directory')
assert.ok(fs.realpathSync(dir).startsWith(fs.realpathSync(require('os').tmpdir()) + path.sep), 'Acceptance must run in the OS temporary directory')
for (let p = dir; p !== path.dirname(p); p = path.dirname(p)) assert.ok(!fs.existsSync(path.join(p, '.git')), 'Acceptance may not sit beneath a source repository')
const guardFile = path.join(dir, 'resolution-guard.cjs')
const modulesDir = fs.realpathSync(path.join(dir, 'node_modules'))
const guardSource = `'use strict'; const Module=require('module'),fs=require('fs'),path=require('path'); const original=Module._resolveFilename; let count=0; Module._resolveFilename=function(request,parent,isMain,...rest){const resolved=original.call(this,request,parent,isMain,...rest); if(!Module.isBuiltin(resolved) && !isMain && resolved!==__filename){const actual=fs.realpathSync(resolved); if(!actual.startsWith(${JSON.stringify(modulesDir + path.sep)})) throw Error('Resolution escaped isolated node_modules: '+request); count++;} return resolved;}; process.on('exit',()=>fs.writeFileSync(${JSON.stringify(path.join(dir,'resolution-'))}+process.pid+'.json',JSON.stringify({count,escaped:false})));`;
fs.writeFileSync(guardFile, guardSource)
require(guardFile)
const req = createRequire(path.join(dir, 'package.json'))
const agentRoot = path.dirname(req.resolve('west-coast-charts-agent/package.json'))
const libRoot = path.dirname(req.resolve('west-coast-charts/package.json'))
assert.ok(agentRoot.startsWith(dir + path.sep))
assert.ok(libRoot.startsWith(dir + path.sep))
const env = {PATH:process.env.PATH,HOME:path.join(dir,'home'),TMPDIR:require('os').tmpdir(),TZ:'UTC'}
const run = (bin, args) => {
 const r = spawnSync(process.execPath, ['--require',guardFile,path.join(agentRoot, 'packages', bin === 'wcc' ? 'cli' : 'mcp', 'bin', bin + '.js'), ...args], {cwd:dir,env,encoding:'utf8',maxBuffer:16*1024*1024,timeout:30000})
 if (r.error) throw r.error
 return r
}
;(async () => {
 const checks=[]
 for (const bin of ['wcc', 'wcc-mcp']) for (const arg of ['--help', '--version']) {assert.equal(run(bin,[arg]).status,0); checks.push(bin+' '+arg)}
 const version = JSON.parse(run('wcc',['version','--json']).stdout)
 assert.equal(version.lib,'1.1.1-rc.7')
 const v=run('wcc',['chart','validate','example:line-basic']); assert.equal(v.status,0);assert.equal(JSON.parse(v.stdout).validator,'e1')
 const svg=run('wcc',['chart','render','example:line-basic']);assert.equal(svg.status,0);assert.match(svg.stdout,/^<svg /)
 const table=run('wcc',['chart','table','example:line-basic']);assert.equal(table.status,0);assert.equal(JSON.parse(table.stdout).schema,'wcc-describe/1')
 const premium=run('wcc',['chart','render','example:quint-timeline']);assert.equal(premium.status,4)
 const missing=run('wcc',['chart','render','example:quint-timeline','--evaluation']);assert.equal(missing.status,3);assert.match(missing.stderr,/premium_runtime_missing/)
 checks.push('real RC7 validator/SVG/table', 'Premium key required', 'Core-only Premium module absence explicit')
 const cliPng = spawnSync(process.execPath,['--require',guardFile,path.join(agentRoot,'packages/cli/bin/wcc.js'),'chart','render','example:line-basic','--format','png'],{cwd:dir,env,timeout:30000});assert.equal(cliPng.status,0);assert.equal(cliPng.stdout.subarray(1,4).toString(),'PNG');checks.push('CLI PNG bytes')
 const core=req('west-coast-charts-agent')
 const png=await core.render(core.getExample('line-basic').spec,{format:'png'});assert.equal(png.png.subarray(1,4).toString(),'PNG');assert.equal(png.meta.tableSource,'describe');checks.push('native PNG with actual describe')
 const {Client}=req('@modelcontextprotocol/sdk/client/index.js')
 const {StdioClientTransport}=req('@modelcontextprotocol/sdk/client/stdio.js')
 const t=new StdioClientTransport({command:process.execPath,args:['--require',guardFile,path.join(agentRoot,'packages/mcp/bin/wcc-mcp.js')],env,stderr:'pipe'})
 const c=new Client({name:'fresh-public-install-test',version:'1'})
 try {
 await c.connect(t)
 assert.equal((await c.listTools()).tools.length,7)
 const spec={chart:{type:'bar'},series:[{name:'Revenue',data:[12,19,7]}],xaxis:{categories:['Q1','Q2','Q3']}}
 for (const name of ['validate_chart','render_chart','describe_chart']) {
 const r=await c.callTool({name,arguments:{spec}});assert.ok(!r.isError,r.content[0].text)
 if(name==='validate_chart') assert.equal(r.structuredContent.validator,'e1')
 else assert.equal(r.structuredContent.tableSource,'describe')
 }
 const docs=await c.listResources();assert.ok(docs.resources.some(r=>r.uri.includes('guide-agent')))
 checks.push('MCP stdio initialize/7 tools/real validate/render/describe/resources')
 } finally {await c.close()}
 const result={ok:true,library:version.lib,agent:req('west-coast-charts-agent/package.json').version,noRuntimeOverride:true,osTemporaryDirectory:true,moduleResolutionGuard:true,emptyHome:true,checks}
 fs.writeFileSync(path.join(dir,'acceptance.json'),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result,null,2))
})().catch(e=>{console.error(e);process.exitCode=1})
