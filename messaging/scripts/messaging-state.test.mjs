// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {openMessagingState,inspectMessagingState} from './messaging-state.mjs'
import {backupMessagingRelay} from './messaging-storage.mjs'

async function fixture(t){
  const directory=await mkdtemp(path.join(tmpdir(),'endtoend-messaging-state-'))
  t.after(async()=>{assert(path.resolve(directory).startsWith(path.join(path.resolve(tmpdir()),'endtoend-messaging-state-')));await rm(directory,{recursive:true,force:true})})
  return directory
}
test('managed state keeps deployment identity and allows only one relay writer',async t=>{
  const directory=await fixture(t),dataDir=path.join(directory,'state')
  const first=await openMessagingState(dataDir),id=first.deploymentId
  await assert.rejects(openMessagingState(dataDir),/already open/)
  await first.close();await first.close()
  const second=await openMessagingState(dataDir);assert.equal(second.deploymentId,id);await second.close()
})
test('unmanaged state and future state format are refused without replacing existing files',async t=>{
  const directory=await fixture(t),unmanaged=path.join(directory,'unmanaged'),managed=path.join(directory,'managed')
  await mkdir(unmanaged);await writeFile(path.join(unmanaged,'current-data'),'keep')
  await assert.rejects(openMessagingState(unmanaged),/unmanaged/);assert.equal(await readFile(path.join(unmanaged,'current-data'),'utf8'),'keep')
  const first=await openMessagingState(managed);await first.close()
  const marker=path.join(managed,'messaging-state.json'),original=JSON.parse(await readFile(marker,'utf8'));original.formatVersion=999;await writeFile(marker,JSON.stringify(original))
  await assert.rejects(openMessagingState(managed),/Unsupported/);assert.equal(JSON.parse(await readFile(marker,'utf8')).formatVersion,999)
})
test('state refuses source directories, symlinked parents and symlinked marker files',async t=>{
  const directory=await fixture(t),source=path.join(directory,'source'),target=path.join(directory,'outside')
  await mkdir(source);await mkdir(target)
  await assert.rejects(openMessagingState(path.join(source,'state'),{sourceRoot:source}),/outside/)
  await symlink(target,path.join(directory,'linked'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(openMessagingState(path.join(directory,'linked/state')),/symlinks|junctions/)
  const managed=path.join(directory,'state'),opened=await openMessagingState(managed);await opened.close()
  const marker=path.join(managed,'messaging-state.json');await rm(marker);await symlink(target,marker,process.platform==='win32'?'junction':'dir')
  await assert.rejects(inspectMessagingState(managed),/symlinks|junctions/)
})
test('offline relay backup refuses live writers, path overlap and overwrites and preserves bytes',async t=>{
  const directory=await fixture(t),dataDir=path.join(directory,'state'),sourceRoot=path.join(directory,'source'),destination=path.join(directory,'snapshot')
  await mkdir(sourceRoot)
  const current=await openMessagingState(dataDir,{sourceRoot});await mkdir(current.relayDataDir);await writeFile(path.join(current.relayDataDir,'synthetic-db'),'committed ciphertext and ACK state')
  await assert.rejects(backupMessagingRelay({dataDir,destination,sourceRoot}),/already open/)
  await current.close()
  await assert.rejects(backupMessagingRelay({dataDir,destination:path.join(dataDir,'snapshot'),sourceRoot}),/overlap/)
  const result=await backupMessagingRelay({dataDir,destination,sourceRoot})
  assert.equal(result.automaticRestoreSupported,false);assert.equal(result.files.length,1)
  assert.equal(await readFile(path.join(destination,'relay/synthetic-db'),'utf8'),'committed ciphertext and ACK state')
  await assert.rejects(backupMessagingRelay({dataDir,destination,sourceRoot}),/must be new/)
})

test('concurrent snapshots claim a new destination exclusively without replacing the winner',async t=>{
  const directory=await fixture(t),destination=path.join(directory,'snapshot'),dataDirs=['a','b'].map(name=>path.join(directory,name))
  for(let index=0;index<dataDirs.length;index++){
    const state=await openMessagingState(dataDirs[index]);await mkdir(state.relayDataDir)
    await writeFile(path.join(state.relayDataDir,'synthetic-db'),String(index));await state.close()
  }
  const results=await Promise.allSettled(dataDirs.map(dataDir=>backupMessagingRelay({dataDir,destination})))
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
  const winner=results.findIndex(result=>result.status==='fulfilled')
  const manifest=JSON.parse(await readFile(path.join(destination,'SNAPSHOT.json'),'utf8'))
  assert.equal(await readFile(path.join(destination,'relay/synthetic-db'),'utf8'),String(winner))
  assert.equal(manifest.deploymentId,(await inspectMessagingState(dataDirs[winner])).marker.deploymentId)
})
