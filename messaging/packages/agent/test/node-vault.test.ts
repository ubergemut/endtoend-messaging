import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {acquireVaultLock,readDurableFile,writeDurableFile} from '../src/nodeVault.ts'

test('exclusive writers and interruption recovery retain committed file bytes',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'agent-vault-')),file=path.join(dir,'vault.json')
  const release=await acquireVaultLock(file)
  try{
    await assert.rejects(acquireVaultLock(file),/already open/)
    await writeDurableFile(file,'{"generation":1}')
    await assert.rejects(writeDurableFile(file,'{"generation":2}','after-temp'))
    assert.equal(await readDurableFile(file),'{"generation":1}')
    await assert.rejects(writeDurableFile(file,'{"generation":3}','after-backup'))
    assert.equal(await readDurableFile(file),'{"generation":1}')
    assert.equal(await readFile(file,'utf8'),'{"generation":1}')
  }finally{await release();await rm(dir,{recursive:true,force:true})}
})

test('malformed or actively reclaimed locks fail closed',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'agent-lock-')),file=path.join(dir,'vault.json')
  try{
    await writeFile(file+'.lock','malformed')
    await assert.rejects(acquireVaultLock(file),/unreadable/)
    assert.equal(await readFile(file+'.lock','utf8'),'malformed')
    await writeFile(file+'.lock.reclaim','another recovery')
    await assert.rejects(acquireVaultLock(file),/recovery is already/)
  }finally{await rm(dir,{recursive:true,force:true})}
})
