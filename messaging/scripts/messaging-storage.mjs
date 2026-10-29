// SPDX-License-Identifier: AGPL-3.0-only
import {cp,readFile,writeFile,mkdir,lstat,readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {checkedStatePath,inspectMessagingState,openMessagingState,pathWithin} from './messaging-state.mjs'

async function inventory(directory,prefix=''){
  const output=[]
  for(const name of (await readdir(path.join(directory,prefix))).sort()){
    const relative=prefix?prefix+'/'+name:name,absolute=path.join(directory,relative),stat=await lstat(absolute)
    if(stat.isSymbolicLink())throw new Error('Relay snapshots refuse symbolic links and junctions')
    if(stat.isDirectory())output.push(...await inventory(directory,relative))
    else if(stat.isFile())output.push({path:relative,bytes:stat.size,sha256:createHash('sha256').update(await readFile(absolute)).digest('hex')})
    else throw new Error('Relay snapshots require regular files')
  }
  return output
}

/** A private offline relay snapshot, never a cryptographic-device backup or automatic rollback. */
export async function backupMessagingRelay({dataDir,destination,sourceRoot}){
  const known=await inspectMessagingState(dataDir,{sourceRoot})
  const target=await checkedStatePath(destination,{sourceRoot})
  if(pathWithin(known.directory,target)||pathWithin(target,known.directory))throw new Error('Snapshot and live storage paths must not overlap')
  if(await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error}))throw new Error('Snapshot destination must be new; existing data is never overwritten')
  const state=await openMessagingState(known.directory,{sourceRoot})
  try{
    const files=await inventory(state.relayDataDir)
    await mkdir(path.dirname(target),{recursive:true,mode:0o700})
    await mkdir(target,{mode:0o700})
    await cp(state.relayDataDir,path.join(target,'relay'),{recursive:true,dereference:false,errorOnExist:true,force:false})
    const copied=await inventory(path.join(target,'relay'))
    if(JSON.stringify(files)!==JSON.stringify(copied))throw new Error('Snapshot bytes differ from offline relay state')
    const result={kind:'endtoend-offline-relay-snapshot',formatVersion:1,deploymentId:state.deploymentId,createdAt:new Date().toISOString(),scope:'relay-only; device vaults, ratchets, pending outboxes and browser storage are not included',automaticRestoreSupported:false,files}
    await writeFile(path.join(target,'SNAPSHOT.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
    return result
  }finally{await state.close()}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const [command,dataDir,destination,...extra]=process.argv.slice(2)
  if(command!=='backup'||!dataDir||!destination||extra.length)throw new Error('Use: messaging-storage.mjs backup <stopped-managed-data-directory> <new-private-snapshot-directory>. Automatic restore is intentionally unsupported: a relay-only snapshot cannot establish current device/ratchet state.')
  const result=await backupMessagingRelay({dataDir,destination,sourceRoot:fileURLToPath(new URL('..',import.meta.url))})
  console.log(JSON.stringify({kind:result.kind,deploymentId:result.deploymentId,files:result.files.length,automaticRestoreSupported:false}))
}
