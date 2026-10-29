// SPDX-License-Identifier: MIT
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {loadSourceDisclosure,verifyDisclosedRuntime} from './source-disclosure.mjs'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'endtoend-disclosure-'))
  t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('endtoend-disclosure-'));await fs.rm(root,{recursive:true,force:true})})
  const put=async(name,text)=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});const bytes=Buffer.from(typeof text==='object'?JSON.stringify(text):text);await fs.writeFile(path.join(root,name),bytes);return{filename:name,sha256:hash(bytes),bytes:bytes.length}}
  const source=await put('messaging-0.2.0-source.tar.gz','synthetic source archive')
  const manifest=await put('SOURCE_MANIFEST.json',{files:[]})
  const license=await put('messaging-LICENSE.txt','AGPL-3.0-only test license text')
  const notices=await put('messaging-NOTICES.txt','Synthetic retained third-party notices')
  await put('runtime/program.js','synthetic executable source')
  const runtimeManifest={matchingSourceSha256:source.sha256,matchingSourceManifestSha256:manifest.sha256,files:[{path:'program.js',sha256:hash(Buffer.from('synthetic executable source')),bytes:27}]}
  const runtime=await put('RUNTIME_MANIFEST.json',runtimeManifest)
  const descriptor={schemaVersion:1,version:'0.2.0',components:[{id:'messaging-core',version:'0.2.0',license:'AGPL-3.0-only',artifacts:[runtime],source:{...source,manifestFilename:manifest.filename,manifestSha256:manifest.sha256},notices:[license,notices]}]}
  const filename=path.join(root,'SOURCE_DISCLOSURE.json')
  const save=()=>put('SOURCE_DISCLOSURE.json',descriptor)
  await save()
  return{root,filename,descriptor,put,save,source,manifest,runtimeManifest}
}
test('development may omit disclosure; a release or configured bad descriptor refuses',async()=>{
  assert.equal(await loadSourceDisclosure(),null)
  await assert.rejects(loadSourceDisclosure(undefined,{required:true}),/requires a source disclosure/)
  await assert.rejects(loadSourceDisclosure(path.join(os.tmpdir(),'nonexistent-endtoend-source-disclosure.json')),/ENOENT/)
})
test('verified version-specific source, manifests and notices download with GET/HEAD without authentication',async t=>{
  const f=await fixture(t),disclosure=await loadSourceDisclosure(f.filename,{required:true})
  const info=disclosure.component('messaging-core')
  assert.equal(info.sourceSha256,f.source.sha256);assert.match(info.sourceUrl,/\/releases\/0\.2\.0\/messaging-0\.2\.0-source/)
  assert.match(info.licenseUrl,/LICENSE/);assert.match(info.noticesUrl,/NOTICES/)
  assert.equal(disclosure.component('messaging-core','https://example.invalid').sourceUrl,'https://example.invalid'+info.sourceUrl)
  assert.throws(()=>disclosure.component('messaging-core','http://example.invalid'),/public base/)
  const server=createServer((req,res)=>{if(!disclosure.serve(req,res))res.writeHead(404).end()})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const base=`http://127.0.0.1:${server.address().port}`
  const index=await fetch(base+'/source-disclosure.json');assert.equal(index.status,200);assert.equal((await index.json()).components[0].sourceSha256,f.source.sha256)
  for(const url of [info.sourceUrl,info.manifestUrl,info.licenseUrl,info.noticesUrl,...info.artifactUrls]){
    const response=await fetch(base+url);assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>0)
    const head=await fetch(base+url,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0)
  }
  assert.equal((await fetch(base+info.sourceUrl,{method:'POST'})).status,405)
  assert.equal((await fetch(base+'/releases/old/missing.tar.gz')).status,404)
  assert.equal((await fetch(base+'/SOURCE_DISCLOSURE.json')).status,404)
  await f.put(f.source.filename,'tampered later disk content')
  assert.equal(await(await fetch(base+info.sourceUrl)).text(),'synthetic source archive') // Only already verified bytes are ever served.
})
test('source, manifest and retained notice hash changes refuse before serving',async t=>{
  const f=await fixture(t)
  for(const entry of [f.descriptor.components[0].source,...f.descriptor.components[0].notices]){
    const old=entry.sha256;entry.sha256='0'.repeat(64);await f.save();await assert.rejects(loadSourceDisclosure(f.filename),/checksum mismatch/);entry.sha256=old
  }
  f.descriptor.components[0].source.manifestSha256='0'.repeat(64);await f.save();await assert.rejects(loadSourceDisclosure(f.filename),/checksum mismatch/)
})
test('artifact names cannot traverse directories, use URLs, or follow symlinks',async t=>{
  const f=await fixture(t),row=f.descriptor.components[0].source,old=row.filename
  for(const name of ['../private','C:private','file:stream','https://example.invalid/source','sub/source.tar.gz','source\n.tar.gz']){row.filename=name;await f.save();await assert.rejects(loadSourceDisclosure(f.filename),/filename\/hash/)}
  row.filename=old;await f.save()
  await fs.rename(path.join(f.root,old),path.join(f.root,'target-source'))
  const target=process.platform==='win32'?path.join(f.root,'junction-target'):path.join(f.root,'target-source')
  if(process.platform==='win32')await fs.mkdir(target)
  await fs.symlink(target,path.join(f.root,old),process.platform==='win32'?'junction':'file')
  await assert.rejects(loadSourceDisclosure(f.filename),/symlinked/)
})
test('runtime verification binds actual executable files and the offered source',async t=>{
  const f=await fixture(t),disclosure=await loadSourceDisclosure(f.filename)
  assert.equal((await verifyDisclosedRuntime(disclosure,'messaging-core',path.join(f.root,'runtime'))).filesChecked,1)
  await f.put('runtime/program.js','modified executable source!')
  await assert.rejects(verifyDisclosedRuntime(disclosure,'messaging-core',path.join(f.root,'runtime')),/runtime file differs/)
  f.runtimeManifest.matchingSourceSha256='0'.repeat(64);f.descriptor.components[0].artifacts[0]=await f.put('RUNTIME_MANIFEST.json',f.runtimeManifest);await f.save()
  await assert.rejects(verifyDisclosedRuntime(await loadSourceDisclosure(f.filename),'messaging-core',path.join(f.root,'runtime')),/does not match the offered source/)
})
test('runtime paths reject Windows drives, alternate streams, traversal, and all controls',async t=>{
  const f=await fixture(t)
  for(const name of ['C:evil','file:stream','../program.js','a\\program.js','a\tfile','a\x01file','a\x7ffile']){
    f.runtimeManifest.files[0].path=name;f.descriptor.components[0].artifacts[0]=await f.put('RUNTIME_MANIFEST.json',f.runtimeManifest);await f.save()
    await assert.rejects(verifyDisclosedRuntime(await loadSourceDisclosure(f.filename),'messaging-core',path.join(f.root,'runtime')),/unsafe or duplicate runtime path/)
  }
})
