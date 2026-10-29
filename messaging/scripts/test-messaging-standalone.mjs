// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {mkdtemp,mkdir,readFile,rm,cp,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'

const flag=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1]}
const self=fileURLToPath(import.meta.url),root=path.resolve(flag('--application-root')??path.resolve(path.dirname(self),'..'))
const {openHeadless}=await import(pathToFileURL(path.join(root,'packages/headless/src/client.ts')).href)
const {startMessaging}=await import(pathToFileURL(path.join(root,'scripts/serve-messaging.mjs')).href)
const {backupMessagingRelay}=await import(pathToFileURL(path.join(root,'scripts/messaging-storage.mjs')).href)

if(process.argv.includes('--child')){
  const app=await startMessaging({dataDir:flag('--data-dir'),releaseIndex:flag('--release-index')})
  process.send({type:'ready',referenceUrl:app.referenceUrl,agentUrl:app.agentUrl,relayUrl:app.relayUrl,deploymentId:app.deploymentId})
  let closing=false
  const stop=async()=>{if(closing)return;closing=true;await app.close();process.exit(0)}
  process.on('message',message=>{if(message==='stop')void stop()})
  process.once('disconnect',()=>void stop())
}else if(process.argv[1]&&path.resolve(process.argv[1])===self){
  console.log(JSON.stringify(await exerciseStandalone({releaseIndex:flag('--release-index')}),null,2))
}

