/** AGPL-3.0-only. Independent synthetic relay fixture; not a production account/storage service. */
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'

type Account = { id: string; handle: string; displayName: string; passwordHash: string; bundle?: any }
export async function startReferenceRelay() {
  const accounts = new Map<string, Account>(), tokens = new Map<string,string>()
  const friends = new Set<string>(), blocked = new Set<string>(), requests = new Map<string,any>()
  const attempts = new Map<string,any>(), envelopes = new Map<string,any>(), groups = new Map<string,any>(), media = new Map<string,any>()
  const pair = (a: string,b: string) => [a,b].sort().join(':')
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const publicAccount = (a: Account) => ({ id:a.id,handle:a.handle,displayName:a.displayName })
  const assert = (ok: unknown, message='Forbidden', status=403) => { if (!ok) throw Object.assign(new Error(message),{status}) }
  const server = createServer(async(req,res) => {
    const send = (status:number,body:unknown) => { res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body)) }
    try {
      const url = new URL(req.url!, 'http://127.0.0.1'), pathname = url.pathname
      const chunks:Buffer[]=[]; let size=0
      for await (const chunk of req) { size+=chunk.length; assert(size<=38_000_000,'Too large',413);chunks.push(chunk) }
      const input:any = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : Object.fromEntries(url.searchParams)
      const method=req.method, token=req.headers.authorization?.slice(7), accountId=token ? tokens.get(token) : undefined
      const account=accountId ? accounts.get(accountId) : undefined
      if (pathname==='/api/health') return send(200,{ok:true,fixture:true})
      if (pathname==='/api/auth/handle') return send(200,{exists:[...accounts.values()].some(a=>a.handle===input.handle)})
      if (pathname==='/api/auth/register' || pathname==='/api/auth/login') {
        let a=[...accounts.values()].find(a=>a.handle===input.handle)
        if(pathname.endsWith('register')) { assert(!a,'Handle taken',409);a={id:randomUUID(),handle:input.handle,displayName:input.displayName||input.handle,passwordHash:hash(input.password)};accounts.set(a.id,a) }
        assert(a && a.passwordHash===hash(input.password),'Unknown account',401)
        const token=randomUUID();tokens.set(token,a!.id);return send(200,{token,account:publicAccount(a!)})
      }
      assert(account,'Sign in required',401)
      const me=account!
      if(pathname==='/api/bootstrap') return send(200,{account:publicAccount(me),enrolled:!!me.bundle,identityKey:me.bundle?.identityKey??null,audience:'endtoend-relay',protocolVersion:1})
      if(pathname==='/api/auth/logout') { tokens.delete(token!); return send(200,{ok:true}) }
      if(pathname==='/api/keys/bundle' && method==='PUT') { if(me.bundle?.identityKey!==input.identityKey) me.bundle=input;return send(200,{ok:true}) }
      if(pathname==='/api/keys/access') { assert(me.bundle);me.bundle.accessKey=input.accessKey;return send(200,{ok:true}) }
      if(pathname.startsWith('/api/keys/')) {
        const target=accounts.get(pathname.split('/').pop()!);assert(target?.bundle && friends.has(pair(me.id,target.id)) && !blocked.has(pair(me.id,target.id)))
        const bundle=structuredClone(target!.bundle), one=bundle.oneTimePreKeys?.shift()??null
        if(one) target!.bundle.oneTimePreKeys.shift()
        return send(200,{bundle:{...bundle,oneTimePreKey:one}})
      }
      if(pathname==='/api/accounts/search') { const a=[...accounts.values()].find(a=>a.handle===input.handle); return send(200,{account:a?{...publicAccount(a),identityKey:a.bundle?.identityKey??null}:null}) }
      if(pathname==='/api/friends') return send(200,{friends:[...accounts.values()].filter(a=>a.id!==me.id&&friends.has(pair(me.id,a.id))&&!blocked.has(pair(me.id,a.id))).map(a=>({...publicAccount(a),identityKey:a.bundle?.identityKey??null}))})
      if(pathname==='/api/friends/requests') {
        if(method==='POST') { const target=[...accounts.values()].find(a=>a.handle===input.handle);assert(target&&target.id!==me.id&&!blocked.has(pair(me.id,target.id)));const id=randomUUID();requests.set(id,{id,fromAccountId:me.id,toAccountId:target!.id,fromHandle:me.handle,toHandle:target!.handle,status:'pending',noteCiphertext:input.noteCiphertext??null});return send(200,{ok:true}) }
        return send(200,{requests:[...requests.values()].filter(r=>r.fromAccountId===me.id||r.toAccountId===me.id).map(r=>({...r,direction:r.fromAccountId===me.id?'outgoing':'incoming'}))})
      }
      if(pathname.startsWith('/api/friends/requests/')) { const [, , , , id,action]=pathname.split('/');const r=requests.get(id);assert(r && (r.fromAccountId===me.id||r.toAccountId===me.id));if(action==='accept') { assert(r.toAccountId===me.id);friends.add(pair(r.fromAccountId,r.toAccountId));r.status='accepted' } else r.status=action==='cancel'?'cancelled':'declined';return send(200,{ok:true}) }
      if(pathname==='/api/friends/block') { const target=[...accounts.values()].find(a=>a.handle===input.handle);assert(target);blocked.add(pair(me.id,target!.id));friends.delete(pair(me.id,target!.id));return send(200,{ok:true}) }
      if(pathname.startsWith('/api/friends/')&&pathname.endsWith('/remove')) {friends.delete(pair(me.id,pathname.split('/')[3]));return send(200,{ok:true})}
      if(pathname==='/api/groups') {
        if(method==='POST') { const members=[...new Set([me.id,...input.memberIds])] as string[];assert(members.every(id=>id===me.id||friends.has(pair(me.id,id))));const group={id:randomUUID(),memberIds:members,metadataCiphertext:input.metadataCiphertext,epoch:1};groups.set(group.id,group);return send(200,group) }
        return send(200,{groups:[...groups.values()].filter(g=>g.memberIds.includes(me.id))})
      }
      if(pathname.startsWith('/api/groups/')) { const parts=pathname.split('/'),g=groups.get(parts[3]);assert(g?.memberIds.includes(me.id));if(method==='DELETE') {const previous=g.memberIds.length;g.memberIds=g.memberIds.filter((id:string)=>id!==parts[5]);if(previous!==g.memberIds.length)g.epoch+=1}else {assert(friends.has(pair(me.id,input.accountId)));const previous=g.memberIds.length;g.memberIds=[...new Set([...g.memberIds,input.accountId])];if(previous!==g.memberIds.length)g.epoch+=1}return send(200,{ok:true,memberIds:g.memberIds,epoch:g.epoch}) }
      if(pathname==='/api/envelopes') {
        if(method==='POST') {
          const target=accounts.get(input.recipientAccountId);assert(target?.bundle && target.bundle.accessKey===input.accessKey)
          assert(friends.has(pair(me.id,target!.id))&&!blocked.has(pair(me.id,target!.id)))
          if(input.groupId) {assert(groups.get(input.groupId)?.memberIds.includes(me.id)&&groups.get(input.groupId)?.memberIds.includes(target!.id));if(input.groupEpoch!==undefined)assert(input.groupEpoch===groups.get(input.groupId)?.epoch,'Group epoch changed',409)}
          const queue=[...attempts.values()].find(e=>e.recipientAccountId===target!.id&&e.queueTag===input.queueTag)
          if(queue) {assert(queue.ciphertext===input.ciphertext,'Queue conflict',409);return send(200,{id:queue.id})}
          const id=randomUUID();envelopes.set(id,{...input,id,groupEpoch:input.groupId?groups.get(input.groupId)?.epoch:null,groupId:input.groupId??null,expiresAt:input.expiresAt??null,createdAt:new Date().toISOString()});attempts.set(id,structuredClone(envelopes.get(id)));return send(200,{id})
        }
        return send(200,{envelopes:[...envelopes.values()].filter(e=>e.recipientAccountId===me.id&&(!e.expiresAt||Date.parse(e.expiresAt)>Date.now()))})
      }
      if(pathname==='/api/envelopes/ack') {for(const id of input.ids) if(envelopes.get(id)?.recipientAccountId===me.id) envelopes.delete(id);return send(200,{ok:true})}
      if(pathname==='/api/media') {const id=input.id??randomUUID();assert(input.recipientAccountId?friends.has(pair(me.id,input.recipientAccountId)):groups.get(input.groupId)?.memberIds.includes(me.id));const previous=media.get(id);if(previous) assert(previous.owner===me.id&&previous.ciphertext===input.ciphertext,'Media conflict',409);else media.set(id,{...input,owner:me.id});return send(200,{id})}
      if(pathname.startsWith('/api/media/')) {const file=media.get(pathname.split('/').pop()!);assert(file&&(file.recipientAccountId===me.id||groups.get(file.groupId)?.memberIds.includes(me.id)));assert(!file.expiresAt||Date.parse(file.expiresAt)>Date.now(),'Expired',404);return send(200,{ciphertext:file.ciphertext})}
      send(404,{error:'Unknown fixture route'})
    } catch(error) {send((error as any).status??500,{error:(error as Error).message})}
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {baseUrl:`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`,async close(){await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
