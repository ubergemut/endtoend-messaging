// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {mkdtemp,rm,access} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {startMessaging} from './serve-messaging.mjs'
const root=fileURLToPath(new URL('..',import.meta.url))
async function directory(t){const dir=await mkdtemp(path.join(tmpdir(),'endtoend-hosted-controls-')),closers=[];t.after(async()=>{try{for(const close of closers.reverse())await close()}finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith('endtoend-hosted-controls-'));await rm(dir,{recursive:true,force:true})}});return {dir,onClose:close=>closers.push(close)}}
test('host brand is operator configuration while source notices and separate origins remain visible',async t=>{
 const fixture=await directory(t),dataDir=path.join(fixture.dir,'state')
 await assert.rejects(startMessaging({dataDir,brandName:'<img src=x>'}),/Brand name/);await assert.rejects(access(dataDir),{code:'ENOENT'})
 const service=await startMessaging({dataDir,brandName:'The Choice',callerOrigins:['https://example.test']});fixture.onClose(()=>service.close())
 const config=await(await fetch(service.agentUrl+'/config.json')).json()
 assert.equal(config.brandName,'The Choice');assert.ok(config.allowedCallerOrigins.includes('https://example.test'));assert.notEqual(service.agentUrl,service.referenceUrl)
 const page=await(await fetch(service.agentUrl)).text();assert.match(page,/id="agent-title"/);assert.match(page,/AGPL-3.0-only/);assert.match(page,/Copyright EndToEnd contributors/);assert.match(page,/id="source"/)
})
test('public CLI shuts down through owned IPC and reopens the same durable deployment',{timeout:30000},async t=>{
 const fixture=await directory(t),dataDir=path.join(fixture.dir,'state')
 const child=fork(path.join(root,'scripts/serve-messaging.mjs'),['--data-dir',dataDir,'--brand-name','The Choice'],{cwd:root,execArgv:['--import','tsx'],windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
 let stderr='';child.stderr.on('data',bytes=>{stderr=(stderr+String(bytes)).slice(-4000)})
 fixture.onClose(async()=>{if(child.exitCode===null&&!child.killed){child.kill();await new Promise(resolve=>child.once('exit',resolve))}})
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
 const ready=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('CLI did not become ready: '+stderr)),15000);child.once('exit',()=>{clearTimeout(timer);reject(Error('CLI exited before readiness: '+stderr))});child.stdout.on('data',bytes=>{text+=String(bytes);if(text.length>65536){clearTimeout(timer);reject(Error('CLI readiness is oversized'));return}for(const line of text.split('\n')){try{const value=JSON.parse(line);if(value.type==='endtoend-messaging-ready'){clearTimeout(timer);resolve(value)}}catch{}}})})
 const before=await(await fetch(ready.agentUrl+'/config.json')).json();assert.equal(before.brandName,'The Choice')
 child.send({type:'endtoend-shutdown',command:'unexpected'});await new Promise(resolve=>setTimeout(resolve,50));assert.equal(child.exitCode,null)
 child.send({type:'endtoend-shutdown'});assert.deepEqual(await exited,{code:0,signal:null})
 const reopened=await startMessaging({dataDir});try{assert.equal(reopened.deploymentId,ready.deploymentId);assert.equal((await(await fetch(reopened.agentUrl+'/config.json')).json()).brandName,'EndToEnd')}finally{await reopened.close()}
})