async function startChild(dataDir,releaseIndex){
  const args=['--child','--application-root',root,'--data-dir',dataDir,...(releaseIndex?['--release-index',path.resolve(releaseIndex)]:[])]
  const child=fork(self,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
  let stderr=''
  child.stderr.on('data',bytes=>{stderr=(stderr+String(bytes)).slice(-8000)})
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Standalone startup timeout: '+stderr))},60000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Standalone exited ${code}: ${stderr}`))})
    child.once('message',message=>{clearTimeout(timer);resolve(message)})
  })
  assert.equal(ready.type,'ready')
  return{...ready,async close(){if(child.exitCode!==null)return;await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Standalone shutdown timeout: '+stderr))},15000)
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Standalone shutdown ${code}: ${stderr}`))})
    child.send('stop')
  })}}
}

export async function exerciseStandalone({releaseIndex}={}){
  const directory=await mkdtemp(path.join(tmpdir(),'endtoend-public-acceptance-'))
  const dataDir=path.join(directory,'state'),vaultDir=path.join(directory,'devices')
  await mkdir(vaultDir)
  let app,alice,bob
  const checks=[]
  const checked=(name)=>checks.push({name,passed:true})
  const stamp=randomBytes(5).toString('hex'),ah='sa'+stamp,bh='sb'+stamp,password='synthetic-only-'+stamp
  const devices={a:{vaultPath:path.join(vaultDir,'alice.json'),deviceKey:randomBytes(32).toString('base64')},b:{vaultPath:path.join(vaultDir,'bob.json'),deviceKey:randomBytes(32).toString('base64')}}
  const clients=relay=>{
    const options={relay,agentExecutable:process.execPath,agentArguments:[path.join(root,'packages/agent/src/cli.mjs')]}
    alice=openHeadless({...options,...devices.a});bob=openHeadless({...options,...devices.b})
  }
  const stop=async()=>{await alice?.close();await bob?.close();alice=bob=null;await app?.close();app=null}
  try{
    const invalid=path.join(directory,'invalid')
    await assert.rejects(()=>startMessaging({dataDir:invalid,referenceOrigin:'http://example.invalid'}),/HTTPS/)
    await assert.rejects(()=>access(invalid),{code:'ENOENT'})
    checked('invalid public configuration refuses before creating storage')
    app=await startChild(dataDir,releaseIndex)
    const deploymentId=app.deploymentId
    assert.equal((await fetch(app.referenceUrl)).status,200)
    const config=await (await fetch(app.referenceUrl+'/agent-config.json')).json()
    assert.equal(config.agentUrl,app.agentUrl)
    assert.notEqual(new URL(app.referenceUrl).origin,new URL(app.agentUrl).origin)
    await assert.rejects(()=>startMessaging({dataDir}),/already open/)
    checked('public reference, separate trusted origin and persistent single writer start')
    if(releaseIndex){
      const index=JSON.parse(await readFile(releaseIndex,'utf8'))
      const referenceRelease=await(await fetch(app.referenceUrl+'/release.json')).json()
      assert.equal(referenceRelease.sourceUrl,'/source/'+index.source.filename)
      assert.equal((await fetch(new URL(referenceRelease.sourceUrl,app.referenceUrl),{method:'HEAD'})).status,200)
      const source=await fetch(app.agentUrl+'/source/'+index.source.filename)
      assert.equal(source.status,200)
      assert.equal(createHash('sha256').update(Buffer.from(await source.arrayBuffer())).digest('hex'),index.source.sha256)
      checked('served source archive matches exact package index')
    }
    clients(app.relayUrl)
    const as=await alice.unlock({handle:ah,password}),bs=await bob.unlock({handle:bh,password})
    await alice.requestFriend(bh,'public synthetic note')
    assert.equal((await bob.requests())[0].note,'public synthetic note')
    await bob.respondRequest((await bob.requests())[0].id,'accept');await alice.sync()
    const direct=await alice.send({handle:bh,body:'before restart'})
    await bob.sync();assert.equal((await bob.messages()).find(m=>m.id===direct.id)?.body,'before restart')
    await alice.markVerified(bh)
    const safety=await alice.safetyNumber(bh)
    checked('independent executable agents register, accept contacts and exchange direct messages')
    const group=await alice.createGroup('public group',[bh])
    await bob.sync();await alice.sync()
    const groupBefore=await alice.sendGroup({groupId:group.id,body:'group before restart'})
    await bob.sync();assert.equal((await bob.messages()).find(m=>m.id===groupBefore.id)?.body,'group before restart')
    checked('real persistent relay supports encrypted groups')
    await bob.close();bob=null
    const bytes=Buffer.from([0,255,1,128,42,0,13,10]),fileInput={handle:bh,name:'restart.bin',mime:'application/octet-stream',base64:bytes.toString('base64'),body:'queued file'}
    const fileId=randomUUID(),file=await alice.sendFile(fileInput,fileId)
    const queued=await alice.send({handle:bh,body:'queued direct through restart'})
    const queuedGroup=await alice.sendGroup({groupId:group.id,body:'queued group through restart'})
    await stop()
    // No peer advances between this coordinated checkpoint and isolated recovery.
    const backup=path.join(directory,'relay-checkpoint')
    await backupMessagingRelay({dataDir,destination:backup,sourceRoot:root})
    const savedVaults=path.join(directory,'device-checkpoint')
    await cp(vaultDir,savedVaults,{recursive:true,errorOnExist:true,force:false})
    const recovery=path.join(directory,'recovered-state')
    await mkdir(recovery)
    await cp(path.join(dataDir,'messaging-state.json'),path.join(recovery,'messaging-state.json'),{errorOnExist:true,force:false})
    await cp(path.join(backup,'relay'),path.join(recovery,'relay'),{recursive:true,errorOnExist:true,force:false})
    // Original deployment remains stopped; use only its unadvanced matching vault set.
    devices.a.vaultPath=path.join(savedVaults,'alice.json');devices.b.vaultPath=path.join(savedVaults,'bob.json')
    app=await startChild(recovery,releaseIndex)
    assert.equal(app.deploymentId,deploymentId)
    clients(app.relayUrl)
    assert.equal((await alice.unlock({handle:ah,password})).accountId,as.accountId)
    assert.equal((await bob.unlock({handle:bh,password})).accountId,bs.accountId)
    const afterSafety=await alice.safetyNumber(bh)
    assert.equal(afterSafety.safetyNumber,safety.safetyNumber);assert.equal(afterSafety.verified,true)
    await bob.sync()
    let messages=await bob.messages()
    for(const expected of [direct,groupBefore,file,queued,queuedGroup])assert.equal(messages.filter(m=>m.id===expected.id).length,1)
    const attachment=(await bob.views()).messages.find(m=>m.id===fileId).attachments[0]
    assert.deepEqual(Buffer.from(await bob.attachment(attachment.mediaId)),bytes)
    checked('full process restart and isolated unadvanced checkpoint recovery preserve identities, groups, queues and exact attachment bytes')
    assert.equal((await alice.sendFile(fileInput,fileId)).id,fileId)
    await bob.sync();messages=await bob.messages()
    assert.equal(messages.filter(m=>m.id===fileId).length,1)
    checked('committed operation IDs and acknowledged messages do not duplicate after restart')
    const reply=await bob.send({handle:ah,body:'direct after restart',replyTo:queued.id})
    const groupReply=await bob.sendGroup({groupId:group.id,body:'group after restart'})
    await alice.sync()
    const received=await alice.messages()
    assert.equal(received.find(m=>m.id===reply.id).replyTo,queued.id)
    assert.equal(received.find(m=>m.id===groupReply.id).body,'group after restart')
    checked('existing direct and group ratchets continue after restart without key replacement')
    return{kind:'standalone-public-messaging-step-4-acceptance',checkedAt:new Date().toISOString(),sourceRoot:root,syntheticDataOnly:true,checks,passed:true,limitations:['Recovery is only a stopped, coordinated checkpoint with no intervening peer advancement; stale-vault recovery is unsupported.','Loopback ports are ephemeral. Stable HTTPS origins are required to preserve browser device storage across deployment restarts.']}
  }finally{
    await stop()
    assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('endtoend-public-acceptance-'))
    await rm(directory,{recursive:true,force:true})
  }
}
