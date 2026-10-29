// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic acceptance only. Never imports an existing deployment or user vault.
import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {createServer,request as httpRequest} from 'node:http'
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,readFile,writeFile,rm,cp,readdir,lstat,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'

const self=fileURLToPath(import.meta.url)
const flag=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1]}
const sourceRoot=path.resolve(flag('--source-root')??path.resolve(path.dirname(self),'..'))
const runtimeRoot=path.resolve(flag('--runtime-root')??sourceRoot)
const rollbackRoot=flag('--rollback-root')&&path.resolve(flag('--rollback-root'))
const imported=relative=>import(pathToFileURL(path.join(sourceRoot,relative)).href)
const {openHeadless}=await imported('packages/headless/src/client.ts')
const {openSealedVault,isSealedRecord,isSealedBlob}=await imported('packages/session/src/atRest.ts')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
// Rust maps are emitted as arrays whose order can change on reserialization.
// Compare all exact key/ratchet bytes as a canonical multiset, without logging them.
const canonical=value=>Array.isArray(value)?value.map(canonical).sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
const storeHash=store=>hash(JSON.stringify(canonical(JSON.parse(store))))
function sameStore(actual,expected,message){
  const left=JSON.parse(actual),right=JSON.parse(expected)
  const changed=Object.keys(right).filter(key=>hash(JSON.stringify(canonical(left[key])))!==hash(JSON.stringify(canonical(right[key]))))
  assert.equal(storeHash(actual),storeHash(expected),message+'; changed sections: '+changed.join(', '))
}

