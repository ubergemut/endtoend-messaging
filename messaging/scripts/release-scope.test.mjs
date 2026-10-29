// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {workspaceInputs,verifyEntries,freezeScope,checkScope} from './release-scope.mjs'

async function fixture(action){
  const root=await mkdtemp(join(tmpdir(),'endtoend-scope-'))
  const put=async(path,text='fixture')=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text)}
  try{return await action(root,put)}finally{
    if(!resolve(root).startsWith(join(resolve(tmpdir()),'endtoend-scope-')))throw new Error('Unexpected fixture cleanup path')
    await rm(root,{recursive:true,force:true})
  }
}

test('scope baseline excludes private state and generated output before reading while retaining real sources',()=>fixture(async(root,put)=>{
  for(const file of ['LICENSE','LICENSING.md','README.md','package.json','yarn.lock','docs/PROTOCOL.md','docs/THREAT-MODEL.md','docs/release/FEATURE_MATRIX.md','docs/release/BASELINE.json','docs/release/AGPL_MVP_TEN_STEP_PLAN.md','scripts/dev.mjs','scripts/local-ports.mjs','scripts/serve-endtoend.mjs','scripts/build-crypto.ps1'])await put(file)
  for(const file of ['apps/example/src/main.ts','packages/engine/src/nodeVault.ts','apps/example/.env','apps/example/vault/device.json','apps/example/data/accounts.json','apps/example/public/user.sqlite','apps/example/node_modules/tool/source.js','apps/example/dist/bundle.js','packages/crypto/pkg-web/output.wasm'])await put(file)
  const paths=workspaceInputs(root).map(item=>item.path)
  assert(paths.includes('apps/example/src/main.ts'))
  assert(paths.includes('packages/engine/src/nodeVault.ts'))
  assert(!paths.some(path=>/\.env|\/vault\/|\/data\/|user\.sqlite|node_modules|\/dist\/|pkg-web/.test(path)))
}))

test('frozen file verification detects edits and rejects traversal paths even with a correct content hash',()=>fixture(async(root,put)=>{
  await put('source/input.ts','original')
  const entry={path:'source/input.ts',bytes:8,sha256:createHash('sha256').update('original').digest('hex')}
  assert.deepEqual(verifyEntries(root,[entry]),[])
  await put('source/input.ts','modified')
  assert.deepEqual(verifyEntries(root,[entry]),['Frozen input changed: source/input.ts'])
  for(const path of ['../outside.ts','source/../source/input.ts','source\\input.ts','/outside.ts'])assert(verifyEntries(root,[{...entry,path}]).some(issue=>issue.startsWith('Unsafe frozen path:')))
}))

test('frozen verification refuses a directory junction even when redirected content matches',()=>fixture(async(root,put)=>{
  await put('outside/input.ts','matching')
  await mkdir(join(root,'frozen'),{recursive:true})
  await symlink(join(root,'outside'),join(root,'frozen/linked'),process.platform==='win32'?'junction':'dir')
  const entry={path:'linked/input.ts',bytes:8,sha256:createHash('sha256').update('matching').digest('hex')}
  assert.deepEqual(verifyEntries(join(root,'frozen'),[entry]),['Frozen input missing or unsafe: linked/input.ts'])
}))

test('scope verification refuses a newly added implementation file after the freeze',()=>fixture(async(root,put)=>{
  for(const file of ['LICENSE','LICENSING.md','README.md','yarn.lock','docs/PROTOCOL.md','docs/THREAT-MODEL.md','docs/release/AGPL_MVP_TEN_STEP_PLAN.md','scripts/dev.mjs','scripts/local-ports.mjs','scripts/serve-endtoend.mjs','scripts/build-crypto.ps1'])await put(file)
  await put('package.json','{}')
  await put('docs/release/FEATURE_MATRIX.md',await readFile(new URL('../docs/release/FEATURE_MATRIX.md',import.meta.url),'utf8'))
  await put('docs/release/BASELINE.json',JSON.stringify({originalCommit:'fixture',originalTrackedFiles:[]}))
  await put('docs/release/REVIEW_DECISIONS.json',JSON.stringify({firstPartyConfirmation:{statement:'Yes, I control the first-party rights'}}))
  for(const [name,path] of [['crypto','packages/crypto'],['session','packages/session'],['agent','packages/agent'],['agent-browser','apps/agent-browser'],['api','apps/api'],['contract','packages/contract'],['headless','packages/headless'],['protocol','packages/protocol'],['client','packages/client'],['web','apps/web']])await put(`${path}/package.json`,JSON.stringify({name:`@e2ee/${name}`,version:'fixture',license:['client','protocol'].includes(name)?'MIT':'AGPL-3.0-only'}))
  for(const name of ['endtoend-agent-0.1.0.tar.gz','endtoend-agent-runtime-0.1.0.tar.gz','endtoend-client-0.1.0.tar.gz','RELEASE_INDEX.json','SOURCE_MANIFEST.json','RUNTIME_MANIFEST.json','CLIENT_MANIFEST.json'])await put(`evidence/${name}`)
  await put('evidence/agent-0.1.0-candidate-2/receipt.json','{}')
  freezeScope(root,join(root,'evidence'))
  assert.equal(checkScope(root,join(root,'evidence')).passed,true)
  await put('packages/agent/src/unreviewed.ts','new implementation')
  const result=checkScope(root,join(root,'evidence'))
  assert.equal(result.passed,false)
  assert(result.issues.includes('Source added after scope freeze: packages/agent/src/unreviewed.ts'))
}))
