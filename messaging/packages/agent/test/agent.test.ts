import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createDeviceSecret,isSealedRecord,Session,type Vault} from '@e2ee/session'
import {signal} from '@e2ee/crypto/node'
import {startLocalAgent} from '../src/local.ts'
import {createDispatcher} from '../src/dispatcher.ts'
import {startReferenceRelay} from './reference-relay.ts'

test('independent relay and local agents preserve full messaging without private product dependencies',{timeout:120000},async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'agent-independent-'))
  const relay=await startReferenceRelay()
  const first=await startLocalAgent({relay:relay.baseUrl,vaultPath:path.join(dir,'a.json'),deviceKey:createDeviceSecret()})
  const second=await startLocalAgent({relay:relay.baseUrl,vaultPath:path.join(dir,'b.json'),deviceKey:createDeviceSecret()})
  const request=async(agent:typeof first,operation:string,input:Record<string,unknown>={},operationId?:string)=>{
    const response=await fetch(agent.url+'/v1/command',{method:'POST',headers:{authorization:`Bearer ${agent.capability}`,'content-type':'application/json'},
      body:JSON.stringify({version:1,requestId:crypto.randomUUID(),operation,input,operationId})})
    assert.equal(response.status,200)
    return response.json() as Promise<any>
  }
  const call=async(agent:typeof first,operation:string,input:Record<string,unknown>={},operationId?:string)=>{
    const result=await request(agent,operation,input,operationId);assert.equal(result.ok,true,JSON.stringify(result));return result.result
  }
  try{
    assert.equal((await fetch(first.url+'/v1/command',{method:'POST'})).status,403)
    assert.equal((await fetch(first.url+'/v1/command',{method:'POST',headers:{authorization:`Bearer ${first.capability}`,origin:'https://foreign.invalid'}})).status,403)
    assert.equal((await fetch(first.url+'/v1/command',{method:'POST',headers:{authorization:`Bearer ${first.capability}`}})).status,415)
    assert.equal((await call(first,'cryptoDiagnostic')).ok,true)
    await call(first,'unlock',{handle:'fixture_alice',password:'fixture-password'})
    await call(second,'unlock',{handle:'fixture_bob',password:'fixture-password'})
    await call(first,'requestFriend',{handle:'fixture_bob',note:'private request'})
    const requests=await call(second,'requests');assert.equal(requests[0].note,'private request')
    await call(second,'respondRequest',{id:requests[0].id,action:'accept'})
    await call(first,'sync')
    const operationId=crypto.randomUUID(),body='independent message '+'.'.repeat(6000)
    const sent=await call(first,'send',{handle:'fixture_bob',body},operationId)
    const repeated=await call(first,'send',{handle:'fixture_bob',body},operationId)
    assert.equal(sent.id,repeated.id)
    assert.equal((await request(first,'send',{handle:'fixture_bob',body:'different'},operationId)).ok,false)
    await call(second,'sync')
    assert.equal((await call(second,'messages')).filter((message:any)=>message.id===sent.id).length,1)
    const fileBytes=Buffer.from([0,1,2,255,128,7])
    await call(first,'sendFile',{handle:'fixture_bob',name:'private.bin',mime:'application/octet-stream',base64:fileBytes.toString('base64')},crypto.randomUUID())
    await call(second,'sync')
    const view=await call(second,'views')
    const attachment=view.messages.find((message:any)=>message.attachments?.length).attachments[0]
    assert.deepEqual(Object.keys(attachment).sort(),['mediaId','mime','name'])
    assert.equal('store' in view,false);assert.equal(JSON.stringify(view).includes('wrappedKey'),false)
    assert.deepEqual(Buffer.from((await call(second,'attachment',{mediaId:attachment.mediaId})).base64,'base64'),fileBytes)
    assert.deepEqual(Buffer.from((await call(first,'attachment',{mediaId:attachment.mediaId})).base64,'base64'),fileBytes)
    const group=await call(first,'createGroup',{name:'Independent group',handles:['fixture_bob']})
    for(let round=0;round<3;round++){await call(second,'sync');await call(first,'sync')}
    await call(first,'sendGroup',{groupId:group.id,body:'group plaintext'},crypto.randomUUID())
    await call(second,'sync')
    assert.equal((await call(second,'messages',{groupId:group.id})).some((message:any)=>message.body==='group plaintext'),true)
    const sealed=await readFile(path.join(dir,'a.json'),'utf8')
    assert.equal(isSealedRecord(JSON.parse(sealed)),true)
    assert.equal(sealed.includes(body),false)
    await assert.rejects(startLocalAgent({relay:relay.baseUrl,vaultPath:path.join(dir,'a.json'),deviceKey:createDeviceSecret()}),/already open/)
    assert.equal((await request(first,'storeJson')).ok,false)
    await call(first,'lock')
    assert.equal((await request(first,'views')).ok,false)
    assert.equal((await call(first,'status')).unlocked,false)
  }finally{await first.close();await second.close();await relay.close();await rm(dir,{recursive:true,force:true})}
})