if(process.argv.includes('--child')){
  const applicationRoot=path.resolve(flag('--child-root')??runtimeRoot)
  const {startMessaging}=await import(pathToFileURL(path.join(applicationRoot,'scripts/serve-messaging.mjs')).href)
  try{
    const app=await startMessaging({sourceRoot:applicationRoot,dataDir:flag('--data-dir'),
      ...(flag('--reference-dist')?{referenceDist:flag('--reference-dist')}:{})})
    process.send({type:'ready',referenceUrl:app.referenceUrl,relayUrl:app.relayUrl,deploymentId:app.deploymentId})
    let closing=false
    const stop=async()=>{if(closing)return;closing=true;await app.close();process.exit(0)}
    process.on('message',message=>{if(message==='stop')void stop()})
    process.once('disconnect',()=>void stop())
  }catch(error){process.send({type:'refused',message:error.message});process.exitCode=1;process.disconnect()}
}else if(process.argv[1]&&path.resolve(process.argv[1])===self){
  const result=await exerciseDurability()
  if(flag('--receipt'))await writeFile(path.resolve(flag('--receipt')),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
}

async function startChild(dataDir,{applicationRoot=runtimeRoot,referenceDist,refused=false}={}){
  const child=fork(self,['--child','--source-root',sourceRoot,'--runtime-root',runtimeRoot,'--child-root',applicationRoot,'--data-dir',dataDir,
    ...(referenceDist?['--reference-dist',referenceDist]:[])],{cwd:applicationRoot,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']})
  let stderr=''
  child.stderr.on('data',bytes=>{stderr=(stderr+String(bytes)).slice(-4000)})
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Durability relay startup timeout: '+stderr))},60_000)
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Durability relay exited ${code}: ${stderr}`))})
    child.once('message',message=>{clearTimeout(timer);resolve(message)})
  })
  if(refused){assert.equal(ready.type,'refused');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));return ready}
  if(ready.type!=='ready')throw new Error('Relay unexpectedly refused: '+ready.message)
  return{...ready,async close(){if(child.exitCode!==null)return;await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('Durability relay shutdown timeout: '+stderr))},15_000)
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`Relay shutdown ${code}: ${stderr}`))})
    child.send('stop')
  })}}
}

// The bound socket lives across relay restarts. No free-port probe/rebind is used.
// Faults either reject before relay commit, or discard a real successful response.
async function faultProxy(){
  const records=[],sockets=new Set()
  let target=null,fault=null,authorization='',heldInbox=false
  const server=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk))
      const body=Buffer.concat(chunks).toString('utf8'),pathname=new URL(req.url,'http://127.0.0.1').pathname
      if(req.headers.authorization)authorization=req.headers.authorization
      const entry={path:pathname,method:req.method,body,authorization:req.headers.authorization,status:null}
      // Delivery receipts are independent incoming ratchet advances. Hold their
      // delivery during the exact-state restart comparison, then release them.
      if(heldInbox&&req.method==='GET'&&pathname==='/api/envelopes'){
        res.writeHead(200,{'content-type':'application/json'}).end('{"envelopes":[]}');return
      }
      if(req.method==='POST'&&['/api/envelopes','/api/envelopes/ack','/api/media'].includes(pathname))records.push(entry)
      const applied=fault?.matches(entry)?fault:null
      if(applied?.once)fault=null
      if(applied?.mode==='before'){entry.status=503;res.writeHead(503,{'content-type':'application/json'}).end('{"error":"synthetic offline before commit"}');return}
      assert(target,'Fault proxy has no relay target')
      const url=new URL(req.url,target)
      const headers={...req.headers,host:url.host};delete headers.connection
      await new Promise((resolve,reject)=>{
        const upstream=httpRequest(url,{method:req.method,headers},response=>{
          entry.status=response.statusCode
          const responseChunks=[]
          response.on('data',bytes=>responseChunks.push(bytes))
          response.on('end',()=>{
            const bytes=Buffer.concat(responseChunks)
            entry.response=bytes.toString('utf8')
            if(applied?.mode==='after'){
              assert.equal(response.statusCode,200,'Lost-response fault requires real successful relay commit')
              res.destroy();resolve();return
            }
            res.writeHead(response.statusCode,response.headers).end(bytes);resolve()
          });response.on('error',reject)
        });upstream.on('error',reject);upstream.end(body||undefined)
      })
    }catch(error){if(!res.destroyed&&!res.headersSent)res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({error:error.message}));else res.destroy()}
  })
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve()})})
  return{url:`http://127.0.0.1:${server.address().port}`,records,setTarget(value){target=value},
    arm(mode,matches,once=true){assert.equal(fault,null);fault={mode,matches,once}},clear(){fault=null},
    holdInbox(value){heldInbox=value},
    get authorization(){return authorization},
    async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}}
}

async function inventory(directory,prefix=''){
  const files=[]
  for(const name of (await readdir(path.join(directory,prefix))).sort()){
    const relative=prefix?prefix+'/'+name:name,file=path.join(directory,relative),stat=await lstat(file)
    assert.equal(stat.isSymbolicLink(),false,'Synthetic checkpoint must not contain symlinks/junctions')
    if(stat.isDirectory())files.push(...await inventory(directory,relative))
    else{assert(stat.isFile());files.push({path:relative,bytes:stat.size,sha256:hash(await readFile(file))})}
  }
  return files
}

export async function exerciseDurability(){
  const directory=await mkdtemp(path.join(tmpdir(),'endtoend-durability-'))
  const checks=[],checked=(name,evidence={})=>{checks.push({name,passed:true,...evidence});process.stderr.write(`PASS ${name}\n`)}
  let dataDir=path.join(directory,'state'),deviceDir=path.join(directory,'devices'),app
  const proxies=await Promise.all([faultProxy(),faultProxy(),faultProxy()])
  const stamp=randomBytes(5).toString('hex'),password='synthetic-only-'+stamp
  const handles=['da','db','dc'].map(prefix=>prefix+stamp)
  const devices=handles.map((handle,index)=>({handle,index,vaultPath:path.join(deviceDir,`${index}.json`),deviceKey:randomBytes(32).toString('base64'),client:null}))
  const open=index=>{const device=devices[index];device.client=openHeadless({relay:proxies[index].url,vaultPath:device.vaultPath,deviceKey:device.deviceKey,
    agentExecutable:process.execPath,agentArguments:[path.join(runtimeRoot,'packages/agent/src/cli.mjs')]});return device.client}
  // AgentClient.close() terminates its child transport. Request the public
  // close operation first so Windows also flushes and releases the vault lease.
  const closeAgents=async()=>{for(const device of devices){if(device.client){await device.client.call('close');await device.client.close();device.client=null}}}
  const stop=async()=>{await closeAgents();await app?.close();app=null}
  const start=async options=>{app=await startChild(dataDir,options);for(const proxy of proxies)proxy.setTarget(app.relayUrl);return app}
  const unlock=async index=>{const client=devices[index].client??open(index);return client.unlock({handle:handles[index],password})}
  const vault=async index=>{const raw=await readFile(devices[index].vaultPath,'utf8'),record=JSON.parse(raw);assert(isSealedRecord(record));
    return(await openSealedVault(devices[index].deviceKey,record)).vault}
  const queue=async index=>(await(await fetch(proxies[index].url+'/api/envelopes',{headers:{authorization:proxies[index].authorization}})).json()).envelopes
  const allSync=async()=>{for(let round=0;round<3;round++)for(const device of devices)await device.client.sync()}
  const connect=async(left,right)=>{await devices[left].client.requestFriend(handles[right],'synthetic durability note');const request=(await devices[right].client.requests()).find(item=>item.direction==='incoming'&&item.status==='pending');assert(request);await devices[right].client.respondRequest(request.id,'accept');await devices[left].client.sync()}
  const snapshot=async name=>{
    const checkpoint=path.join(directory,name);await mkdir(checkpoint)
    await cp(dataDir,path.join(checkpoint,'state'),{recursive:true,errorOnExist:true,force:false})
    await cp(deviceDir,path.join(checkpoint,'devices'),{recursive:true,errorOnExist:true,force:false})
    const manifest=await inventory(checkpoint)
    const locks=manifest.filter(file=>/\.lock(?:\.reclaim)?$/.test(file.path)).map(file=>file.path)
    assert.equal(locks.length,0,'Every writer must be closed before checkpoint: '+locks.join(', '))
    await writeFile(path.join(checkpoint,'CHECKPOINT.json'),JSON.stringify({kind:'synthetic-coordinated-checkpoint',formatVersion:1,participants:3,files:manifest}))
    return{checkpoint,manifest}
  }
  let result
  try{
    await mkdir(deviceDir)
    // Construct actual migration-1 state, rather than editing a current ledger downwards.
    const {SCHEMA,CURRENT_SCHEMA_VERSION,readDatabaseSchemaVersion,openDatabase}=await imported('apps/api/src/db.ts')
    const require=createRequire(path.join(sourceRoot,'package.json'))
    const {PGlite}=await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href)
    const migrationDir=path.join(directory,'migration-state')
    const {openMessagingState}=await imported('scripts/messaging-state.mjs')
    const state=await openMessagingState(migrationDir,{sourceRoot})
    const legacy=new PGlite(state.relayDataDir)
    try{
      await legacy.waitReady;await legacy.exec(SCHEMA)
      await legacy.exec(`CREATE TABLE messaging_schema_migrations(version integer PRIMARY KEY CHECK(version>0),name text NOT NULL,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`)
      await legacy.query('INSERT INTO messaging_schema_migrations(version,name,checksum) VALUES(1,$1,$2)',['adopt-existing-relay-schema',hash(SCHEMA)])
      await legacy.exec(`INSERT INTO accounts(id,handle,display_name,password_hash) VALUES('upgrade-a','upgrade-a','Synthetic A','synthetic-hash-a'),('upgrade-b','upgrade-b','Synthetic B','synthetic-hash-b');
        INSERT INTO sessions(token_hash,account_id) VALUES('synthetic-session','upgrade-a');
        INSERT INTO groups(id,metadata_ciphertext,epoch) VALUES('upgrade-group','synthetic-encrypted-group',3);
        INSERT INTO group_members(group_id,account_id) VALUES('upgrade-group','upgrade-a'),('upgrade-group','upgrade-b');
        INSERT INTO envelopes(id,recipient_account_id,ciphertext,queue_tag,group_id,group_epoch) VALUES('upgrade-envelope','upgrade-b','synthetic-ciphertext','upgrade-tag','upgrade-group',3);
        INSERT INTO envelope_attempts(recipient_account_id,queue_tag,id,payload_hash) VALUES('upgrade-b','upgrade-tag','upgrade-envelope','synthetic-payload-hash'),('upgrade-b','ack-tag','acked-envelope','synthetic-ack-hash');
        INSERT INTO media(id,ciphertext,recipient_account_id) VALUES('upgrade-media','synthetic-encrypted-file','upgrade-b')`)
      assert.equal((await legacy.query('SELECT MAX(version) AS version FROM messaging_schema_migrations')).rows[0].version,1)
    }finally{await legacy.close();await state.close()}
    const upgraded=await startChild(migrationDir);await upgraded.close()
    const db=await openDatabase(undefined,path.join(migrationDir,'relay'))
    try{
      assert.equal(CURRENT_SCHEMA_VERSION,2);assert.equal(await readDatabaseSchemaVersion(db),2)
      assert.deepEqual(await db.query('SELECT version FROM messaging_schema_migrations ORDER BY version'),[{version:1},{version:2}])
      assert.deepEqual(await db.query('SELECT ciphertext,queue_tag,group_epoch FROM envelopes'),[{ciphertext:'synthetic-ciphertext',queue_tag:'upgrade-tag',group_epoch:3}])
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM envelope_attempts'))[0].count,2)
      assert.equal((await db.query('SELECT ciphertext FROM media'))[0].ciphertext,'synthetic-encrypted-file')
      assert.equal((await db.query('SELECT epoch FROM groups'))[0].epoch,3)
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM accounts'))[0].count,2)
      assert.equal((await db.query('SELECT account_id,audience,scope FROM sessions'))[0].account_id,'upgrade-a')
      assert.equal((await db.query('SELECT audience,scope FROM sessions'))[0].audience,null)
      await db.query(`INSERT INTO messaging_schema_migrations(version,name,checksum) VALUES(999,'synthetic-future','synthetic-future-checksum')`)
    }finally{await db.close()}
    const future=await startChild(migrationDir,{refused:true});assert.match(future.message,/newer than supported/)
    checked('real PGlite schema 1 upgrades to 2 preserving queued ciphertext, media, groups, accounts, sessions and ACK tombstones; future schema refuses')

    await start();const deploymentId=app.deploymentId
    const statuses=[];for(let index=0;index<3;index++)statuses.push(await unlock(index))
    await connect(0,1);await connect(0,2);await connect(1,2)
    let [alice,bob,carol]=devices.map(device=>device.client)
    const direct=await alice.send({handle:handles[1],body:'durability before restart'})
    await bob.sync();await alice.markVerified(handles[1]);await alice.markVerified(handles[2])
    const safety=await alice.safetyNumber(handles[1])
    const group=await alice.createGroup('Synthetic durability group',[handles[1],handles[2]])
    await allSync()
    const groupMessage=await alice.sendGroup({groupId:group.id,body:'group before restart'})
    await allSync()
    checked('real child agents establish direct/group sessions and verified identity on persistent managed relay')

    await alice.close();devices[0].client=null
    const beforeWrong=await readFile(devices[0].vaultPath)
    const wrong=openHeadless({relay:proxies[0].url,vaultPath:devices[0].vaultPath,deviceKey:randomBytes(32).toString('base64'),agentExecutable:process.execPath,agentArguments:[path.join(runtimeRoot,'packages/agent/src/cli.mjs')]})
    try{await assert.rejects(wrong.unlock({handle:handles[0],password}),error=>error.code==='device-key')}finally{await wrong.close()}
    assert.deepEqual(await readFile(devices[0].vaultPath),beforeWrong)
    alice=open(0);await unlock(0)
    const duplicate=openHeadless({relay:proxies[0].url,vaultPath:devices[0].vaultPath,deviceKey:devices[0].deviceKey,agentExecutable:process.execPath,agentArguments:[path.join(runtimeRoot,'packages/agent/src/cli.mjs')]})
    try{await assert.rejects(duplicate.status(),/already open/)}finally{await duplicate.close()}
    await assert.rejects(alice.unlock({handle:handles[1],password}),error=>error.code==='replace-keys');await unlock(0)
    checked('wrong device secret, concurrent vault writer and cross-account vault reuse refuse without replacing identity')

    const bytes=Buffer.from([0,255,1,128,42,0,13,10,254]),fileId=randomUUID()
    const fileInput={handle:handles[1],name:'durability.bin',mime:'application/octet-stream',base64:bytes.toString('base64'),body:'stable encrypted file retry',replyTo:direct.id,expiresInSeconds:3600}
    proxies[0].arm('after',entry=>entry.method==='POST'&&entry.path==='/api/media')
    await assert.rejects(alice.sendFile(fileInput,fileId),/fetch|relay|unreachable/i)
    const pendingFile=(await vault(0)).sendAttempts.find(item=>item.id===fileId)
    assert(pendingFile&&!pendingFile.completed);assert.equal(pendingFile.uploads.length,1)
    const firstUpload=proxies[0].records.findLast(entry=>entry.path==='/api/media')
    await stop();await start();for(let index=0;index<3;index++)await unlock(index)
    ;[alice,bob,carol]=devices.map(device=>device.client)
    assert((await alice.pendingSends()).some(item=>item.operationId===fileId))
    const file=await alice.sendFile(fileInput,fileId);await bob.sync()
    const uploads=proxies[0].records.filter(entry=>entry.path==='/api/media'&&JSON.parse(entry.body).id===pendingFile.uploads[0].id)
    assert.equal(uploads.length,2);assert.equal(uploads[0].body,uploads[1].body);assert.equal(firstUpload.status,200)
    const fileView=(await bob.views()).messages.find(message=>message.id===file.id)
    assert.equal(fileView.replyTo,direct.id);assert.equal(fileView.expiresAt,pendingFile.expiresAt)
    assert.deepEqual(Buffer.from(await bob.attachment(fileView.attachments[0].mediaId)),bytes)
    const blob=JSON.parse(await readFile(path.join(devices[1].vaultPath+'.blobs',fileView.attachments[0].mediaId),'utf8'))
    assert(isSealedBlob(blob));assert.notEqual(blob.ciphertext,bytes.toString('base64'))
    assert.equal((await readFile(devices[0].vaultPath,'utf8')).includes(fileInput.body),false)
    checked('lost committed upload response survives agent/relay restart with identical media ID/ciphertext, sealed intent/blob, exact file bytes, reply and timer',{uploadSha256:hash(uploads[0].body),attachmentSha256:hash(bytes)})

    const interrupted=async label=>{
      await allSync()
      const operationId=randomUUID(),input={handle:handles[1],body:label}
      const offset=proxies[0].records.length
      proxies[0].arm('after',entry=>entry.method==='POST'&&entry.path==='/api/envelopes'&&!JSON.parse(entry.body).groupId)
      await assert.rejects(devices[0].client.send(input,operationId),/fetch|relay|unreachable/i)
      const send=proxies[0].records.slice(offset).find(entry=>entry.path==='/api/envelopes')
      assert.equal(send.status,200)
      proxies[1].arm('after',entry=>entry.method==='POST'&&entry.path==='/api/envelopes/ack')
      await assert.rejects(devices[1].client.sync(),/fetch|relay|unreachable/i)
      const left=await vault(0),right=await vault(1),outbox=left.outbox.find(item=>item.messageId===operationId)
      assert(outbox);assert(right.pendingAcks.length);assert(left.sendAttempts.some(item=>item.id===operationId&&!item.completed))
      assert.equal(right.messages.filter(item=>item.id===operationId).length,1)
      proxies[0].holdInbox(true)
      return{operationId,input,send,left,right,outbox,ack:proxies[1].records.findLast(entry=>entry.path==='/api/envelopes/ack')}
    }
    const interruptedSend=await interrupted('lost send and ACK before compatible application rollback')
    await stop()
    const currentVaultBytes=await Promise.all(devices.map(device=>readFile(device.vaultPath)))
    if(rollbackRoot){
      const oldRefusal=await startChild(dataDir,{applicationRoot:rollbackRoot,refused:true})
      assert.match(oldRefusal.message,/newer than supported|Unsupported.*version|schema.*newer/i)
      for(let index=0;index<3;index++)assert.deepEqual(await readFile(devices[index].vaultPath),currentVaultBytes[index])
      checked('actual older incompatible application refuses the current schema without touching device vaults',{rollbackRoot})
    }
    const previousPresentation=path.join(directory,'previous-compatible-presentation')
    await cp(path.join(runtimeRoot,'apps/messaging-reference/dist'),previousPresentation,{recursive:true,errorOnExist:true,force:false})
    await writeFile(path.join(previousPresentation,'rollback-rehearsal.txt'),'synthetic prior presentation, current compatible relay and agent\n')
    await start({referenceDist:previousPresentation})
    assert.equal(await(await fetch(app.referenceUrl+'/rollback-rehearsal.txt')).text(),'synthetic prior presentation, current compatible relay and agent\n')
    assert.equal(app.deploymentId,deploymentId)
    for(let index=0;index<3;index++)assert.deepEqual(await readFile(devices[index].vaultPath),currentVaultBytes[index])
    for(let index=0;index<3;index++)await unlock(index)
    ;[alice,bob,carol]=devices.map(device=>device.client)
    sameStore((await vault(0)).store,interruptedSend.left.store,'Retrying committed ciphertext must not advance sender ratchet again')
    sameStore((await vault(1)).store,interruptedSend.right.store,'Retrying committed ACK must not decrypt/advance recipient again')
    proxies[0].holdInbox(false)
    assert((await alice.pendingSends()).some(item=>item.operationId===interruptedSend.operationId),'Committed user intent survives rollback before explicit completion')
    await alice.send(interruptedSend.input,interruptedSend.operationId)
    const retried=proxies[0].records.filter(entry=>entry.path==='/api/envelopes'&&entry.body===interruptedSend.send.body)
    assert.equal(retried.length,2);assert.equal(retried[0].response,retried[1].response)
    assert.equal(proxies[1].records.findLast(entry=>entry.path==='/api/envelopes/ack').body,interruptedSend.ack.body)
    assert.equal((await vault(1)).pendingAcks.length,0);assert.equal((await vault(0)).outbox.length,0)
    assert.equal((await bob.messages()).filter(message=>message.id===interruptedSend.operationId).length,1)
    assert.deepEqual(await alice.safetyNumber(handles[1]),safety)
    const replay=await fetch(proxies[0].url+'/api/envelopes',{method:'POST',headers:{authorization:proxies[0].authorization,'content-type':'application/json'},body:interruptedSend.send.body})
    assert.equal(replay.status,200);assert.equal(await replay.text(),interruptedSend.send.response)
    assert.equal((await queue(1)).length,0)
    const conflict=JSON.parse(interruptedSend.send.body);conflict.ciphertext+='changed'
    assert.equal((await fetch(proxies[0].url+'/api/envelopes',{method:'POST',headers:{authorization:proxies[0].authorization,'content-type':'application/json'},body:JSON.stringify(conflict)})).status,409)
    await bob.sync();assert.equal((await bob.messages()).filter(message=>message.id===interruptedSend.operationId).length,1)
    checked('compatible application rollback keeps current sealed ratchets/outbox/ACKs; retries use identical envelope/tag and tombstones prevent acknowledged replay',{envelopeSha256:hash(interruptedSend.send.body),rollbackScope:'Prior presentation copy with current schema-compatible backend/agents; no historical compatible backend is claimed'})

    const checkpointPending=await interrupted('pending intent at matched offline recovery checkpoint')
    await stop()
    const saved=await snapshot('coordinated-checkpoint')
    const restored=path.join(directory,'isolated-recovery');await mkdir(restored)
    await cp(path.join(saved.checkpoint,'state'),path.join(restored,'state'),{recursive:true,errorOnExist:true,force:false})
    await cp(path.join(saved.checkpoint,'devices'),path.join(restored,'devices'),{recursive:true,errorOnExist:true,force:false})
    assert.deepEqual(await inventory(restored),saved.manifest)
    dataDir=path.join(restored,'state');deviceDir=path.join(restored,'devices')
    for(const device of devices)device.vaultPath=path.join(deviceDir,`${device.index}.json`)
    await start();assert.equal(app.deploymentId,deploymentId)
    for(let index=0;index<3;index++)assert.equal((await unlock(index)).accountId,statuses[index].accountId)
    ;[alice,bob,carol]=devices.map(device=>device.client)
    sameStore((await vault(0)).store,checkpointPending.left.store,'Matched recovery keeps sender ratchet')
    sameStore((await vault(1)).store,checkpointPending.right.store,'Matched recovery keeps recipient ratchet')
    proxies[0].holdInbox(false)
    assert((await alice.pendingSends()).some(item=>item.operationId===checkpointPending.operationId))
    await alice.retryPending();await bob.sync()
    assert.equal((await alice.pendingSends()).length,0)
    for(const id of [direct.id,groupMessage.id,file.id,interruptedSend.operationId,checkpointPending.operationId])assert.equal((await bob.messages()).filter(message=>message.id===id).length,1)
    assert.deepEqual(Buffer.from(await bob.attachment(fileView.attachments[0].mediaId)),bytes)
    const recoveryRetries=proxies[0].records.filter(entry=>entry.path==='/api/envelopes'&&entry.body===checkpointPending.send.body)
    assert.equal(recoveryRetries.length,2)
    assert.equal((await queue(1)).length,0)
    const nextDirect=await bob.send({handle:handles[0],body:'ratchet continues after coordinated recovery',replyTo:checkpointPending.operationId})
    const nextGroup=await bob.sendGroup({groupId:group.id,body:'group ratchet continues after coordinated recovery'})
    await alice.sync();assert.equal((await alice.messages()).find(message=>message.id===nextDirect.id).replyTo,checkpointPending.operationId)
    assert.equal((await alice.messages()).find(message=>message.id===nextGroup.id).body,'group ratchet continues after coordinated recovery')
    checked('matched stopped checkpoint restores all vaults/blobs and real PGlite without pending loss, ratchet rollback or duplicate ACKed messages',{checkpointFiles:saved.manifest.length,checkpointManifestSha256:hash(JSON.stringify(saved.manifest)),pendingEnvelopeSha256:hash(checkpointPending.send.body),constraint:'All three synthetic participants stopped; original deployment never restarted or advanced after checkpoint'})

    await allSync()
    const groupBefore=(await vault(0)).groups[group.id],oldOperation=randomUUID()
    proxies[0].arm('before',entry=>entry.method==='POST'&&entry.path==='/api/envelopes'&&JSON.parse(entry.body).groupId===group.id,false)
    await assert.rejects(alice.sendGroup({groupId:group.id,body:'retained old membership intent'},oldOperation),/503|offline|relay/i)
    const oldItems=(await vault(0)).outbox.filter(item=>item.messageId===oldOperation)
    assert.equal(oldItems.length,2);proxies[0].clear()
    await bob.removeMember(group.id,statuses[2].accountId)
    await alice.sync();await bob.sync();await alice.sync();await carol.sync()
    const afterRotation=await vault(0)
    assert(afterRotation.groups[group.id].epoch>groupBefore.epoch)
    assert.notEqual(afterRotation.groups[group.id].distributionId,groupBefore.distributionId)
    assert.deepEqual(afterRotation.blockedOutbox.filter(item=>item.messageId===oldOperation),oldItems)
    assert.equal((await alice.pendingSends()).find(item=>item.operationId===oldOperation).reason,'membership-changed')
    await alice.retryPending()
    await assert.rejects(alice.sendGroup({groupId:group.id,body:'retained old membership intent'},oldOperation),/membership changed/i)
    const currentGroup=await alice.sendGroup({groupId:group.id,body:'only retained group members receive this'})
    await bob.sync();await carol.sync()
    assert((await bob.messages()).some(message=>message.id===currentGroup.id))
    assert.equal((await carol.messages()).some(message=>message.id===currentGroup.id),false)
    const stalePayload={...JSON.parse(proxies[0].records.find(entry=>entry.path==='/api/envelopes'&&JSON.parse(entry.body).groupEpoch===groupBefore.epoch&&JSON.parse(entry.body).groupId===group.id).body),queueTag:randomUUID()}
    const refusedGroup=await fetch(proxies[0].url+'/api/envelopes',{method:'POST',headers:{authorization:proxies[0].authorization,'content-type':'application/json'},body:JSON.stringify(stalePayload)})
    assert.equal(refusedGroup.status,409)
    checked('membership rotation replaces sender key, retains incompatible pending ciphertext, and refuses stale epochs/removed-member delivery',{previousEpoch:groupBefore.epoch,currentEpoch:afterRotation.groups[group.id].epoch,retainedCiphertexts:oldItems.length})

    await carol.close();devices[2].client=null
    const previousIdentity=await readFile(devices[2].vaultPath)
    const newVault=path.join(deviceDir,'replacement-carol.json'),replacement=openHeadless({relay:proxies[2].url,vaultPath:newVault,deviceKey:randomBytes(32).toString('base64'),agentExecutable:process.execPath,agentArguments:[path.join(runtimeRoot,'packages/agent/src/cli.mjs')]})
    try{
      await assert.rejects(replacement.unlock({handle:handles[2],password}),error=>error.code==='replace-keys')
      await replacement.unlock({handle:handles[2],password,replaceKeys:true})
      carol=open(2);await assert.rejects(unlock(2),error=>error.code==='replace-keys')
      assert.deepEqual(await readFile(devices[2].vaultPath),previousIdentity)
      await alice.sync()
      await assert.rejects(alice.send({handle:handles[2],body:'refuse changed peer identity'}),error=>error.code==='untrusted')
      assert.equal((await alice.status()).pendingTrustHandle,handles[2])
      assert.equal((await alice.safetyNumber(handles[2])).verified,false)
      checked('explicit new-device enrollment retires old vault identity and changed peer identity blocks sending until trusted')
    }finally{await replacement.close()}

    await stop()
    const unsafeRoot=path.join(directory,'unsafe-marked-recovery')
    await mkdir(unsafeRoot)
    const marker=JSON.parse(await readFile(path.join(dataDir,'messaging-state.json'),'utf8'));marker.recoveryRequired=true
    await writeFile(path.join(unsafeRoot,'messaging-state.json'),JSON.stringify(marker))
    const markerBefore=await readFile(path.join(unsafeRoot,'messaging-state.json'))
    const unsafe=await startChild(unsafeRoot,{refused:true});assert.match(unsafe.message,/recovery-required/)
    assert.deepEqual(await readFile(path.join(unsafeRoot,'messaging-state.json')),markerBefore)
    await assert.rejects(access(path.join(unsafeRoot,'relay')),{code:'ENOENT'})
    checked('marked unsafe recovery fails closed before opening relay storage; old same-identity vault copies remain explicitly unsupported')
    const inputHashes={}
    for(const relative of ['apps/api/src/migrations.ts','packages/agent/src/nodeVault.ts','packages/session/src/session.ts','scripts/serve-messaging.mjs','packages/crypto/pkg-node/e2ee_crypto_bg.wasm'])inputHashes[relative]=hash(await readFile(path.join(runtimeRoot,relative)))
    result={kind:'endtoend-step-7-synthetic-durability-acceptance',checkedAt:new Date().toISOString(),sourceRoot,runtimeRoot,rollbackRoot:rollbackRoot??null,nodeVersion:process.version,syntheticDataOnly:true,allTemporaryWritersClosed:true,temporaryStateRemoved:true,checks,passed:true,inputHashes,
      limitations:['No PostgreSQL deployment recovery or browser-storage migration is established by this PGlite/headless run.',
        'Recovery is a matched stopped checkpoint with no participant advancement. Arbitrary external replacement by a stale same-identity vault cannot be detected without an independent monotonic anchor and is unsupported.',
        'The compatible rollback rehearsal changes presentation build while retaining the schema-compatible current backend/agents. Historical compatible backend rollback is not claimed.',
        ...(rollbackRoot?[]:['No older runtime supplied: actual historical incompatible rollback refusal is not included; current future-schema refusal is checked.'])]}
  }finally{
    for(const proxy of proxies)proxy.clear()
    await stop();for(const proxy of proxies)await proxy.close()
    const resolved=path.resolve(directory),temp=path.resolve(tmpdir())
    assert.equal(path.dirname(resolved),temp);assert(path.basename(resolved).startsWith('endtoend-durability-'))
    await rm(resolved,{recursive:true,force:true});await assert.rejects(access(resolved),{code:'ENOENT'})
  }
  return result
}
