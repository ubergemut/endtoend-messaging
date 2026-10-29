// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {consumerSourceFiles,safeConsumerSourcePath,verifyConsumerSource,prepareConsumerSource} from './package-consumer-source.mjs'

function fixture(run){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'endtoend-consumer-source-'))
  try{return run(root)}finally{
    const resolved=fs.realpathSync(root),temporary=fs.realpathSync(os.tmpdir())
    assert(path.dirname(resolved)===temporary&&path.basename(resolved).startsWith('endtoend-consumer-source-'))
    fs.rmSync(resolved,{recursive:true,force:true})
  }
}

test('consumer source rejects Windows traversal, stream paths, private source and installed/generated inputs',()=>{
  for(const candidate of ['../LICENSE','C:/outside','C:outside','/LICENSE','apps/web/src/x:secret','apps/web/src/nul.txt','apps/web/src/x.','apps/web/.env','apps/web/node_modules/x.js','packages/agent/src/index.ts','apps/api/src/server.ts','apps/web/dist/index.html','secret.json'])assert.throws(()=>safeConsumerSourcePath(candidate),candidate)
  for(const candidate of ['LICENSE','apps/web/src/App.tsx','apps/desk-client/desk.js','packages/client/src/index.ts','dependencies/preferred-source/npm/react@19.3.0.tgz'])assert.equal(safeConsumerSourcePath(candidate),candidate)
})

test('consumer source manifest rejects altered bytes, added files, missing members and duplicate records',()=>fixture(root=>{
  fs.writeFileSync(path.join(root,'LICENSE'),'original grant')
  const manifest={kind:'endtoend-sdk-consumer-corresponding-source',files:consumerSourceFiles(root)}
  assert.equal(verifyConsumerSource(root,manifest).filesChecked,1)
  fs.writeFileSync(path.join(root,'LICENSE'),'changed grant');assert.throws(()=>verifyConsumerSource(root,manifest),/changed/)
  fs.writeFileSync(path.join(root,'LICENSE'),'original grant');fs.writeFileSync(path.join(root,'README.md'),'extra');assert.throws(()=>verifyConsumerSource(root,manifest),/membership/)
  fs.unlinkSync(path.join(root,'README.md'));assert.throws(()=>verifyConsumerSource(root,{...manifest,files:[...manifest.files,...manifest.files]}),/Duplicate/)
  fs.unlinkSync(path.join(root,'LICENSE'));assert.throws(()=>verifyConsumerSource(root,manifest),/membership/)
}))

test('consumer source preparation refuses a frontend already compiled before source freeze',()=>fixture(root=>{
  fs.mkdirSync(path.join(root,'apps/web/dist'),{recursive:true})
  assert.throws(()=>prepareConsumerSource({workspace:root,output:root,closureSource:root}),/before compiling/)
}))