function memory(relay:string){
  let disk:Vault|null=null
  const blobs=new Map<string,Uint8Array>()
  let save:(vault:Vault)=>Promise<void>=async vault=>{disk=structuredClone(vault)}
  const session=new Session({relay,label:'test memory',signal,loadVault:async()=>disk?structuredClone(disk):null,
    saveVault:vault=>save(vault),loadBlob:async id=>blobs.get(id)??null,saveBlob:async(id,bytes)=>{blobs.set(id,new Uint8Array(bytes))},deleteBlob:async id=>{blobs.delete(id)}})
  return{session,get disk(){return disk},setSave(next:typeof save){save=next}}
}

test('locking during an asynchronous commit cannot restore unlocked state',{timeout:30000},async()=>{
  const relay=await startReferenceRelay();const opened=memory(relay.baseUrl)
  try{
    await opened.session.unlock({handle:'lock_race',password:'fixture-password'})
    let release!:()=>void,entered!:()=>void
    const gate=new Promise<void>(resolve=>{release=resolve}),reached=new Promise<void>(resolve=>{entered=resolve})
    opened.setSave(async()=>{entered();await gate})
    const pending=opened.session.markSeen(['message-id'])
    await reached;opened.session.lock();release()
    await assert.rejects(pending,/locked/)
    assert.equal(opened.session.record,null);assert.equal(opened.session.status().unlocked,false)
  }finally{await relay.close()}
})

test('dispatcher rejects incompatible envelopes and raw crypto operations',async()=>{
  const dispatcher=createDispatcher({session:()=>null,signal,lock(){}})
  for(const request of [{version:2,requestId:'a',operation:'status',input:{}},{version:1,requestId:'a',operation:'status',input:[]},
    {version:1,requestId:'a',operation:'storeJson',input:{}},{version:1,requestId:'a',operation:'encrypt_message',input:{}}]){
    const result=await dispatcher.dispatch(request);assert.equal(result.ok,false)
  }
})

test('trusted approval pins the displayed peer/key and safety number despite later identity changes',async()=>{
  let pending={peerId:'alice',identityKey:'alice-key-1'}
  let number='displayed-number-1',decisions=0
  const session={
    status:()=>({unlocked:true}),
    get record(){return{pendingTrust:pending}},
    async safetyNumber(){return{safetyNumber:number}},
    async trustIdentity(){decisions+=1;return{ok:true}},
    async markVerified(){decisions+=1;return{ok:true}},
  } as unknown as Session
  const dispatcher=createDispatcher({session:()=>session,signal,lock(){}})
  const shown={operation:'trustIdentity' as const,peerId:'alice',identityKey:'alice-key-1'}
  pending={peerId:'alice',identityKey:'alice-key-2'}
  await assert.rejects(dispatcher.trusted('trustIdentity',{},shown),/identity waiting for trust changed/)
  pending={peerId:'bob',identityKey:'alice-key-1'}
  await assert.rejects(dispatcher.trusted('trustIdentity',{},shown),/identity waiting for trust changed/)
  number='displayed-number-2'
  await assert.rejects(dispatcher.trusted('markVerified',{handle:'alice'},{operation:'markVerified',handle:'alice',safetyNumber:'displayed-number-1'}),/safety number changed/)
  assert.equal(decisions,0)
  pending={peerId:'alice',identityKey:'alice-key-1'}
  await dispatcher.trusted('trustIdentity',{},shown)
  await dispatcher.trusted('markVerified',{handle:'alice'},{operation:'markVerified',handle:'alice',safetyNumber:number})
  assert.equal(decisions,2)
})

