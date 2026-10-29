import {HeadlessError,Session,isSealedRecord,isSealedBlob,openSealedVault,sealVault,openBlob,sealBlob,type SignalPort,type Vault} from '@e2ee/session'
type RecordValue={accountId:string;revision:number;sealed:unknown}

export async function inspectVault(relay:string,accountId:string){
  const db=await openDatabase()
  try{return !!await read<RecordValue>(db,'vaults',JSON.stringify([relay,accountId]))}finally{db.close()}
}
export async function openBrowserVault(options:{relay:string;accountId:string;secret:string;signal:SignalPort}){
  if(!navigator.locks)throw new HeadlessError('This browser needs Web Locks to protect its messaging vault','vault')
  const id=JSON.stringify([options.relay,options.accountId])
  let release!:()=>void
  await new Promise<void>((resolve,reject)=>{
    void navigator.locks.request(`endtoend-agent:${id}`,{ifAvailable:true},async lock=>{
      if(!lock){reject(new HeadlessError('Messaging is open in another agent window','vault'));return}
      await new Promise<void>(done=>{release=done;resolve()})
    }).catch(reject)
  })
  const db=await openDatabase().catch(error=>{release();throw error})
  let closed=false;let dataKey:CryptoKey|null=null
  const transactions=new Set<IDBTransaction>()
  function active(){if(closed)throw new HeadlessError('Messaging is locked','locked')}
  async function key(){active();return dataKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt'])}
  const session=new Session({relay:options.relay,label:'agent browser',signal:options.signal,
    async loadVault(){
      active();const raw=await read<RecordValue>(db,'vaults',id);active()
      if(!raw)return null
      if(raw.accountId!==options.accountId||!isSealedRecord(raw.sealed))throw new HeadlessError('Vault is corrupt or belongs to another account','vault')
      try{const opened=await openSealedVault(options.secret,raw.sealed);active();dataKey=opened.key
        const vault=opened.vault as Vault
        if(vault.accountId!==options.accountId||vault.revision!==raw.revision)throw new Error('Vault metadata mismatch')
        return vault
      }catch(error){if(error instanceof HeadlessError)throw error;throw new HeadlessError('Device secret could not open this vault','device-key')}
    },
    async saveVault(vault,expectedRevision){
      active();const sealed=await sealVault(options.secret,vault,await key());active()
      const next={accountId:options.accountId,revision:vault.revision,sealed:sealed.record}
      await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction('vaults','readwrite');transactions.add(tx)
        const store=tx.objectStore('vaults');const request=store.get(id);let failure:unknown
        request.onsuccess=()=>{try{active();const current=request.result as RecordValue|undefined
          if((current?.revision??0)!==(expectedRevision??0))throw new HeadlessError('A newer writer changed this vault','vault')
          store.put(next,id)
        }catch(error){failure=error;tx.abort()}}
        tx.oncomplete=()=>{transactions.delete(tx);resolve()}
        tx.onabort=()=>{transactions.delete(tx);reject(failure??tx.error??new Error('Vault commit aborted'))}
        tx.onerror=()=>{failure??=tx.error}
      });active();dataKey=sealed.key
    },
    async loadBlob(mediaId){active();validId(mediaId);const raw=await read<unknown>(db,'blobs',JSON.stringify([id,mediaId]));active()
      if(!raw)return null
      if(!dataKey||!isSealedBlob(raw))throw new HeadlessError('Unlock before reading attachments','device-key')
      const bytes=await openBlob(dataKey,raw);active();return bytes
    },
    async saveBlob(mediaId,bytes){active();validId(mediaId);const sealed=await sealBlob(await key(),bytes);active();await write(db,'blobs',JSON.stringify([id,mediaId]),sealed,transactions);active()},
    async deleteBlob(mediaId){active();validId(mediaId);await write(db,'blobs',JSON.stringify([id,mediaId]),undefined,transactions)},
  })
  return {session,async identity(){active();const record=await read<RecordValue>(db,'vaults',id);active();if(!record||!isSealedRecord(record.sealed))return null
    try{const opened=await openSealedVault(options.secret,record.sealed);active();return options.signal.local_identity((opened.vault as Vault).store)}catch{throw new HeadlessError('Device secret could not open this vault','device-key')}
  },close(){if(closed)return;closed=true;dataKey=null;session.lock();for(const tx of transactions){try{tx.abort()}catch{}}db.close();release()}}
}
function validId(id:string){if(!/^[A-Za-z0-9_-]{1,160}$/.test(id))throw new HeadlessError('Invalid media ID','invalid')}
function openDatabase(){return new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('endtoend-agent-v1',1)
  request.onupgradeneeded=()=>{request.result.createObjectStore('vaults');request.result.createObjectStore('blobs')}
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)}
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other agent windows before upgrading'))
})}
function read<T>(db:IDBDatabase,store:string,key:string){return new Promise<T|null>((resolve,reject)=>{
  const tx=db.transaction(store);let value:T|null=null;const req=tx.objectStore(store).get(key)
  req.onsuccess=()=>{value=req.result??null};tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)
})}
function write(db:IDBDatabase,store:string,key:string,value:unknown,transactions:Set<IDBTransaction>){return new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(store,'readwrite');transactions.add(tx)
  if(value===undefined)tx.objectStore(store).delete(key);else tx.objectStore(store).put(value,key)
  tx.oncomplete=()=>{transactions.delete(tx);resolve()};tx.onabort=()=>{transactions.delete(tx);reject(tx.error)};tx.onerror=()=>reject(tx.error)
})}
