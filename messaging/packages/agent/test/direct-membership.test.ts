// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {Session,type Vault} from '@e2ee/session'
import {signal} from '@e2ee/crypto/node'
import {startReferenceRelay} from './reference-relay.ts'

function memory(relay:string){let disk:Vault|null=null;const ports={relay,label:'direct membership fixture',signal,loadVault:async()=>disk?structuredClone(disk):null,saveVault:async(vault:Vault)=>{disk=structuredClone(vault)},loadBlob:async()=>null,saveBlob:async()=>{}};return {session:new Session(ports),reopen:()=>new Session(ports)}}
test('removed direct contacts retain exact pending ciphertext across unlock without blocking other contacts or resending after restoration',{timeout:30000},async()=>{
 const relay=await startReferenceRelay(),store=memory(relay.baseUrl),alice=store.session,bob=memory(relay.baseUrl).session,carol=memory(relay.baseUrl).session,original=globalThis.fetch
 let reopened:Session|undefined
 try{
  for(const [client,handle] of [[alice,'direct_alice'],[bob,'direct_bob'],[carol,'direct_carol']] as const)await client.unlock({handle,password:'fixture-password'})
  for(const peer of [bob,carol]){await alice.requestFriend(peer.record!.handle);await peer.respondRequest((await peer.requests()).find(r=>r.status==='pending'&&r.direction==='incoming')!.id,'accept');await alice.sync()}
  await alice.send({handle:'direct_bob',body:'earlier delivered',operationId:crypto.randomUUID()});await bob.sync()
  const operationId=crypto.randomUUID()
  globalThis.fetch=async(input,init)=>{if(String(input).endsWith('/api/envelopes')&&init?.method==='POST'&&JSON.parse(String(init.body)).recipientAccountId===bob.record!.accountId)throw Error('offline direct fixture');return original(input,init)}
  await assert.rejects(alice.send({handle:'direct_bob',body:'retained direct intent',operationId}),/offline direct/)
  const retained=structuredClone(alice.record!.outbox.filter(item=>item.messageId===operationId));assert.equal(retained.length,1)
  globalThis.fetch=original
  const remove=await fetch(relay.baseUrl+'/api/friends/'+bob.record!.accountId+'/remove',{method:'POST',headers:{authorization:'Bearer '+alice.token}});assert.equal(remove.status,200)
  alice.lock();reopened=store.reopen();await reopened.unlock({handle:'direct_alice',password:'fixture-password'})
  assert.deepEqual(reopened.record!.blockedOutbox!.filter(item=>item.messageId===operationId),retained)
  assert.equal(reopened.pendingSends().find(item=>item.operationId===operationId)!.reason,'membership-changed')
  assert.ok(reopened.record!.messages.some(item=>item.body==='earlier delivered'))
  await reopened.send({handle:'direct_carol',body:'unrelated delivery works',operationId:crypto.randomUUID()});await carol.sync();assert.ok((await carol.messages()).some(item=>item.body==='unrelated delivery works'))
  await reopened.requestFriend('direct_bob');await bob.respondRequest((await bob.requests()).find(r=>r.status==='pending'&&r.direction==='incoming')!.id,'accept');await reopened.sync();await reopened.retryPending();await bob.sync()
  assert.equal((await bob.messages()).some(item=>item.body==='retained direct intent'),false)
  assert.deepEqual(reopened.record!.blockedOutbox!.filter(item=>item.messageId===operationId),retained)
 }finally{globalThis.fetch=original;alice.lock();bob.lock();carol.lock();reopened?.lock();await relay.close()}
})
