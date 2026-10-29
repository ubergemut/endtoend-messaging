// SPDX-License-Identifier: AGPL-3.0-only
import {randomUUID} from 'node:crypto'
import {mkdir,open,readFile,rename,rm,readdir,lstat} from 'node:fs/promises'
import path from 'node:path'

const markerName='messaging-state.json'
const lockName='.messaging-relay.lock'
const within=(base,target)=>{const rel=path.relative(base,target);return !rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))}

/** Resolve the requested directory without following an intermediate symlink/junction. */
export async function checkedStatePath(value,{sourceRoot}={}){
  if(typeof value!=='string'||!value.trim())throw new Error('An explicit messaging data directory is required')
  const absolute=path.resolve(value),parsed=path.parse(absolute)
  if(absolute===parsed.root)throw new Error('A filesystem root cannot be the messaging data directory')
  let current=parsed.root
  for(const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
    current=path.join(current,segment)
    const stat=await lstat(current).catch(error=>{if(error.code==='ENOENT')return null;throw error})
    if(stat?.isSymbolicLink())throw new Error('Messaging storage paths must not contain symlinks or directory junctions')
  }
  if(sourceRoot){const source=path.resolve(sourceRoot);if(within(source,absolute))throw new Error('Messaging data must live outside the application/source directory')}
  return absolute
}

async function acquireLock(directory){
  const file=path.join(directory,lockName),identity={pid:process.pid,nonce:randomUUID()},text=JSON.stringify(identity)
  let handle
  for(let attempt=0;attempt<2;attempt++){
    try{handle=await open(file,'wx',0o600);break}
    catch(error){
      if(error.code!=='EEXIST')throw error
      let guard
      try{guard=await open(file+'.reclaim','wx',0o600)}catch{throw new Error('Messaging storage recovery is already in progress')}
      try{
        let owner
        if((await lstat(file)).isSymbolicLink())throw new Error('Symlinked messaging storage lock refused')
        try{owner=JSON.parse(await readFile(file,'utf8'))}catch{throw new Error('Unverifiable messaging storage lock; refuse to open the database')}
        if(!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.nonce!=='string')throw new Error('Invalid messaging storage lock')
        let alive=true
        try{process.kill(owner.pid,0)}catch(failure){if(failure.code==='ESRCH')alive=false}
        if(alive)throw new Error('Messaging relay storage is already open in another process')
        await rm(file)
      }finally{await guard.close();await rm(file+'.reclaim',{force:true})}
    }
  }
  if(!handle)throw new Error('Messaging relay storage is already open')
  try{await handle.writeFile(text);await handle.sync()}catch(error){await handle.close();await rm(file,{force:true});throw error}
  let closed=false
  return async()=>{
    if(closed)return;closed=true;await handle.close()
    const current=await readFile(file,'utf8').catch(()=>null)
    if(current===text)await rm(file,{force:true})
  }
}

/** One persistent relay writer; creation does not infer or import old application data. */
export async function openMessagingState(value,{sourceRoot}={}){
  const directory=await checkedStatePath(value,{sourceRoot})
  const existing=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return[];throw error})
  if(existing.length&&!existing.includes(markerName))throw new Error('Refusing an unmanaged nonempty data directory; no existing database is imported implicitly')
  await mkdir(directory,{recursive:true,mode:0o700})
  const release=await acquireLock(directory)
  try{
    const markerFile=path.join(directory,markerName)
    await checkedStatePath(markerFile,{sourceRoot})
    let marker=await readFile(markerFile,'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error})
    if(marker&&(marker.kind!=='endtoend-messaging-state'||marker.formatVersion!==1||typeof marker.deploymentId!=='string'||marker.recoveryRequired))throw new Error('Unsupported or recovery-required messaging state; storage is unchanged')
    if(!marker){
      marker={kind:'endtoend-messaging-state',formatVersion:1,deploymentId:randomUUID(),createdAt:new Date().toISOString()}
      const temp=markerFile+'.'+randomUUID()+'.tmp',file=await open(temp,'wx',0o600)
      try{await file.writeFile(JSON.stringify(marker,null,2)+'\n');await file.sync()}finally{await file.close()}
      await rename(temp,markerFile)
    }
    const relayDataDir=path.join(directory,'relay')
    await checkedStatePath(relayDataDir,{sourceRoot})
    return{directory,relayDataDir,deploymentId:marker.deploymentId,close:release}
  }catch(error){await release();throw error}
}

export async function inspectMessagingState(value,{sourceRoot}={}){
  const directory=await checkedStatePath(value,{sourceRoot})
  await checkedStatePath(path.join(directory,markerName),{sourceRoot})
  const marker=JSON.parse(await readFile(path.join(directory,markerName),'utf8'))
  if(marker.kind!=='endtoend-messaging-state'||marker.formatVersion!==1||marker.recoveryRequired)throw new Error('Unsupported or recovery-required messaging state')
  return{directory,marker,relayDataDir:path.join(directory,'relay'),lockFile:path.join(directory,lockName)}
}

export {within as pathWithin}
