// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {closureFiles,verifyClosure,packageClosure,preferredSourceSelection} from './release-source-closure.mjs'

test('preferred-source closure rejects tampered and unmanifested inputs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'endtoend-closure-'))
  try{
    await writeFile(join(root,'source.fst'),'preferred input')
    const manifest={files:closureFiles(root)}
    assert.equal(verifyClosure(root,manifest).passed,true)
    await writeFile(join(root,'source.fst'),'altered input')
    assert(verifyClosure(root,manifest).issues.some(issue=>issue==='Closure file changed: source.fst'))
    await writeFile(join(root,'unreviewed.patch'),'new transform')
    assert(verifyClosure(root,manifest).issues.some(issue=>issue==='Unmanifested closure file: unreviewed.patch'))
    assert(verifyClosure(root,{files:[{...manifest.files[0],path:'../outside'}]}).issues.some(issue=>issue.startsWith('Unsafe or duplicate closure path:')))
  }finally{
    if(!resolve(root).startsWith(join(resolve(tmpdir()),'endtoend-closure-')))throw new Error('Unexpected closure fixture path')
    await rm(root,{recursive:true,force:true})
  }
})

test('closure keeps upstream source fixtures named node_modules but refuses installed workspace dependencies',async()=>{
  const root=await mkdtemp(join(tmpdir(),'endtoend-closure-'))
  try{
    const fixture='dependencies/preferred-source/upstream/tests/node_modules/fixture.js'
    await mkdir(join(root,fixture,'..'),{recursive:true});await writeFile(join(root,fixture),'upstream fixture')
    assert.deepEqual(closureFiles(root).map(file=>file.path),[fixture])
    await mkdir(join(root,'scripts/node_modules'),{recursive:true})
    await writeFile(join(root,'scripts/node_modules/installed.js'),'installed tool')
    assert.throws(()=>closureFiles(root),/Unexpected closure payload: scripts\/node_modules/)
  }finally{
    if(!resolve(root).startsWith(join(resolve(tmpdir()),'endtoend-closure-')))throw new Error('Unexpected closure fixture path')
    await rm(root,{recursive:true,force:true})
  }
})

test('closure refuses an output nested inside source inputs before copying',async()=>{
  const root=await mkdtemp(join(tmpdir(),'endtoend-closure-'))
  try{
    for(const file of ['LICENSE','LICENSING.md','yarn.lock','packages/crypto/Cargo.lock','packages/crypto/Cargo.toml','docs/release/AGPL_MVP_TEN_STEP_PLAN.md','docs/release/FEATURE_MATRIX.md']){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),'fixture')}
    for(const directory of ['docs/release/scope','docs/release/source-closure','docs/release/inventory','dependencies/preferred-source'])await mkdir(join(root,directory),{recursive:true})
    assert.throws(()=>packageClosure(root,join(root,'dependencies/preferred-source/recursive-output')),/Closure output overlaps an input: dependencies\/preferred-source/)
  }finally{
    if(!resolve(root).startsWith(join(resolve(tmpdir()),'endtoend-closure-')))throw new Error('Unexpected closure fixture path')
    await rm(root,{recursive:true,force:true})
  }
})

test('source selection retains authoritative archives and audit inputs without duplicating expanded upstream trees',async()=>{
  const root=await mkdtemp(join(tmpdir(),'endtoend-closure-'))
  const put=async(file,content='fixture')=>{await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),content)}
  try{
    const base='dependencies/preferred-source/pglite-test'
    for(const file of ['source.tar.gz','PROVENANCE.json','embedded/library.tar.gz','postgres-pglite/pglite/pg_uuidv7/source.c','upstream/src/mapped.ts','upstream/src/duplicate.ts'])await put(`${base}/${file}`)
    await put('dependencies/preferred-source/npm-upstream/library.tar.gz')
    await put('dependencies/preferred-source/npm-upstream/inspection/src/duplicate.ts')
    await put('docs/release/inventory/EXPANDED_INVENTORY.json',JSON.stringify({pglite:{preferredSourceChecks:[],components:[],buildRecipes:[],embeddedSourceMaps:[{preferredSource:`${base}/upstream/src/mapped.ts`}]}}))
    const selected=preferredSourceSelection(root)
    assert(selected.includes(`${base}/source.tar.gz`));assert(selected.includes(`${base}/embedded/library.tar.gz`))
    assert(selected.includes(`${base}/upstream/src/mapped.ts`));assert(selected.includes(`${base}/postgres-pglite/pglite/pg_uuidv7/source.c`))
    assert(!selected.includes(`${base}/upstream/src/duplicate.ts`))
    assert(selected.includes('dependencies/preferred-source/npm-upstream/library.tar.gz'))
    assert(!selected.includes('dependencies/preferred-source/npm-upstream/inspection/src/duplicate.ts'))
  }finally{
    if(!resolve(root).startsWith(join(resolve(tmpdir()),'endtoend-closure-')))throw new Error('Unexpected closure fixture path')
    await rm(root,{recursive:true,force:true})
  }
})
