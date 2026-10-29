// SPDX-License-Identifier: MIT
// Ordinary release metadata and verified static downloads; no messaging implementation imports.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'

const fail=(condition,message)=>{if(!condition)throw new Error(`Source disclosure: ${message}`)}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const token=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value)
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const limits={descriptor:1024*1024,file:512*1024*1024,total:1024*1024*1024,notice:16*1024*1024,manifest:16*1024*1024,files:512,components:32}
const verifiedPayloads=new WeakMap()

/** Missing configuration is allowed only for development. Configured bad input always refuses. */
export async function loadSourceDisclosure(filename,{required=false}={}){
  if(!filename){fail(!required,'release mode requires a source disclosure file');return null}
  fail(typeof filename==='string','descriptor filename must be a path')
  const absolute=path.resolve(filename),directory=path.dirname(absolute)
  const descriptorStat=await fs.lstat(absolute)
  fail(descriptorStat.isFile()&&!descriptorStat.isSymbolicLink()&&descriptorStat.size<=limits.descriptor,'descriptor must be a bounded regular file')
  const descriptor=JSON.parse(await fs.readFile(absolute,'utf8'))
  fail(descriptor.schemaVersion===1&&token(descriptor.version),'unsupported schema or release version')
  fail(Array.isArray(descriptor.components)&&descriptor.components.length>0&&descriptor.components.length<=limits.components,'components are required')
  const files=new Map(),components=new Set()
  async function retain(row,maximum=limits.file){
    fail(row&&token(row.filename)&&digest(row.sha256),'artifact filename/hash is invalid')
    fail(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=maximum,'artifact size is invalid')
    const previous=files.get(row.filename)
    if(previous){fail(previous.sha256===row.sha256&&previous.bytes.length===row.bytes,'conflicting shared artifact');return}
    fail(files.size<limits.files,'too many artifacts')
    const artifact=path.join(directory,row.filename),stat=await fs.lstat(artifact)
    fail(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===row.bytes,'artifact missing, symlinked, or size changed: '+row.filename)
    fail([...files.values()].reduce((n,item)=>n+item.bytes.length,0)+stat.size<=limits.total,'total download size exceeds limit')
    const bytes=await fs.readFile(artifact)
    fail(bytes.length===row.bytes&&sha(bytes)===row.sha256,'artifact checksum mismatch: '+row.filename)
    files.set(row.filename,{bytes,sha256:row.sha256})
  }
  for(const component of descriptor.components){
    fail(token(component.id)&&!components.has(component.id)&&token(component.version)&&typeof component.license==='string'&&component.license.length<=100,'component identity/license is invalid')
    components.add(component.id)
    fail(Array.isArray(component.artifacts)&&component.artifacts.length>0&&component.artifacts.length<=64,'component artifacts are required')
    fail(Array.isArray(component.notices)&&component.notices.length>0&&component.notices.length<=256,'component notices are required')
    fail(component.notices.some(row=>/licen[cs]e|copying/i.test(row.filename??'')),'component license download is required')
    await retain(component.source)
    fail(token(component.source.manifestFilename)&&digest(component.source.manifestSha256),'source manifest is required')
    const manifestPath=path.join(directory,component.source.manifestFilename),manifestStat=await fs.lstat(manifestPath)
    fail(manifestStat.size<=limits.manifest,'source manifest exceeds limit')
    await retain({filename:component.source.manifestFilename,sha256:component.source.manifestSha256,bytes:manifestStat.size},limits.manifest)
    for(const row of component.notices)await retain(row,limits.notice)
    for(const row of component.artifacts)await retain(row)
  }
  const prefix=`/releases/${encodeURIComponent(descriptor.version)}`
  const link=(name,base)=>{
    if(!base)return`${prefix}/${encodeURIComponent(name)}`
    const origin=new URL(base)
    fail(!origin.username&&!origin.password&&!origin.search&&!origin.hash&&origin.pathname==='/'&&(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)),'public base must be HTTPS or a loopback HTTP origin')
    return new URL(`${prefix}/${encodeURIComponent(name)}`,origin).href
  }
  function component(id,base){
    const value=descriptor.components.find(item=>item.id===id)
    fail(value,'component is absent: '+id)
    const license=value.notices.find(row=>/licen[cs]e|copying/i.test(row.filename))
    const notices=value.notices.find(row=>/notices/i.test(row.filename))??value.notices[0]
    return {...value,sourceUrl:link(value.source.filename,base),sourceSha256:value.source.sha256,manifestUrl:link(value.source.manifestFilename,base),sourceManifestUrl:link(value.source.manifestFilename,base),sourceManifestSha256:value.source.manifestSha256,licenseUrl:link(license.filename,base),noticesUrl:link(notices.filename,base),noticeUrls:value.notices.map(row=>link(row.filename,base)),artifactUrls:value.artifacts.map(row=>link(row.filename,base)),disclosureUrl:base?new URL(`${prefix}/disclosure.json`,base).href:`${prefix}/disclosure.json`,sourceStatus:'verified'}
  }
  const publicInfo=base=>({schemaVersion:1,version:descriptor.version,components:descriptor.components.map(row=>component(row.id,base))})
  function serve(req,res){
    const pathname=new URL(req.url??'/','http://127.0.0.1').pathname
    const index=pathname==='/source-disclosure.json'||pathname===`${prefix}/disclosure.json`
    if(!index&&!pathname.startsWith('/releases/'))return false
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('access-control-allow-origin','*')
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'}).end();return true}
    if(index){const bytes=Buffer.from(JSON.stringify(publicInfo()));res.writeHead(200,{'content-type':'application/json','content-length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);return true}
    const item=[...files].find(([name])=>pathname===`${prefix}/${encodeURIComponent(name)}`)
    if(!item){res.writeHead(404).end('Release download not found');return true}
    const [name,{bytes,sha256}]=item
    const contentType=/\.(?:tar\.gz|tgz)$/.test(name)?'application/gzip':name.endsWith('.json')?'application/json':name.endsWith('.txt')||/licen[cs]e|copying|notice/i.test(name)?'text/plain; charset=utf-8':'application/octet-stream'
    res.writeHead(200,{'content-type':contentType,'content-length':bytes.length,'content-disposition':`attachment; filename="${name}"`,etag:`"${sha256}"`})
    res.end(req.method==='HEAD'?undefined:bytes);return true
  }
  const disclosure={descriptor,publicInfo,component,serve}
  verifiedPayloads.set(disclosure,files)
  return disclosure
}

/** Check the currently executing installed files against a disclosed, source-bound runtime manifest. */
export async function verifyDisclosedRuntime(disclosure,componentId,runtimeRoot,manifestFilename='RUNTIME_MANIFEST.json'){
  const component=disclosure?.descriptor.components.find(item=>item.id===componentId)
  fail(component&&component.artifacts.some(row=>row.filename===manifestFilename),'runtime manifest must be a disclosed artifact')
  const payload=verifiedPayloads.get(disclosure)?.get(manifestFilename)
  fail(payload,'runtime manifest is not verified')
  const manifest=JSON.parse(payload.bytes.toString('utf8'))
  fail(manifest.matchingSourceSha256===component.source.sha256&&manifest.matchingSourceManifestSha256===component.source.manifestSha256,'runtime manifest does not match the offered source')
  fail(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=100000,'runtime manifest files are required')
  const root=path.resolve(runtimeRoot),seen=new Set()
  for(const row of manifest.files){
    fail(row&&typeof row.path==='string'&&!path.isAbsolute(row.path)&&!/[\\:\x00-\x1f\x7f]/.test(row.path)&&!row.path.split('/').some(part=>!part||part==='.'||part==='..')&&!seen.has(row.path),'unsafe or duplicate runtime path')
    seen.add(row.path)
    fail(digest(row.sha256)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=limits.file,'runtime member metadata is invalid')
    let current=root
    for(const part of row.path.split('/')){current=path.join(current,part);fail(!(await fs.lstat(current)).isSymbolicLink(),'runtime symlink refused: '+row.path)}
    const stat=await fs.lstat(current)
    fail(stat.isFile()&&stat.size===row.bytes&&sha(await fs.readFile(current))===row.sha256,'runtime file differs: '+row.path)
  }
  return {passed:true,componentId,filesChecked:seen.size,sourceSha256:component.source.sha256,sourceManifestSha256:component.source.manifestSha256,runtimeManifestSha256:payload.sha256}
}
