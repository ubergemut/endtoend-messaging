// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash,randomBytes} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {startReleaseApplication} from './serve-endtoend.mjs'
import {startMessaging} from './serve-messaging.mjs'
import {startServer} from '../apps/api/src/server.ts'
import {startLocalAgent} from '../packages/agent/src/local.ts'
import {startHttp} from '../packages/headless/src/http.ts'
import {startGraphql} from '../packages/headless/src/graphql.ts'
import {handleMcp} from '../packages/headless/src/mcp.ts'
import {AgentClient,HttpAgentTransport} from '../packages/client/src/index.ts'
const root=fileURLToPath(new URL('../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'endtoend-core-source-'))
  const closers=[]
  t.after(async()=>{try{for(const close of closers.reverse())await close()}finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('endtoend-core-source-'));await fs.rm(directory,{recursive:true,force:true})}})
  const put=async(name,value)=>{const bytes=Buffer.from(typeof value==='object'?JSON.stringify(value):value);await fs.mkdir(path.dirname(path.join(directory,name)),{recursive:true});await fs.writeFile(path.join(directory,name),bytes);return{filename:name,sha256:hash(bytes),bytes:bytes.length}}
  const source=await put('messaging-0.2.0-source.tar.gz','fresh synthetic source archive'),manifest=await put('SOURCE_MANIFEST.json',{files:[]})
  const license=await put('messaging-LICENSE.txt','AGPL test license'),notices=await put('messaging-NOTICES.txt','Retained test dependency notices')
  const publicLicense=await fs.readFile(path.join(root,'LICENSE'))
  const runtime=await put('RUNTIME_MANIFEST.json',{matchingSourceSha256:source.sha256,matchingSourceManifestSha256:manifest.sha256,files:[{path:'LICENSE',bytes:publicLicense.length,sha256:hash(publicLicense)}]})
  const descriptor={schemaVersion:1,version:'0.2.0',components:[{id:'messaging-core',version:'0.2.0',license:'AGPL-3.0-only',artifacts:[runtime],source:{...source,manifestFilename:manifest.filename,manifestSha256:manifest.sha256},notices:[license,notices]}]}
  await put('SOURCE_DISCLOSURE.json',descriptor)
  for(const kind of ['reference','agent']){await put(`${kind}/index.html`,'<!doctype html><title>Synthetic reference</title>');await put(`${kind}/LICENSE.txt`,'AGPL test license')}
  return{directory,put,source,closeWith:callback=>closers.push(callback),filename:path.join(directory,'SOURCE_DISCLOSURE.json'),productDist:path.join(directory,'reference'),agentDist:path.join(directory,'agent')}
}
test('combined launcher and bare relay disclose exact source and notices before authentication',async t=>{
  const f=await fixture(t),app=await startReleaseApplication({productDist:f.productDist,agentDist:f.agentDist,relayDataDir:path.join(f.directory,'new-relay'),sourceDisclosure:f.filename})
  f.closeWith(()=>app.close())
  for(const base of [app.productUrl,app.agentUrl,app.relayUrl]){
    const response=await fetch(base+'/release.json');assert.equal(response.status,200);const info=await response.json();assert.equal(info.version,'0.2.0');assert.equal(info.sourceSha256,f.source.sha256)
    for(const url of [info.sourceUrl,info.manifestUrl,info.licenseUrl,info.noticesUrl])assert.equal((await fetch(new URL(url,base))).status,200)
    const bytes=Buffer.from(await(await fetch(new URL(info.sourceUrl,base))).arrayBuffer());assert.equal(hash(bytes),f.source.sha256)
    assert.equal((await fetch(base+'/api/friends')).status,401)
  }
  const config=await(await fetch(app.agentUrl+'/config.json')).json();assert.equal(new URL(config.sourceUrl).origin,app.agentOrigin);assert.equal(config.sourceStatus,'verified')
  const metadata=await(await fetch(app.relayUrl+'/messaging/v1/metadata')).json();assert.equal(metadata.licenseInfo.sourceSha256,f.source.sha256);assert.equal(metadata.sourceDisclosureUrl,'/source-disclosure.json')
})
test('release startup refuses missing/tampered source before relay or managed state is created',async t=>{
  const f=await fixture(t),data=path.join(f.directory,'must-not-open')
  await assert.rejects(startMessaging({releaseMode:true,dataDir:data,sourceDisclosure:''}),/requires a source disclosure/)
  await assert.rejects(startServer({releaseMode:true,dataDir:data,sourceDisclosure:''}),/requires a source disclosure/)
  await f.put(f.source.filename,'tampered synthetic archive')
  await assert.rejects(startMessaging({sourceDisclosure:f.filename,dataDir:data}),/size changed|checksum mismatch/)
  await assert.rejects(fs.access(data),{code:'ENOENT'})
})
test('release mode rejects browser distributions outside the verified core runtime',async t=>{
  const f=await fixture(t),data=path.join(f.directory,'must-not-open')
  await assert.rejects(startReleaseApplication({releaseMode:true,sourceDisclosure:f.filename,productDist:f.productDist,agentDist:f.agentDist,relayDataDir:data}),/verified installed messaging reference and agent/)
  await assert.rejects(startMessaging({releaseMode:true,sourceDisclosure:f.filename,referenceDist:f.productDist,agentDist:f.agentDist,dataDir:data}),/verified installed messaging reference and agent/)
  await assert.rejects(fs.access(data),{code:'ENOENT'})
})
test('local agent license command and public notice routes work while the vault is locked',async t=>{
  const f=await fixture(t),vault=path.join(f.directory,'new-device.json')
  await assert.rejects(startLocalAgent({relay:'http://127.0.0.1:9',vaultPath:vault,releaseMode:true,sourceDisclosure:''}),/requires a source disclosure/)
  await assert.rejects(fs.access(vault),{code:'ENOENT'})
  const agent=await startLocalAgent({relay:'http://127.0.0.1:9',vaultPath:vault,deviceKey:randomBytes(32).toString('base64'),sourceDisclosure:f.filename})
  f.closeWith(()=>agent.close())
  const info=await(await fetch(agent.url+'/licenseInfo')).json();assert.equal(info.version,'0.2.0');assert.equal(info.sourceSha256,f.source.sha256);assert.equal(new URL(info.sourceUrl).origin,agent.url)
  assert.equal((await fetch(info.sourceUrl)).status,200)
  const client=new AgentClient(new HttpAgentTransport(agent.url,agent.capability));assert.equal((await client.license()).sourceUrl,info.sourceUrl)
  assert.equal((await fetch(agent.url+'/v1/command',{method:'POST'})).status,403)
})
test('HTTP/GraphQL adapters expose public source metadata while operations stay capability protected',async t=>{
  const f=await fixture(t),client=new Proxy({},{get(){throw new Error('Public source must not call the device client')}})
  const http=await startHttp(client,{sourceDisclosure:f.filename}),graph=await startGraphql(client,{sourceDisclosure:f.filename})
  f.closeWith(async()=>{await http.close();await graph.close()})
  for(const adapter of [http,graph]){
    const info=await(await fetch(adapter.url+'/release.json')).json();assert.equal(info.sourceSha256,f.source.sha256);assert.equal(info.version,'0.2.0')
    assert.equal((await fetch(new URL(info.sourceUrl,adapter.url))).status,200)
    assert.equal((await fetch(adapter.url+'/source-disclosure.json')).status,200)
  }
  assert.equal((await fetch(http.url+'/status')).status,401)
  assert.equal((await fetch(graph.url,{method:'POST',headers:{'content-type':'application/json'},body:'{"query":"{ status }"}'})).status,401)
  const result=await handleMcp(client,{id:1,method:'initialize'},{version:'0.2.0',license:'AGPL-3.0-only',clientLicense:'MIT',sourceUrl:'https://example.invalid/releases/0.2.0/source.tar.gz',noticesUrl:'https://example.invalid/releases/0.2.0/NOTICES.txt'})
  assert.match(result.result.instructions,/releases\/0\.2\.0/);assert.match(result.result._meta.licenseInfo.noticesUrl,/NOTICES/)
})
test('agent/headless CLI source notices require no vault and release calls refuse missing disclosure first',async t=>{
  const f=await fixture(t),vault=path.join(f.directory,'never-open.json')
  const env={...process.env,ENDTOEND_SOURCE_DISCLOSURE:f.filename,ENDTOEND_SOURCE_BASE_URL:'https://example.invalid',ENDTOEND_RELEASE_MODE:'1',ENDTOEND_RELAY:'http://127.0.0.1:9',ENDTOEND_VAULT:vault,ENDTOEND_DEVICE_KEY:''}
  for(const entry of ['packages/agent/src/cli.mjs','packages/headless/src/bin.ts']){
    const result=spawnSync(process.execPath,['--import','tsx',path.join(root,entry),'--source'],{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);const info=JSON.parse(result.stdout);assert.equal(info.sourceSha256,f.source.sha256);assert.match(info.sourceUrl,/^https:\/\/example\.invalid\/releases\/0\.2\.0\//)
  }
  const refused=spawnSync(process.execPath,['--import','tsx',path.join(root,'packages/headless/src/bin.ts'),'call','status'],{env:{...env,ENDTOEND_SOURCE_DISCLOSURE:''},encoding:'utf8',windowsHide:true})
  assert.notEqual(refused.status,0);assert.match(refused.stderr,/requires a source disclosure/)
  await assert.rejects(fs.access(vault),{code:'ENOENT'})
})
