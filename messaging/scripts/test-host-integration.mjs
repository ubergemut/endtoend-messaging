// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic orchestration: the host fixtures use only the MIT public SDK and Node.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {generateKeyPairSync,sign,randomUUID,randomBytes} from 'node:crypto'
import {mkdtemp,rm,mkdir,writeFile,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {AgentClient,HttpAgentTransport,RelayService} from '../packages/client/src/index.ts'
import {startLocalAgent} from '../packages/agent/src/local.ts'
import {startServer} from '../apps/api/src/server.ts'
import {startMessaging} from './serve-messaging.mjs'

const directory=await mkdtemp(path.join(tmpdir(),'endtoend-host-contract-'))
let application,otherProject,service
const running=[],hosts=[],checks=[]
const check=name=>checks.push({name,passed:true})
const audience='urn:endtoend:test:project-one',otherAudience='urn:endtoend:test:project-two'
const emailKeys=generateKeyPairSync('ed25519'),staffKeys=generateKeyPairSync('ed25519')
const keyConfig=(issuer,key)=>({issuer,keys:[{keyId:'test-key',publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString()}]})
const config={audience,issuers:[keyConfig('email-host',emailKeys),keyConfig('staff-host',staffKeys)],sessionTtlSeconds:3600}
function assertion(issuer,key,subject,handle,purpose='session'){
  const now=Math.floor(Date.now()/1000)
  const payload=Buffer.from(JSON.stringify({version:1,keyId:'test-key',issuer,subject,audience,issuedAt:now,expiresAt:now+60,nonce:randomUUID(),purpose,handle,displayName:handle}))
  return `${payload.toString('base64url')}.${sign(null,payload,key.privateKey).toString('base64url')}`
}
async function host(model,issuer,keys,accounts){
  const route=model==='email'?'/signin':'/employee/session'
  const server=createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!==route){res.writeHead(404).end();return}
    try{
      let text='';for await(const part of req)text+=part
      const data=JSON.parse(text),identity=model==='email'?data.email:data.staffNumber,secret=model==='email'?data.password:data.pin
      const account=accounts.find(item=>item.login===identity&&item.secret===secret)
      if(!account){res.writeHead(401).end();return}
      const grant=await service.exchange(assertion(issuer,keys,account.subject,account.handle))
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(grant))
    }catch{res.writeHead(401).end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const base=`http://127.0.0.1:${server.address().port}`
  const item={async login(account){const body=model==='email'?{email:account.login,password:account.secret}:{staffNumber:account.login,pin:account.secret};const reply=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(reply.status,200);return reply.json()},async close(){await new Promise(resolve=>server.close(resolve))}}
  hosts.push(item);return item
}
const users=[{login:'alice@example.invalid',secret:'test-email-password-a',subject:'crm:a',handle:'host_alice'}, {login:'bob@example.invalid',secret:'test-email-password-b',subject:'crm:b',handle:'host_bob'}, {login:'employee-42',secret:'7264',subject:'staff:42',handle:'host_carol'}]
const devices=users.map((user,index)=>({vaultPath:path.join(directory,`device-${index}.json`),deviceKey:randomBytes(32).toString('base64')}))
async function agent(index,grant){
  const runtime=await startLocalAgent({relay:application.agentUrl,...devices[index]})
  const client=new AgentClient(new HttpAgentTransport(runtime.url,runtime.capability))
  running.push({runtime,client})
  await client.attach(service.attachInput(grant))
  return client
}
async function closeAgents(){for(const item of running.splice(0)){await item.client.close();await item.runtime.close()}}
async function friends(first,second,secondHandle){await first.requestFriend(secondHandle);await second.respondRequest((await second.requests())[0].id,'accept');await first.sync()}
try{
  const bad=path.join(directory,'invalid-config')
  await assert.rejects(()=>startMessaging({dataDir:bad,hostIdentity:{audience,issuers:[]}}))
  await assert.rejects(()=>access(bad),{code:'ENOENT'})
  const trustFile=path.join(directory,'public-trust.json');await writeFile(trustFile,JSON.stringify(config))
  application=await startMessaging({dataDir:path.join(directory,'relay-state'),hostIdentityConfig:trustFile,callerOrigins:['https://email-ui.example.invalid','https://staff-ui.example.invalid']})
  service=new RelayService(application.agentUrl,{audience})
  const metadata=await service.metadata();assert.equal(metadata.audience,audience)
  const trusted=await(await fetch(application.agentUrl+'/config.json')).json()
  assert(trusted.allowedCallerOrigins.includes('https://email-ui.example.invalid'));assert(trusted.allowedCallerOrigins.includes('https://staff-ui.example.invalid'))
  check('public discovery, configured host trust and independent caller origins work through managed deployment')
  const emailHost=await host('email','email-host',emailKeys,users.slice(0,2)),staffHost=await host('staff','staff-host',staffKeys,[users[2]])
  let grants=[await emailHost.login(users[0]),await emailHost.login(users[1]),await staffHost.login(users[2])]
  let clients=await Promise.all(grants.map((grant,index)=>agent(index,grant)))
  let [alice,bob,carol]=clients
  const accountIds=grants.map(grant=>grant.account.id)
  assert.equal(new Set(accountIds).size,3)
  assert.equal((await alice.capabilities()).operations.includes('sendAttachments'),true)
  assert.deepEqual((await alice.capabilities()).events,[])
  check('email/password and staff-number/PIN host backends connect through identical MIT grants and device commands')
  await assert.rejects(()=>alice.send({handle:users[2].handle,body:'not permitted before friendship'}))
  assert.equal((await alice.status()).unlocked,true)
  await friends(alice,bob,users[1].handle);await friends(alice,carol,users[2].handle);await friends(bob,carol,users[2].handle)
  const direct=await alice.send({handle:users[2].handle,body:'cross-host direct message'},'step5-host-direct')
  await carol.sync();assert.equal((await carol.messages()).find(item=>item.id===direct.id).body,'cross-host direct message')
  check('public friendship permissions remain enforced across host login systems')
  const group=await alice.createGroup('host contract group',[users[1].handle,users[2].handle])
  await bob.sync();await carol.sync();await alice.sync()
  const sentGroup=await bob.sendGroup({groupId:group.id,body:'group from email login'},'step5-host-group')
  await carol.sync();assert.equal((await carol.messages()).find(item=>item.id===sentGroup.id).body,'group from email login')
  const bytes=Buffer.from([0,255,32,128,11]),file=await carol.sendFile({handle:users[0].handle,name:'host.bin',mime:'application/octet-stream',base64:bytes.toString('base64'),body:'staff file'},'step5-host-file')
  await alice.sync();const media=(await alice.views()).messages.find(item=>item.id===file.id).attachments[0]
  assert.deepEqual(Buffer.from(await alice.attachment(media.mediaId)),bytes)
  await alice.markVerified(users[2].handle);const safety=await alice.safetyNumber(users[2].handle)
  check('direct/group/file operations and trusted verification work using generic credentials only')
  otherProject=await startServer({hostIdentity:{...config,audience:otherAudience}})
  const otherService=new RelayService(otherProject.baseUrl,{audience:otherAudience})
  await assert.rejects(()=>otherService.exchange(assertion('email-host',emailKeys,users[0].subject,users[0].handle)))
  assert.equal((await fetch(otherProject.baseUrl+'/messaging/v1/session',{headers:{authorization:`Bearer ${grants[0].token}`}})).status,401)
  check('another deployment rejects the first project assertion audience and messaging token')
  const deploymentId=application.deploymentId
  await closeAgents();await application.close()
  application=await startMessaging({dataDir:path.join(directory,'relay-state'),hostIdentityConfig:trustFile})
  assert.equal(application.deploymentId,deploymentId)
  service=new RelayService(application.agentUrl,{audience})
  grants=[await emailHost.login(users[0]),await emailHost.login(users[1]),await staffHost.login(users[2])]
  assert.deepEqual(grants.map(grant=>grant.account.id),accountIds)
  clients=await Promise.all(grants.map((grant,index)=>agent(index,grant)));[alice,bob,carol]=clients
  const afterSafety=await alice.safetyNumber(users[2].handle);assert.equal(afterSafety.safetyNumber,safety.safetyNumber);assert.equal(afterSafety.verified,true)
  const reply=await carol.send({handle:users[0].handle,body:'after reconnect'},'step5-host-reconnected')
  await alice.sync();assert.equal((await alice.messages()).find(item=>item.id===reply.id).body,'after reconnect')
  check('host subject/account mapping, vault identity and conversations survive restart and fresh token reconnect')
  await assert.rejects(()=>alice.attach(service.attachInput(grants[1])))
  assert.equal((await alice.status()).unlocked,false)
  await assert.rejects(()=>alice.views())
  await alice.attach(service.attachInput(await emailHost.login(users[0])))
  assert.equal((await alice.status()).accountId,accountIds[0])
  check('account switch cancels the old connection and refuses silent vault reassignment')
  await service.revoke(grants[2].token)
  await assert.rejects(()=>carol.sync());assert.equal((await carol.status()).unlocked,false);await assert.rejects(()=>carol.views())
  check('messaging logout denies subsequent network access and clears detected agent authorization')
  const unused=assertion('email-host',emailKeys,users[1].subject,users[1].handle)
  await service.hostRevoke(assertion('email-host',emailKeys,users[1].subject,users[1].handle,'revoke'))
  await assert.rejects(()=>service.exchange(unused))
  await assert.rejects(()=>bob.sync());assert.equal((await bob.status()).unlocked,false)
  check('host logout revokes scoped sessions and prelogout unused assertions without touching other accounts')
  assert.equal((await alice.status()).unlocked,true)
  console.log(JSON.stringify({kind:'step5-generic-host-contract-acceptance',checkedAt:new Date().toISOString(),passed:true,syntheticDataOnly:true,checks,sourceRoot:path.resolve('.'),wireVersion:1,hostModels:['email/password','staff-number/PIN'],privateHostImplementationImported:false,limitations:['A host must stop issuing assertions when permission is revoked; fresh assertions after cutoff require a later issuedAt second.','Already authenticated in-flight operations can complete; detected revocation removes local authorization, not past independently stored history.']},null,2))
}finally{
  await closeAgents();await application?.close();await otherProject?.close();for(const item of hosts)await item.close()
  assert.equal(path.dirname(directory),tmpdir());assert(path.basename(directory).startsWith('endtoend-host-contract-'))
  await rm(directory,{recursive:true,force:true})
}