test('lost publication response preserves and republishes the committed identity',{timeout:30000},async()=>{
  const relay=await startReferenceRelay();const opened=memory(relay.baseUrl);const original=globalThis.fetch
  let lose=true
  globalThis.fetch=async(input,init)=>{
    const result=await original(input,init)
    if(lose&&String(input).endsWith('/api/keys/bundle')&&init?.method==='PUT'){lose=false;throw new Error('Lost key acknowledgement')}
    return result
  }
  try{
    await assert.rejects(opened.session.unlock({handle:'lost_publication',password:'fixture-password'}),/Lost key acknowledgement/)
    const before=opened.disk!.pendingPublication!.identityKey
    await opened.session.unlock({handle:'lost_publication',password:'fixture-password'})
    assert.equal(opened.session.publicIdentity(),before)
    assert.equal(opened.disk!.pendingPublication,null)
  }finally{globalThis.fetch=original;await relay.close()}
})

test('lost file upload responses reuse committed file bytes, IDs and expiry',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),alice=memory(relay.baseUrl),bob=memory(relay.baseUrl)
  const original=globalThis.fetch;const uploads:string[]=[];let lose=true
  try{
    await alice.session.unlock({handle:'file_alice',password:'fixture-password'});await bob.session.unlock({handle:'file_bob',password:'fixture-password'})
    await alice.session.requestFriend('file_bob');await bob.session.respondRequest((await bob.session.requests())[0].id,'accept');await alice.session.sync()
    globalThis.fetch=async(input,init)=>{
      const result=await original(input,init)
      if(String(input).endsWith('/api/media')&&init?.method==='POST'){
        uploads.push(String(init.body));if(lose){lose=false;throw new Error('Lost file upload acknowledgement')}
      }
      return result
    }
    const bytes=new Uint8Array([1,2,3,255]),intent={operationId:crypto.randomUUID(),handle:'file_bob',body:'file caption',expiresInSeconds:3600,files:[{name:'retained.bin',mime:'application/octet-stream',bytes}]}
    await assert.rejects(alice.session.sendAttachments(intent),/Lost file upload/)
    const retained=alice.disk!.sendAttempts![0].uploads[0].ciphertext
    await alice.session.sendAttachments(intent)
    assert.equal(uploads.length,2);assert.equal(uploads[0],uploads[1]);assert.equal(JSON.parse(uploads[1]).ciphertext,retained)
    await bob.session.sync();const received=bob.session.record!.messages.find(message=>message.id===intent.operationId)!
    assert.deepEqual(await bob.session.attachment(received.attachments![0].mediaId),bytes)
  }finally{globalThis.fetch=original;alice.session.lock();bob.session.lock();await relay.close()}
})

test('disappearing messages prune durable intent plaintext and cannot be recreated with the expired operation ID',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),alice=memory(relay.baseUrl),bob=memory(relay.baseUrl);const originalNow=Date.now
  try{
    await alice.session.unlock({handle:'expiry_alice',password:'fixture-password'});await bob.session.unlock({handle:'expiry_bob',password:'fixture-password'})
    await alice.session.requestFriend('expiry_bob');await bob.session.respondRequest((await bob.session.requests())[0].id,'accept');await alice.session.sync()
    const intent={operationId:crypto.randomUUID(),handle:'expiry_bob',body:'remove this plaintext after expiry',expiresInSeconds:1}
    await alice.session.send(intent)
    const future=originalNow()+2000;Date.now=()=>future
    await alice.session.dropExpired()
    assert.equal(JSON.stringify(alice.disk).includes(intent.body),false)
    assert.equal(alice.disk!.sendAttempts![0].expired,true)
    await assert.rejects(alice.session.send(intent),/expired/)
  }finally{Date.now=originalNow;alice.session.lock();bob.session.lock();await relay.close()}
})
