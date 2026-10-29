// SPDX-License-Identifier: AGPL-3.0-only
// Clean-user acceptance: only offered HTTP bytes and separately extracted runtimes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {chromium} from 'playwright'

const flags={};for(let i=2;i<process.argv.length;i+=2){assert(process.argv[i]?.startsWith('--')&&process.argv[i+1]);flags[process.argv[i].slice(2)]=process.argv[i+1]}
for(const key of ['runtime-root','consumer-root','disclosure','receipt'])assert(flags[key],key+' is required')
const coreRoot=path.resolve(flags['runtime-root']),consumerRoot=path.resolve(flags['consumer-root'])
const disclosurePath=path.resolve(flags.disclosure),catalog=JSON.parse(fs.readFileSync(disclosurePath,'utf8'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const directory=await mkdtemp(path.join(tmpdir(),'endtoend-source-user-')),checks=[],downloads=[],pageErrors=[]
let application,web,desk,browser,failure
const adapters=[]
const checked=(name,details={})=>{checks.push({name,passed:true,...details});console.log(JSON.stringify({check:name,passed:true}))}
const text=(url)=>fetch(url,{redirect:'error',credentials:'omit'}).then(async response=>{assert.equal(response.status,200);return response.text()})
function member(name){assert(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&!name.split('/').some(part=>!part||part==='.'||part==='..'),'Unsafe archive member');return name}
function tar(args){const result=spawnSync('tar',args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});assert.equal(result.status,0,result.stderr);return result.stdout}
async function download(url,record,target){
  const response=await fetch(url,{credentials:'omit',redirect:'error'});assert.equal(response.status,200)
  const digest=createHash('sha256'),file=target&&fs.createWriteStream(target);let bytes=0
  try{for await(const chunk of response.body){bytes+=chunk.length;digest.update(chunk);if(file&&!file.write(chunk))await new Promise(resolve=>file.once('drain',resolve))}}
  finally{if(file)await new Promise((resolve,reject)=>{file.once('error',reject);file.end(resolve)})}
  assert.equal(bytes,record.bytes);assert.equal(digest.digest('hex'),record.sha256)
  const head=await fetch(url,{method:'HEAD',credentials:'omit',redirect:'error'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),record.bytes)
  downloads.push({url,bytes,sha256:record.sha256});return target
}
async function verifySource(origin,component){
  const prefix='/releases/'+catalog.version+'/',source=component.source
  const manifestResponse=await fetch(origin+prefix+source.manifestFilename,{credentials:'omit',redirect:'error'});assert.equal(manifestResponse.status,200)
  const manifestBytes=Buffer.from(await manifestResponse.arrayBuffer());assert.equal(hash(manifestBytes),source.manifestSha256)
  const manifest=JSON.parse(manifestBytes),output=path.join(directory,component.id+'-source'),archive=path.join(directory,component.id+'.tar.gz')
  await mkdir(output);await download(origin+prefix+source.filename,source,archive)
  const members=tar(['-tzf',archive]).trim().split(/\r?\n/).map(name=>member(name.replace(/^\.\//,'')))
  assert.equal(new Set(members).size,members.length)
  const expected=[...manifest.files.map(row=>row.path),source.manifestFilename].sort()
  assert.deepEqual([...members].sort(),expected)
  tar(['-xzf',archive,'-C',output])
  for(const row of manifest.files){const name=member(row.path),file=path.join(output,name),info=fs.lstatSync(file);assert(info.isFile()&&!info.isSymbolicLink());assert.equal(info.size,row.bytes);assert.equal(hash(fs.readFileSync(file)),row.sha256,name)}
  assert(!fs.existsSync(path.join(output,'node_modules')))
  checked(component.id+': anonymously downloaded source has exact manifest and every preferred-source file',{files:manifest.files.length,sha256:source.sha256})
}
try{
  const {startSdkConsumer}=await import(pathToFileURL(path.join(consumerRoot,'scripts/serve-sdk-consumer.mjs')).href)
  web=await startSdkConsumer({directory:path.join(consumerRoot,'apps/web/dist'),sdkRoot:consumerRoot,configPath:'/agent-config.json',sourceDisclosure:disclosurePath,releaseMode:true,componentId:'endtoend-web'})
  desk=await startSdkConsumer({directory:path.join(consumerRoot,'apps/desk-client'),sdkRoot:consumerRoot,sourceDisclosure:disclosurePath,releaseMode:true,componentId:'desk-client'})
  for(const host of [web,desk]){assert.equal((await fetch(host.url)).status,503);assert.equal((await fetch(host.url+'/source-disclosure.json')).status,200)}
  checked('both independent hosts expose source discovery before login or messaging configuration')
  const {startMessaging}=await import(pathToFileURL(path.join(coreRoot,'scripts/serve-messaging.mjs')).href)
  application=await startMessaging({sourceRoot:coreRoot,dataDir:path.join(directory,'state'),sourceDisclosure:disclosurePath,releaseMode:true,callerOrigins:[web.url,desk.url]})
  web.configure({agentUrl:application.agentUrl,relayUrl:application.agentUrl,nativeAuth:true})
  desk.configure({agentUrl:application.agentUrl,relayUrl:application.agentUrl,nativeAuth:true})
  const surfaces=[['messaging-core',application.agentUrl],['messaging-core',application.referenceUrl],['messaging-core',application.relayUrl],['endtoend-web',web.url],['desk-client',desk.url]]
  for(const [id,origin] of surfaces){
    const info=JSON.parse(await text(origin+'/release.json')),component=catalog.components.find(row=>row.id===id)
    assert.equal(info.version,component.version);assert.equal(info.sourceSha256,component.source.sha256);assert.equal(info.license,component.license)
    const available=JSON.parse(await text(origin+'/source-disclosure.json'));assert.equal(available.version,catalog.version)
    assert.equal(available.components.length,catalog.components.length)
    for(const expected of catalog.components){
      const exposed=available.components.find(row=>row.id===expected.id);assert(exposed)
      for(const field of ['version','license','source','artifacts','notices'])assert.deepEqual(exposed[field],expected[field])
      assert.equal(new URL(exposed.sourceUrl,origin).pathname,'/releases/'+catalog.version+'/'+expected.source.filename)
    }
    for(const notice of component.notices){assert.equal(hash(Buffer.from(await text(origin+'/releases/'+catalog.version+'/'+notice.filename))),notice.sha256)}
    const sourceUrl=new URL(info.sourceUrl,origin).href
    await download(sourceUrl,component.source)
    assert.equal((await fetch(sourceUrl,{method:'POST'})).status,405)
    assert.equal((await fetch(origin+'/releases/'+catalog.version+'/unlisted-private-file.txt')).status,404)
    checked(id+': running HTTP surface provides exact version/source/notices without credentials',{origin})
  }
  // Each distinct archive is extracted once; shared web/desk source remains a mixed-grant package.
  const unique=new Set()
  for(const component of catalog.components){if(unique.has(component.source.sha256))continue;unique.add(component.source.sha256);await verifySource(application.referenceUrl,component)}
  for(const component of catalog.components)for(const artifact of component.artifacts){
    if(downloads.some(row=>row.sha256===artifact.sha256))continue
    await download(application.referenceUrl+'/releases/'+catalog.version+'/'+artifact.filename,artifact)
  }
  checked('every downloadable runtime, browser package, SDK and manifest matches the disclosed hash')
  // Metadata paths need no account, capability, vault or fake messaging operation.
  for(const [file,entry,label] of [['http.ts','startHttp','HTTP'],['graphql.ts','startGraphql','GraphQL']]){
    const module=await import(pathToFileURL(path.join(coreRoot,'packages/headless/src',file)).href)
    const adapter=await module[entry]({}, {sourceDisclosure:disclosurePath,releaseMode:true});adapters.push(adapter)
    const info=JSON.parse(await text(adapter.url+'/release.json')),component=catalog.components.find(row=>row.id==='messaging-core')
    assert.equal(info.sourceSha256,component.source.sha256)
    await download(new URL(info.sourceUrl,adapter.url).href,component.source)
    assert.equal((await fetch(adapter.url+'/source-disclosure.json')).status,200)
    checked(label+' adapter: anonymous exact source/notice metadata while messaging stays gated')
  }
  const cliEnv={...process.env,ENDTOEND_RELEASE_MODE:'1',ENDTOEND_SOURCE_DISCLOSURE:disclosurePath,ENDTOEND_SOURCE_BASE_URL:application.referenceUrl}
  for(const [file,args,label] of [['packages/agent/src/cli.mjs',['--source'],'agent CLI'],['packages/headless/src/bin.ts',['--source'],'headless CLI']]){
    const result=spawnSync(process.execPath,['--import','tsx',file,...args],{cwd:coreRoot,env:cliEnv,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024})
    assert.equal(result.status,0,result.stderr);const info=JSON.parse(result.stdout),component=catalog.components.find(row=>row.id==='messaging-core')
    assert.equal(info.sourceSha256,component.source.sha256);assert.equal(new URL(info.sourceUrl).origin,application.referenceUrl)
    checked(label+': structured source discovery has an accessible absolute download URL')
  }
  const mcp=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import {serveMcp} from './packages/headless/src/mcp.ts'; await serveMcp({close:async()=>{}});"],{cwd:coreRoot,env:cliEnv,input:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})+'\n',encoding:'utf8',windowsHide:true,maxBuffer:1024*1024})
  assert.equal(mcp.status,0,mcp.stderr);const rpc=JSON.parse(mcp.stdout.trim());assert.equal(rpc.id,1);assert(!rpc.error)
  const mcpInfo=rpc.result._meta.licenseInfo;assert.equal(mcpInfo.sourceSha256,catalog.components.find(row=>row.id==='messaging-core').source.sha256);assert.equal(new URL(mcpInfo.sourceUrl).origin,application.referenceUrl)
  checked('MCP stdio discovery preserves JSON-RPC framing and exact usable source metadata')
  browser=await chromium.launch({headless:true});const context=await browser.newContext()
  const pages=[['reference',application.referenceUrl,'messaging-core'],['trusted',application.agentUrl,'messaging-core'],['full frontend',web.url,'endtoend-web'],['independent desk',desk.url,'desk-client']]
  for(const [label,url,id] of pages){
    const page=await context.newPage();page.on('pageerror',error=>pageErrors.push({label,error:error.message}))
    await page.goto(url);const source=page.getByRole('link',{name:/corresponding source|download.*source|source.*for this version/i}).first();await source.waitFor({state:'visible'})
    const href=await source.getAttribute('href');assert(href&&href!=='#')
    const component=catalog.components.find(row=>row.id===id),sourceUrl=new URL(href,page.url()).href
    assert.equal(new URL(sourceUrl).pathname,'/releases/'+catalog.version+'/'+component.source.filename)
    await download(sourceUrl,component.source)
    for(const kind of ['license','notices']){
      const link=page.getByRole('link',{name:new RegExp(kind,'i')}).first();await link.waitFor({state:'visible'})
      const selected=new URL(await link.getAttribute('href'),page.url()),record=component.notices.find(row=>selected.pathname==='/releases/'+catalog.version+'/'+row.filename)
      assert(record,label+' visible '+kind+' link is outside exact component notices');await download(selected.href,record)
    }
    if(['endtoend-web','desk-client'].includes(id)){
      const serviceLink=page.getByRole('link',{name:'Messaging service source',exact:true});await serviceLink.waitFor({state:'visible'})
      const serviceUrl=new URL(await serviceLink.getAttribute('href'),page.url())
      assert.equal(serviceUrl.origin,application.agentUrl)
      const service=JSON.parse(await text(serviceUrl.href)),core=service.components.find(row=>row.id==='messaging-core')
      assert.equal(core.source.sha256,catalog.components.find(row=>row.id==='messaging-core').source.sha256)
    }
    checked(label+': visible source/license/notices before account or vault unlock')
    await page.close()
  }
  assert.deepEqual(pageErrors,[]);checked('source-discovery pages load without browser JavaScript errors')
}catch(error){failure=error;console.error(error.stack??String(error))}
finally{
  await browser?.close();for(const adapter of adapters)await adapter.close();await web?.close();await desk?.close();await application?.close()
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('endtoend-source-user-'))
  await rm(directory,{recursive:true,force:true})
  const receipt={kind:'endtoend-step-8-clean-user-source-delivery',passed:!failure,checkedAt:new Date().toISOString(),disclosureSha256:hash(fs.readFileSync(disclosurePath)),coreRoot,consumerRoot,checks,downloads,pageErrors,failure:failure?.message??null,published:false,productionChanged:false}
  fs.mkdirSync(path.dirname(path.resolve(flags.receipt)),{recursive:true});await writeFile(path.resolve(flags.receipt),JSON.stringify(receipt,null,2)+'\n')
}
if(failure)process.exitCode=1
