#!/usr/bin/env node
'use strict'
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process')
const agent=process.argv[2], output=process.argv[3]
if(!agent||!output) throw Error('Usage: node scripts/test-isolated-install.cjs <agent-tgz-or-url> <proof-json>')
const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wcc-agent-isolated-')))
const home=path.join(dir,'home');fs.mkdirSync(home)
fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'isolated-agent-acceptance',private:true,version:'1.0.0'}))
for(const name of ['user.npmrc','global.npmrc']) fs.writeFileSync(path.join(dir,name),'')
const env={PATH:process.env.PATH,HOME:home,TMPDIR:os.tmpdir(),TZ:'UTC'}
const core='https://github.com/Lokumbus/west-coast-charts-core/releases/download/v1.1.1-rc.7/west-coast-charts-1.1.1-rc.7.tgz'
cp.execFileSync('npm',['install','--userconfig',path.join(dir,'user.npmrc'),'--globalconfig',path.join(dir,'global.npmrc'),'--registry','https://registry.npmjs.org','--ignore-scripts','--no-audit','--no-fund',core,/^https:\/\//.test(agent)?agent:path.resolve(agent)],{cwd:dir,env,stdio:['ignore','pipe','pipe']})
const script=path.join(dir,'test-installed.cjs');fs.copyFileSync(path.join(__dirname,'test-installed.cjs'),script)
cp.execFileSync(process.execPath,[script,dir],{cwd:dir,env,stdio:'inherit'})
const proof=JSON.parse(fs.readFileSync(path.join(dir,'acceptance.json')))
proof.directory=dir
proof.resolutionProcesses=fs.readdirSync(dir).filter(f=>/^resolution-\d+\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f))))
if(!proof.resolutionProcesses.length||proof.resolutionProcesses.some(p=>p.escaped||p.count<1)) throw Error('Module resolution audit missing')
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true})
fs.writeFileSync(output,JSON.stringify(proof,null,2)+'\n')
console.log(JSON.stringify({proof:path.resolve(output),directory:dir,guardedProcesses:proof.resolutionProcesses.length}))
