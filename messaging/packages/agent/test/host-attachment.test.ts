/** AGPL-3.0-only. Synthetic accounts and fresh, disposable device vaults only. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Session, createDeviceSecret, authorizationBinding, validateBootstrap, LEGACY_AUTHORIZATION, type Vault } from '@e2ee/session'
import { signal } from '@e2ee/crypto/node'
import { startLocalAgent } from '../src/local.ts'
import { createDispatcher } from '../src/dispatcher.ts'
import { startReferenceRelay } from './reference-relay.ts'

const authorization={audience:'fixture-project:messaging',bootstrapPath:'/messaging/v1/session'}
test('authorization audiences preserve opaque Unicode and spaces with the public 256-character boundary',()=>{
  for(const audience of ['Project Δ messaging', ' ' + 'x'.repeat(254) + ' ', 'x'.repeat(201), 'x'.repeat(256)]) {
    assert.equal(authorizationBinding({...authorization,audience}).audience,audience)
  }
  for(const audience of ['', '   ', 'x'.repeat(257), 'has\u0000control', 'has\u001fcontrol', 'has\u007fcontrol', 'has\ncontrol']) {
    assert.throws(()=>authorizationBinding({...authorization,audience}),/Unsupported/)
  }
})
test('generic bootstrap requires a finite future expiry while legacy bootstrap preserves optional expiry',()=>{
  const bootstrap={version:1,protocolVersion:1,audience:authorization.audience,account:{id:'synthetic',handle:'synthetic'},enrolled:false,identityKey:null}
  for(const expiresAt of [null,undefined,'not-a-date',new Date(Date.now()-1000).toISOString()]) {
    assert.throws(()=>validateBootstrap({...bootstrap,expiresAt},authorization),/expiry|expired/)
  }
  const expiresAt=new Date(Date.now()+60000).toISOString()
  assert.equal(validateBootstrap({...bootstrap,expiresAt},authorization).expiresAt,expiresAt)
  for(const value of [null,undefined]) {
    assert.equal(validateBootstrap({...bootstrap,audience:LEGACY_AUTHORIZATION.audience,expiresAt:value},LEGACY_AUTHORIZATION).expiresAt,value)
  }
})
function memory(relay:string) {
  let disk:Vault|null=null
  const ports={relay,label:'host grant fixture',signal,loadVault:async()=>disk?structuredClone(disk):null,
    saveVault:async(vault:Vault)=>{disk=structuredClone(vault)},loadBlob:async()=>null,saveBlob:async()=>{}}
  return {session:new Session(ports),reopen:()=>new Session(ports),disk:()=>disk?structuredClone(disk):null}
}
async function register(relay:string,handle:string) {
  const response=await fetch(relay+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle,password:'synthetic-password',displayName:handle})})
  assert.equal(response.status,200)
  return response.json() as Promise<{token:string;account:{id:string;handle:string}}>
}
function installBootstrap(relay:string) {
  const original=globalThis.fetch
  let change:(value:any)=>any=value=>value
  let gate:Promise<void>|null=null
  let entered:(()=>void)|null=null
  const paths:string[]=[]
  globalThis.fetch=async(input,init)=>{
    const address=String(input)
    if(address===relay+authorization.bootstrapPath) {
      paths.push(address)
      if(gate){entered?.();await gate}
      const response=await original(relay+'/api/bootstrap',init)
      if(!response.ok)return response
      const value=await response.json() as object
      return new Response(JSON.stringify(change({...value,version:1,audience:authorization.audience,expiresAt:new Date(Date.now()+60000).toISOString()})),{status:200,headers:{'content-type':'application/json'}})
    }
    return original(input,init)
  }
  return {original,paths,setChange(next:typeof change){change=next},hold(next:Promise<void>,reached:()=>void){gate=next;entered=reached},unhold(){gate=null;entered=null},restore(){globalThis.fetch=original}}
}

test('generic authorization binds an unchanged device vault to the versioned session endpoint',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),fixture=memory(relay.baseUrl),mock=installBootstrap(relay.baseUrl)
  let reopened:Session|undefined
  try {
    const account=await register(relay.baseUrl,'host_binding')
    await fixture.session.attach(account.token,account.account,{authorization})
    const identity=fixture.session.publicIdentity(),store=fixture.disk()!.store
    fixture.session.lock();reopened=fixture.reopen()
    await reopened.attach(account.token,account.account,{authorization})
    assert.equal(reopened.publicIdentity(),identity)
    assert.equal(fixture.disk()!.store,store)
    assert.ok(mock.paths.length>=4,'initial attach, sync, reattach and sync all use the generic binding')
    await reopened.checkIdentity()
    assert.equal(reopened.status().accountId,account.account.id)
  }finally{mock.restore();fixture.session.lock();reopened?.lock();await relay.close()}
})

test('wrong account, audience, protocol, expired grant or changed identity cannot replace a saved vault',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),fixture=memory(relay.baseUrl),mock=installBootstrap(relay.baseUrl)
  try {
    const account=await register(relay.baseUrl,'host_refusals')
    await fixture.session.attach(account.token,account.account,{authorization})
    const before=fixture.disk()!
    for(const change of [
      (value:any)=>({...value,account:{...value.account,id:'another-account'}}),
      (value:any)=>({...value,audience:'another-project'}),
      (value:any)=>({...value,protocolVersion:2}),
      (value:any)=>({...value,expiresAt:new Date(Date.now()-1000).toISOString()}),
      (value:any)=>({...value,identityKey:'replaced-identity'}),
    ]) {
      mock.setChange(change)
      await assert.rejects(fixture.session.attach(account.token,account.account,{authorization}))
      assert.equal(fixture.session.status().unlocked,false)
      assert.deepEqual(fixture.disk(),before,'no key replacement or plaintext history rewrite on rejected authorization')
    }
    assert.throws(()=>authorizationBinding({audience:'fixture',bootstrapPath:'/api/admin'}),/Unsupported/)
  }finally{mock.restore();fixture.session.lock();await relay.close()}
})

test('detected token revocation clears cached views; ordinary membership permission errors retain the account',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),fixture=memory(relay.baseUrl),mock=installBootstrap(relay.baseUrl)
  try {
    const account=await register(relay.baseUrl,'host_revocation')
    await fixture.session.attach(account.token,account.account,{authorization})
    const genericFetch=globalThis.fetch
    globalThis.fetch=async(input,init)=>String(input).endsWith('/api/friends')?new Response(JSON.stringify({error:'Membership denied'}),{status:403}):genericFetch(input,init)
    await assert.rejects(fixture.session.friendsList(),/Membership denied/)
    assert.equal(fixture.session.status().unlocked,true)
    globalThis.fetch=genericFetch
    await mock.original(relay.baseUrl+'/api/auth/logout',{method:'POST',headers:{authorization:`Bearer ${account.token}`}})
    await assert.rejects(fixture.session.sync(),/Sign in required/)
    assert.equal(fixture.session.record,null)
    await assert.rejects(fixture.session.messages(),/unlock/)
    const dispatcher=createDispatcher({signal,session:()=>fixture.session,lock(){fixture.session.lock()}})
    const response=await dispatcher.dispatch({version:1,requestId:'revoked-views',operation:'views',input:{}})
    assert.equal(response.ok,false)
  }finally{mock.restore();fixture.session.lock();await relay.close()}
})

test('a known grant expiry locks local cached plaintext without waiting for another network call',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),fixture=memory(relay.baseUrl),mock=installBootstrap(relay.baseUrl)
  const now=Date.now
  try {
    const account=await register(relay.baseUrl,'host_expiry')
    const until=now()+60000
    mock.setChange(value=>({...value,expiresAt:new Date(until).toISOString()}))
    await fixture.session.attach(account.token,account.account,{authorization})
    Date.now=()=>until+1
    assert.equal(fixture.session.status().unlocked,false)
    await assert.rejects(fixture.session.messages(),/unlock/)
  }finally{Date.now=now;mock.restore();fixture.session.lock();await relay.close()}
})

test('reattaching cancels an in-flight old-account sync without reopening or rewriting its keys',{timeout:30000},async()=>{
  const relay=await startReferenceRelay(),fixture=memory(relay.baseUrl),mock=installBootstrap(relay.baseUrl)
  let release!:()=>void
  try {
    const alice=await register(relay.baseUrl,'host_switch_alice'),bob=await register(relay.baseUrl,'host_switch_bob')
    await fixture.session.attach(alice.token,alice.account,{authorization})
    const before=fixture.disk()!
    let entered!:()=>void
    const reached=new Promise<void>(resolve=>{entered=resolve})
    mock.hold(new Promise<void>(resolve=>{release=resolve}),entered)
    const pending=fixture.session.sync()
    await reached
    mock.unhold()
    await assert.rejects(fixture.session.attach(bob.token,bob.account,{authorization}),/different account/)
    release()
    await assert.rejects(pending,/locked|aborted|unreachable/i)
    assert.equal(fixture.session.status().unlocked,false)
    assert.deepEqual(fixture.disk(),before)
  }finally{release?.();mock.restore();fixture.session.lock();await relay.close()}
})

test('dispatcher attachment revokes old plaintext responses and queued commands before switching accounts',async()=>{
  let entered!:()=>void,release!:()=>void
  const reached=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
  const old={status:()=>({unlocked:true,accountId:'old-account'}),async sync(){entered();await gate;return{messages:[{body:'old private message'}]}}} as unknown as Session
  let current:Session|null=old
  const dispatcher=createDispatcher({signal,session:()=>current,lock(){current=null},async attach(){return{unlocked:false,accountId:'next-account'}}})
  const pending=dispatcher.dispatch({version:1,requestId:'old-sync',operation:'sync',input:{}})
  await reached
  const queued=dispatcher.dispatch({version:1,requestId:'old-views',operation:'views',input:{}})
  const attached=dispatcher.dispatch({version:1,requestId:'next-attach',operation:'attach',input:{}})
  assert.equal(current,null,'old account is revoked as soon as the attachment is admitted')
  release()
  assert.equal((await pending).ok,false)
  assert.equal((await queued).ok,false)
  assert.equal((await attached).ok,true)
  assert.equal(JSON.stringify(await pending).includes('old private message'),false)
})

test('local Node agents attach host grants, reopen after lock and refuse another deployment or account',{timeout:30000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'host-agent-binding-'))
  const relay=await startReferenceRelay(),mock=installBootstrap(relay.baseUrl)
  const vaultPath=path.join(directory,'device.json')
  const agent=await startLocalAgent({relay:relay.baseUrl,vaultPath,deviceKey:createDeviceSecret()})
  const command=async(operation:string,input:Record<string,unknown>={})=>{
    const response=await fetch(agent.url+'/v1/command',{method:'POST',headers:{authorization:`Bearer ${agent.capability}`,'content-type':'application/json'},body:JSON.stringify({version:1,requestId:crypto.randomUUID(),operation,input})})
    return response.json() as Promise<any>
  }
  try {
    const account=await register(relay.baseUrl,'host_node')
    const attachment={relay:relay.baseUrl,token:account.token,expectedAccountId:account.account.id,authorization}
    assert.equal((await command('attach',attachment)).ok,true)
    const before=await readFile(vaultPath,'utf8')
    await command('lock')
    assert.equal((await command('attach',attachment)).ok,true)
    assert.equal((await command('status')).result.accountId,account.account.id)
    const capability=await command('capabilities')
    assert.equal(capability.result.operations.includes('attach'),true)
    assert.deepEqual(capability.result.events,[])
    assert.equal((await command('attach',{...attachment,relay:'https://unconfigured.invalid'})).ok,false)
    assert.equal((await command('status')).result.unlocked,false)
    assert.equal((await command('attach',{...attachment,expectedAccountId:'wrong-account'})).ok,false)
    assert.equal((await command('status')).result.unlocked,false)
    // Existing encrypted history remains a sealed vault, despite rejected reattachments.
    assert.equal(JSON.parse(before).formatVersion,JSON.parse(await readFile(vaultPath,'utf8')).formatVersion)
  }finally{await agent.close();mock.restore();await relay.close();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep));await rm(resolved,{recursive:true,force:true})}
})
