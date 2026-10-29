import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { signal } from '@e2ee/crypto/node'
import { HeadlessError, authorizationBinding, validateBootstrap } from '@e2ee/session'
import { createDispatcher } from './dispatcher.ts'
import { openNodeSession } from './nodeVault.ts'
import {loadSourceDisclosure,verifyDisclosedRuntime} from '../../../scripts/source-disclosure.mjs'
import {fileURLToPath} from 'node:url'
import {licenseInfo} from './sourceInfo.ts'

export async function startLocalAgent(options:{relay:string;vaultPath:string;deviceKey?:string;sourceDisclosure?:string;releaseMode?:boolean}) {
  const releaseMode=options.releaseMode??process.env.ENDTOEND_RELEASE_MODE==='1'
  const disclosure=await loadSourceDisclosure(options.sourceDisclosure??process.env.ENDTOEND_SOURCE_DISCLOSURE,{required:releaseMode})
  if(releaseMode)await verifyDisclosedRuntime(disclosure,'messaging-core',fileURLToPath(new URL('../../../',import.meta.url)))
  const sourceInfo=licenseInfo(disclosure?.component('messaging-core',process.env.ENDTOEND_SOURCE_BASE_URL)??{version:'0.2.0',sourceUrl:process.env.ENDTOEND_SOURCE_URL??null,sourceStatus:'development'})
  const capability=randomBytes(32).toString('base64url')
  let current:Awaited<ReturnType<typeof openNodeSession>>|null=await openNodeSession({...options,signal})
  let closing=Promise.resolve()
  let opening:Promise<Awaited<ReturnType<typeof openNodeSession>>>|null=null
  let sessionGeneration=0
  let authorizationController=new AbortController()
  let stopped=false
  let stopPromise:Promise<void>|null=null
  async function ensureSession(captured:number) {
    await closing
    if(stopped||captured!==sessionGeneration)throw new HeadlessError('Agent is stopped or locked','locked')
    if(!current) {
      const candidate=openNodeSession({...options,signal});opening=candidate
      try {
        const opened=await candidate
        if(stopped||captured!==sessionGeneration){await opened.close();throw new HeadlessError('Agent is stopped or locked','locked')}
        current=opened
      }finally{if(opening===candidate)opening=null}
    }
    return current
  }
  const dispatcher=createDispatcher({signal,session:()=>current?.session ?? null,
    status:()=>current?.session.status()??{unlocked:false,accountId:null,handle:null,relay:options.relay,vaultPath:options.vaultPath,pendingTrustHandle:null},
    sourceInfo,
    async unlock(input){
      const captured=sessionGeneration
      const opened=await ensureSession(captured)
      return opened.session.unlock({handle:String(input.handle??''),password:String(input.password??''),replaceKeys:input.replaceKeys===true})
    },
    async attach(input){
      const captured=sessionGeneration
      const binding=authorizationBinding(input.authorization)
      if(typeof input.relay!=='string'||new URL(input.relay).href!==new URL(options.relay).href||typeof input.token!=='string'||!input.token||input.token.length>8192
        ||typeof input.expectedAccountId!=='string'||!input.expectedAccountId)throw new HeadlessError('Attachment does not match the configured relay/account','invalid')
      const response=await fetch(`${options.relay.replace(/\/$/,'')}${binding.bootstrapPath}`,{headers:{authorization:`Bearer ${input.token}`},cache:'no-store',redirect:'error',signal:authorizationController.signal})
      if(stopped||captured!==sessionGeneration)throw new HeadlessError('Account attachment was cancelled','locked')
      if(!response.ok)throw new HeadlessError('Messaging authorization was refused','relay')
      const verified=validateBootstrap(await response.json(),binding,input.expectedAccountId)
      if(stopped||captured!==sessionGeneration)throw new HeadlessError('Account attachment was cancelled','locked')
      const opened=await ensureSession(captured)
      return opened.session.attach(input.token,verified.account,{authorization:input.authorization===undefined?undefined:binding})
    },
    lock(){
      sessionGeneration+=1
      authorizationController.abort();authorizationController=new AbortController()
      if (current) { const old=current;current=null;old.session.lock();closing=old.close() }
    },
    async close(){await close()},
  })
  const server=createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store')
    try {
    if(stopped){res.writeHead(503).end();return}
    const bound=server.address()
    if(!bound||typeof bound==='string'||req.headers.host!==`127.0.0.1:${bound.port}`){res.writeHead(403).end();return}
    if(disclosure?.serve(req,res))return
    if((req.method==='GET'||req.method==='HEAD')&&['/release.json','/licenseInfo'].includes(new URL(req.url??'/','http://127.0.0.1').pathname)){
      res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'}).end(req.method==='HEAD'?undefined:JSON.stringify(sourceInfo));return
    }
    const supplied=req.headers.authorization?.replace(/^Bearer /,'')??''
    const provided=Buffer.from(supplied),expected=Buffer.from(capability)
    if(req.headers.origin || provided.length!==expected.length || !timingSafeEqual(provided,expected)){
      res.writeHead(403,{'content-type':'application/json'}).end(JSON.stringify({error:'Unauthorized local caller'}));return
    }
    if(req.method!=='POST'||req.url!=='/v1/command') {res.writeHead(404).end();return}
    if(req.headers['content-type']?.split(';')[0].trim()!=='application/json'){res.writeHead(415).end();return}
      let size=0;const chunks:Buffer[]=[]
      for await(const chunk of req){size+=chunk.length;if(size>512*1024*1024){res.writeHead(413).end();return}chunks.push(Buffer.from(chunk))}
      if(stopped){res.writeHead(503).end();return}
      const response=await dispatcher.dispatch(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if(!res.writableEnded)res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(response))
    }catch{if(!res.writableEnded)res.writeHead(400).end(JSON.stringify({error:'Invalid request'}))}
  })
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve()})})
  const address=server.address()
  if(!address||typeof address==='string')throw new Error('Agent did not bind a loopback socket')
  if(disclosure)Object.assign(sourceInfo,licenseInfo(disclosure.component('messaging-core',process.env.ENDTOEND_SOURCE_BASE_URL??`http://127.0.0.1:${address.port}`)))
  async function close(){
    if(stopPromise)return stopPromise
    stopped=true;dispatcher.revoke()
    const pending=opening
    stopPromise=(async()=>{
      await closing
      if(pending){const opened=await pending.catch(()=>null);await opened?.close()}
      // A command response must be written before closing the accepting socket.
      setImmediate(()=>{server.close();server.closeIdleConnections()})
    })()
    return stopPromise
  }
  return {url:`http://127.0.0.1:${address.port}`,capability,server,close}
}
