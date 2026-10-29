// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {checkPublishedSource} from './check-published-source.mjs'

const hash=value=>createHash('sha256').update(value).digest('hex')
async function fixture(run){
  const parent=path.resolve(tmpdir()),prefix='endtoend-published-source-'
  const root=await fs.mkdtemp(path.join(parent,prefix))
  async function put(name,value){
    const filename=path.resolve(root,name),relative=path.relative(root,filename)
    assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))
    const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value))
    await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,bytes)
    return{filename:path.basename(filename),bytes:bytes.length,sha256:hash(bytes)}
  }
  try{
    const source=async(folder,manifestFilename,sdk=false)=>{
      const value='editable '+folder+' source\n'
      await put(folder+'/src/index.js',value)
      const manifest={...(sdk?{sdkVersion:'0.2.1',license:'MIT'}:{version:'0.2.0'}),files:[{path:'src/index.js',bytes:Buffer.byteLength(value),sha256:hash(value)}]}
      const row=await put(folder+'/'+manifestFilename,manifest)
      return{filename:folder+'-source.tar.gz',bytes:1,sha256:hash(folder),manifestFilename,manifestSha256:row.sha256}
    }
    const core=await source('messaging','SOURCE_MANIFEST.json'),consumers=await source('consumers','CONSUMER_SOURCE_MANIFEST.json'),sdk=await source('sdk','SDK_MANIFEST.json',true)
    const runtime=async(name,source)=>{
      const manifestFilename=name==='messaging'?'RUNTIME_MANIFEST.json':'CONSUMER_RUNTIME_MANIFEST.json'
      const row=await put('release/'+manifestFilename,{version:'0.2.0',matchingSourceSha256:source.sha256,matchingSourceManifestSha256:source.manifestSha256,files:[{path:'fixture',bytes:1,sha256:hash('x')}]})
      return[{filename:name+'-runtime.tar.gz',bytes:1,sha256:hash(name+'-runtime')},row]
    }
    const coreArtifacts=await runtime('messaging',core),consumerArtifacts=await runtime('consumers',consumers)
    const component=(id,license,source,artifacts)=>({id,license,version:id==='mit-sdk'?'0.2.1':'0.2.0',source,artifacts,notices:[{filename:license==='MIT'?'MIT_LICENSE.txt':'AGPL_LICENSE.txt',bytes:1,sha256:hash(license)}]})
    const descriptor={schemaVersion:1,version:'0.2.0',components:[component('messaging-core','AGPL-3.0-only',core,coreArtifacts),component('endtoend-web','AGPL-3.0-only',consumers,consumerArtifacts),component('desk-client','MIT',consumers,consumerArtifacts),component('mit-sdk','MIT',sdk,[{filename:sdk.filename,bytes:sdk.bytes,sha256:sdk.sha256}])]}
    let expected
    async function save(){expected=(await put('release/source-disclosure.json',descriptor)).sha256}
    await save()
    const audit=(expectedHash=expected)=>checkPublishedSource({root,catalog:path.join(root,'release/source-disclosure.json'),expectedCatalogSha256:expectedHash})
    await run({root,put,audit,descriptor,save})
  }finally{
    assert.equal(path.dirname(path.resolve(root)),parent)
    assert(path.basename(root).startsWith(prefix))
    await fs.rm(root,{recursive:true,force:true})
  }
}

test('three exact source trees and five manifest identities pass without archive payloads in Git',()=>fixture(async f=>{
  const result=await f.audit()
  assert.equal(result.passed,true,JSON.stringify(result))
  assert.deepEqual(result.sourceTrees.map(row=>row.filesChecked),[1,1,1])
  assert.equal(result.runtimeManifests.length,2)
}))

test('an independent catalog pin is mandatory and changed catalog bytes fail closed',()=>fixture(async f=>{
  assert.equal((await f.audit(null)).passed,false)
  const old=hash(await fs.readFile(path.join(f.root,'release/source-disclosure.json')))
  await f.put('release/source-disclosure.json',JSON.stringify(f.descriptor)+'\n')
  assert.match((await f.audit(old)).issues.join(),/independently approved hash/)
}))

test('source tampering and unlisted raw source fail while known build outputs are allowed',()=>fixture(async f=>{
  await f.put('messaging/node_modules/fixture/index.js','installed tool')
  await f.put('messaging/packages/crypto/pkg-node/output.wasm','compiled output')
  assert.equal((await f.audit()).passed,true)
  await f.put('consumers/unlisted.js','unexpected source')
  assert.match((await f.audit()).issues.join(),/Unlisted source file/)
  await fs.unlink(path.join(f.root,'consumers/unlisted.js'))
  await f.put('sdk/src/index.js','tampered source')
  assert.match((await f.audit()).issues.join(),/Source file differs/)
}))

test('rewritten manifests cannot change the approved source inventory',()=>fixture(async f=>{
  await f.put('messaging/SOURCE_MANIFEST.json',{version:'0.2.0',files:[]})
  assert.match((await f.audit()).issues.join(),/Source manifest hash mismatch/)
}))

test('traversal and Windows alternate streams are rejected even by a repinned malformed manifest',()=>fixture(async f=>{
  for(const unsafe of ['../outside.js','index.js:stream','nested\\index.js','bad\nname.js']){
    const row=await f.put('messaging/SOURCE_MANIFEST.json',{version:'0.2.0',files:[{path:unsafe,bytes:0,sha256:hash('')}]})
    f.descriptor.components[0].source.manifestSha256=row.sha256
    await f.save()
    assert.match((await f.audit()).issues.join(),/Unsafe source path/)
  }
}))

test('symlinked source cannot substitute for an approved file',()=>fixture(async f=>{
  const directory=path.join(f.root,'messaging/src'),moved=path.join(f.root,'messaging/original-src')
  await fs.rename(directory,moved)
  await fs.symlink(moved,directory,process.platform==='win32'?'junction':'dir')
  assert.match((await f.audit()).issues.join(),/Symlink/)
}))

test('component grants and runtime/source correspondence are enforced independently of the catalog pin',()=>fixture(async f=>{
  f.descriptor.components[1].license='MIT';await f.save()
  assert.match((await f.audit()).issues.join(),/Component grant\/version/)
  f.descriptor.components[1].license='AGPL-3.0-only'
  const row=await f.put('release/RUNTIME_MANIFEST.json',{version:'0.2.0',matchingSourceSha256:hash('wrong source'),matchingSourceManifestSha256:f.descriptor.components[0].source.manifestSha256})
  f.descriptor.components[0].artifacts[1]=row;await f.save()
  assert.match((await f.audit()).issues.join(),/Runtime\/source binding/)
}))
