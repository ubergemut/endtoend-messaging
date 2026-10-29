import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { HeadlessError, Session, isSealedRecord, isSealedBlob, openSealedVault, sealVault, openBlob, sealBlob, type SignalPort, type Vault } from '@e2ee/session'

function errno(error: unknown) { return (error as NodeJS.ErrnoException).code }
async function syncDirectory(directory: string) {
  let handle
  try { handle = await open(directory,'r'); await handle.sync() }
  catch (error) { if (!['EPERM','EACCES','EINVAL','EISDIR'].includes(errno(error) ?? '')) throw error }
  finally { await handle?.close() }
}

export async function readDurableFile(file: string): Promise<string | null> {
  try { return await readFile(file,'utf8') }
  catch (error) { if (errno(error) !== 'ENOENT') throw new HeadlessError('Vault file could not be read','vault') }
  try {
    const recovered = await readFile(`${file}.bak`,'utf8')
    await rename(`${file}.bak`,file)
    await syncDirectory(path.dirname(file))
    return recovered
  } catch (error) {
    if (errno(error) === 'ENOENT') return null
    throw new HeadlessError('Vault recovery could not be read','vault')
  }
}

/** Caller holds the exclusive vault lock. Sync bytes before switching committed names. */
export async function writeDurableFile(file: string, contents: string, interrupt?: 'after-temp' | 'after-backup') {
  const directory = path.dirname(file)
  await mkdir(directory,{recursive:true,mode:0o700})
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  const handle = await open(temp,'wx',0o600)
  try { await handle.writeFile(contents,'utf8'); await handle.sync() } finally { await handle.close() }
  if (interrupt === 'after-temp') throw new Error('interrupted after temp')
  try { await rename(file,`${file}.bak`) }
  catch (error) { if (errno(error) !== 'ENOENT') throw new HeadlessError('Vault file could not be replaced','vault') }
  await syncDirectory(directory)
  if (interrupt === 'after-backup') throw new Error('interrupted after backup')
  await rename(temp,file)
  await syncDirectory(directory)
  await rm(`${file}.bak`,{force:true})
  await syncDirectory(directory)
}

export async function acquireVaultLock(file: string) {
  const lockFile = `${path.resolve(file)}.lock`
  await mkdir(path.dirname(lockFile),{recursive:true,mode:0o700})
  const identity = JSON.stringify({pid:process.pid,nonce:crypto.randomUUID()})
  let handle
  for (let attempt=0; attempt<2; attempt++) {
    try { handle = await open(lockFile,'wx',0o600); break }
    catch (error) {
      if (errno(error) !== 'EEXIST') throw error
      let reclaim
      try {reclaim=await open(`${lockFile}.reclaim`,'wx',0o600)}
      catch {throw new HeadlessError('Vault recovery is already in progress; retry after the other process stops','vault')}
      try{
        // Read only after acquiring the reclamation guard; never remove a replacement writer's lock using a stale observation.
        let owner:{pid:number}
        try{owner=JSON.parse(await readFile(lockFile,'utf8'))}catch{throw new HeadlessError('Vault lock is unreadable; another writer may be active','vault')}
        if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw new HeadlessError('Vault lock is invalid','vault')
        let alive=true
        try{process.kill(owner.pid,0)}catch(failure){if(errno(failure)==='ESRCH')alive=false}
        if(alive)throw new HeadlessError('Messaging vault is already open in another process','vault')
        await rm(lockFile)
        try{handle=await open(lockFile,'wx',0o600)}catch{throw new HeadlessError('Another process acquired the vault','vault')}
      }finally{await reclaim.close();await rm(`${lockFile}.reclaim`,{force:true})}
      if(handle)break
    }
  }
  if (!handle) throw new HeadlessError('Could not acquire the vault writer lock','vault')
  await handle.writeFile(identity); await handle.sync()
  let released = false
  return async () => {
    if (released) return
    released=true; await handle!.close()
    if (await readFile(lockFile,'utf8').catch(()=>null) === identity) await rm(lockFile,{force:true})
  }
}

