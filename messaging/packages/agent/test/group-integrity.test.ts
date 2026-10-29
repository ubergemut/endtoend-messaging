import test from 'node:test'
import assert from 'node:assert/strict'
import {Session,type Vault} from '@e2ee/session'
import {signal} from '@e2ee/crypto/node'
import {startReferenceRelay} from './reference-relay.ts'

function memory(relay:string){
  let disk:Vault|null=null
  return new Session({relay,label:'group integrity fixture',signal,loadVault:async()=>disk?structuredClone(disk):null,
    saveVault:async vault=>{disk=structuredClone(vault)},loadBlob:async()=>null,saveBlob:async()=>{}})
}
test('authenticated group senders cannot spoof authors or transplant ciphertext between conversations',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),alice=memory(relay.baseUrl),bob=memory(relay.baseUrl)
  try{
    await alice.unlock({handle:'integrity_alice',password:'fixture-password'})
    await bob.unlock({handle:'integrity_bob',password:'fixture-password'})
    await alice.requestFriend('integrity_bob')
    await bob.respondRequest((await bob.requests())[0].id,'accept');await alice.sync()
    const first=await alice.createGroup('first',['integrity_bob'])
    const second=await alice.createGroup('second',['integrity_bob'])
    for(let round=0;round<3;round++){await bob.sync();await alice.sync()}
    const forge=async(body:string,payload:Record<string,unknown>,envelopeGroup=first.id)=>{
      const encrypted=JSON.parse(signal.group_encrypt_message(bob.record!.store,bob.record!.accountId,bob.record!.groups[first.id].distributionId,
        JSON.stringify({kind:'text',id:crypto.randomUUID(),body,groupId:first.id,epoch:bob.record!.groups[first.id].epoch,...payload})))
      bob.record!.store=JSON.stringify(encrypted.store)
      const result=await fetch(relay.baseUrl+'/api/envelopes',{method:'POST',headers:{authorization:`Bearer ${bob.token}`,'content-type':'application/json'},body:JSON.stringify({
        recipientAccountId:alice.record!.accountId,groupId:envelopeGroup,groupEpoch:bob.record!.groups[envelopeGroup].epoch,
        accessKey:bob.record!.peers[alice.record!.accountId].accessKey,queueTag:crypto.randomUUID(),ciphertext:encrypted.ciphertext})})
      assert.equal(result.status,200);await alice.sync()
    }
    await forge('SPOOFED AUTHOR',{senderId:alice.record!.accountId,senderHandle:'integrity_alice'})
    assert.equal(alice.record!.messages.some(message=>message.body==='SPOOFED AUTHOR'),false)
    await forge('AUTHENTICATED HANDLE',{senderId:bob.record!.accountId,senderHandle:'integrity_alice'})
    const accepted=alice.record!.messages.find(message=>message.body==='AUTHENTICATED HANDLE')!
    assert.equal(accepted.senderId,bob.record!.accountId);assert.equal(accepted.senderHandle,'integrity_bob')
    await forge('CROSS GROUP TRANSPLANT',{senderId:bob.record!.accountId},second.id)
    assert.equal(alice.record!.messages.some(message=>message.body==='CROSS GROUP TRANSPLANT'),false)
  }finally{alice.lock();bob.lock();await relay.close()}
})

test('membership changes archive pending ciphertext and allow normal sync and new group messages',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),clients=[memory(relay.baseUrl),memory(relay.baseUrl),memory(relay.baseUrl)]
  const [alice,bob,carol]=clients;const original=globalThis.fetch
  try{
    for(let i=0;i<clients.length;i++)await clients[i].unlock({handle:['stale_alice','stale_bob','stale_carol'][i],password:'fixture-password'})
    for(const [left,right] of [[alice,bob],[alice,carol],[bob,carol]]){
      await left.requestFriend(right.record!.handle);await right.respondRequest((await right.requests()).find(request=>request.status==='pending'&&request.direction==='incoming')!.id,'accept');await left.sync()
    }
    const group=await alice.createGroup('membership fixture',['stale_bob','stale_carol'])
    for(let round=0;round<3;round++)for(const client of clients)await client.sync()
    globalThis.fetch=async(input,init)=>{
      if(String(input).endsWith('/api/envelopes')&&init?.method==='POST'&&JSON.parse(String(init.body)).groupId===group.id)throw new Error('offline group fanout')
      return original(input,init)
    }
    const operationId=crypto.randomUUID()
    await assert.rejects(alice.sendGroup({groupId:group.id,body:'retained old membership',operationId}),/offline group/)
    const retained=alice.record!.outbox.filter(item=>item.messageId===operationId).map(item=>item.ciphertext)
    assert.equal(retained.length,2)
    globalThis.fetch=original
    await bob.removeMember(group.id,carol.record!.accountId)
    await alice.sync()
    assert.deepEqual(alice.record!.blockedOutbox!.filter(item=>item.messageId===operationId).map(item=>item.ciphertext),retained)
    assert.equal(alice.pendingSends().find(item=>item.operationId===operationId)!.reason,'membership-changed')
    await alice.retryPending();await alice.sync()
    await alice.sendGroup({groupId:group.id,body:'current membership message',operationId:crypto.randomUUID()})
    await bob.sync();assert.equal((await bob.messages({groupId:group.id})).some(message=>message.body==='current membership message'),true)
  }finally{globalThis.fetch=original;for(const client of clients)client.lock();await relay.close()}
})
