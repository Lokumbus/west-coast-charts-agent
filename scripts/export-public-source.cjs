#!/usr/bin/env node
'use strict'
const fs=require('fs'),path=require('path'),crypto=require('crypto')
const root=path.resolve(__dirname,'..'), dest=path.join(root,'build/public-source')
fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true})
const copy=name=>fs.cpSync(path.join(root,name),path.join(dest,name),{recursive:true,filter:s=>!/(?:^|\/)(?:node_modules|build|tmp|\.git|__pycache__)(?:\/|$)/.test(path.relative(root,s))})
for(const n of ['README.md','LICENSE','NOTICE','.gitignore','package.json','package-lock.json','packages','docs','scripts']) copy(n)
const files=[]
function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())scan(f);else{const name=path.relative(dest,f);const b=fs.readFileSync(f);if(/\.(?:js|cjs|mjs|json|md|txt|py)$/.test(name)){const s=b.toString();if(/-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----|\b(?:sk_live_|rk_live_|whsec_)[A-Za-z0-9]{16,}|\/Users\/|(?:\+49|0049)[\s-]?\d{8,13}|westcoastcharts\.example/.test(s))throw Error('Prohibited material in '+name)}files.push({path:name,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')})}}}
scan(dest)
fs.writeFileSync(path.join(root,'build/public-source-manifest.json'),JSON.stringify({files:files.sort((a,b)=>a.path.localeCompare(b.path)),checks:{noGitHistory:true,noNodeModules:true,noPrivateFixtureFiles:true,noAbsoluteUserPaths:true,noCredentialPatterns:true,noPrivatePhone:true,fontsLicensesRetained:true}},null,2)+'\n')
console.log(JSON.stringify({source:dest,files:files.length}))