export async function openNodeSession(options: {relay:string;vaultPath:string;deviceKey?:string;signal:SignalPort}) {
  const file = path.resolve(options.vaultPath)
  const blobs = `${file}.blobs`
  const release = await acquireVaultLock(file)
  let dataKey: CryptoKey | null = null
  let closed = false
  let closePromise: Promise<void> | null = null
  const pending=new Set<Promise<unknown>>()
  function track<T>(work:()=>Promise<T>):Promise<T>{
    const result=work();pending.add(result)
    void result.then(()=>pending.delete(result),()=>pending.delete(result))
    return result
  }
  function active() { if (closed) throw new HeadlessError('Messaging is locked','locked') }
  function secret() {
    active()
    const value = options.deviceKey ?? process.env.ENDTOEND_DEVICE_KEY
    if (!value) throw new HeadlessError('Set ENDTOEND_DEVICE_KEY to your 32-byte base64 device secret','device-key')
    return value
  }
  async function key() { active(); return dataKey ??= await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']) }
  async function loadVault() {
    active()
    const raw = await readDurableFile(file)
    if (!raw) return null
    let record: unknown
    try { record=JSON.parse(raw) } catch { throw new HeadlessError('Vault file is corrupt','vault') }
    if (!isSealedRecord(record)) {
      secret()
      if(record&&typeof record==='object'&&'accountId' in record&&'store' in record)return record as Vault
      throw new HeadlessError('Expected a sealed agent vault','vault')
    }
    try {
      const opened=await openSealedVault(secret(),record); active(); dataKey=opened.key
      return opened.vault as Vault
    } catch (error) { if (error instanceof HeadlessError) throw error; throw new HeadlessError('Device key could not open this vault','device-key') }
  }
  const session = new Session({ relay:options.relay,label:file,signal:options.signal,loadVault:()=>track(loadVault),
    async saveVault(vault,expectedRevision) {
      return track(async()=>{
      active()
      const disk=await loadVault()
      if ((disk?.revision ?? 0)!==(expectedRevision ?? 0)) throw new HeadlessError('A newer writer changed the vault','vault')
      const sealed=await sealVault(secret(),vault,await key()); active()
      await writeDurableFile(file,JSON.stringify(sealed.record)); active(); dataKey=sealed.key
      })
    },
    async loadBlob(mediaId) {
      return track(async()=>{
      active(); validMediaId(mediaId)
      const raw=await readDurableFile(path.join(blobs,mediaId))
      if (!raw) return null
      let record:unknown
      try { record=JSON.parse(raw) } catch {
        if(!dataKey)throw new HeadlessError('Unlock before reading attachments','device-key')
        const legacy=await readFile(path.join(blobs,mediaId));active()
        const sealed=await sealBlob(dataKey,new Uint8Array(legacy));active()
        await writeDurableFile(path.join(blobs,mediaId),JSON.stringify(sealed));active()
        return new Uint8Array(legacy)
      }
      if (!isSealedBlob(record)||!dataKey) throw new HeadlessError('Unlock before reading attachments','device-key')
      const result=await openBlob(dataKey,record); active(); return result
      })
    },
    async saveBlob(mediaId,bytes) {
      return track(async()=>{
      active(); validMediaId(mediaId)
      const record=await sealBlob(await key(),bytes); active()
      await writeDurableFile(path.join(blobs,mediaId),JSON.stringify(record)); active()
      })
    },
    async deleteBlob(mediaId) { return track(async()=>{active();validMediaId(mediaId);await rm(path.join(blobs,mediaId),{force:true})}) },
  })
  return {session,async close(){if(closePromise)return closePromise;closed=true;session.lock();closePromise=(async()=>{await Promise.allSettled([...pending]);dataKey=null;await release()})();return closePromise}}
}
function validMediaId(id:string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new HeadlessError('Invalid attachment ID','invalid')
}
