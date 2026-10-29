import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {sourceFiles,isGeneratedSourcePath} from './release-files.mjs'

test('source inventory excludes installed dependencies at every workspace depth',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'endtoend-release-inventory-'))
  const paths=['README.md','apps/agent-browser/src/main.ts','packages/agent/src/local.ts','node_modules/tool/index.js','apps/agent-browser/node_modules/vite/index.js','packages/agent/node_modules/.bin/tsx','packages/crypto/pkg-web/product.wasm','.build/rust-target/output','apps/agent-browser/dist/index.html']
  try{
    for(const file of paths){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),'fixture')}
    assert.deepEqual(sourceFiles(directory).map(file=>file.path),['README.md','apps/agent-browser/src/main.ts','packages/agent/src/local.ts'])
  }finally{
    if(!resolve(directory).startsWith(join(resolve(tmpdir()),'endtoend-release-inventory-')))throw new Error('Unexpected test directory')
    await rm(directory,{recursive:true,force:true})
  }
})

test('archive path guard preserves vendor source directories while rejecting generated workspace files',()=>{
  for(const file of ['apps/agent-browser/node_modules/vite/package.json','packages/agent/node_modules/.bin/tsx','node_modules/tool/index.js','packages/crypto/target/output','packages/crypto/pkg-node/product.wasm','.git/config'])assert.equal(isGeneratedSourcePath(file),true,file)
  for(const file of ['dependencies/cargo/vendor/src/target/mod.rs','dependencies/cargo/wit-bindgen-0.57.1/wasi-cli@0.2.0.wasm','packages/agent/src/nodeVault.ts'])assert.equal(isGeneratedSourcePath(file),false,file)
})

test('release audit rejects a correctly hashed manifest containing nested installed dependencies',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'endtoend-release-audit-'))
  const put=async(file,body)=>{await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),body)}
  try{
    await put('LICENSE','GNU AFFERO GENERAL PUBLIC LICENSE')
    for(const folder of ['packages/crypto','packages/session','packages/agent','apps/agent-browser','packages/protocol','packages/client']){
      const license=['packages/protocol','packages/client'].includes(folder)?'MIT':'AGPL-3.0-only'
      await put(`${folder}/package.json`,JSON.stringify({license}))
      if(license==='MIT')await put(`${folder}/LICENSE`,'MIT fixture')
    }
    await put('docs/release/REVIEW_DECISIONS.json',JSON.stringify({ownershipEvidenceComplete:true,qualifiedBoundaryReview:'pending'}))
    const path='apps/agent-browser/node_modules/vite/index.js',body='installed dependency fixture'
    await put(path,body)
    await put('SOURCE_MANIFEST.json',JSON.stringify({files:[{path,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}]}))
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./release-audit.mjs',import.meta.url)),directory],{encoding:'utf8',windowsHide:true})
    assert.equal(result.status,1,result.stderr)
    const audit=JSON.parse(result.stdout)
    assert.equal(audit.engineeringPassed,false)
    assert(audit.issues.some(issue=>issue.includes('Installed/generated files must not be source inputs')))
  }finally{
    if(!resolve(directory).startsWith(join(resolve(tmpdir()),'endtoend-release-audit-')))throw new Error('Unexpected test directory')
    await rm(directory,{recursive:true,force:true})
  }
})
