// Modified October 31, 2026: validated operator branding in the trusted configuration. AGPL-3.0-only.
import { createServer,request as httpRequest } from 'node:http'
import { readFile,stat,realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { startServer } from '../apps/api/src/server.ts'
import {loadSourceDisclosure,verifyDisclosedRuntime} from './source-disclosure.mjs'
import {brandName} from '../packages/agent/src/appearance.ts'

const root=fileURLToPath(new URL('..',import.meta.url))
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.txt':'text/plain','.svg':'image/svg+xml','.png':'image/png'}
function publicOrigin(value){if(!value)return null;const url=new URL(value)
  if(url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Configured public URLs must be bare origins')
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('Public browser origins require HTTPS')
  return url.origin
}
export async function verifyReleaseBrowserPaths(productDist,agentDist){
  const installed=await realpath(root)
  for(const [actual,relative] of [[productDist,'apps/messaging-reference/dist'],[agentDist,'apps/agent-browser/dist']]){
    const expected=path.resolve(root,relative)
    if(path.resolve(actual)!==expected||await realpath(actual)!==path.resolve(installed,relative))throw new Error('Release browser distributions must be the verified installed messaging reference and agent')
  }
}
/** Serve built, independent applications. Persist the relay only at an explicitly selected directory. */
export async function startReleaseApplication(options){
  const configuredBrand=brandName(options.brandName)
  if(!options.relayDataDir)throw new Error('An explicit relayDataDir is required; production storage is never inferred')
  const releaseMode=options.releaseMode??process.env.ENDTOEND_RELEASE_MODE==='1'
  const disclosureFilename=options.sourceDisclosure??process.env.ENDTOEND_SOURCE_DISCLOSURE
  const disclosure=options.verifiedDisclosure??await loadSourceDisclosure(disclosureFilename,{required:releaseMode})
  const sourceInfo=disclosure?.component('messaging-core')
  const productDist=path.resolve(options.productDist??path.join(root,releaseMode?'apps/messaging-reference/dist':'apps/web/dist'))
  const agentDist=path.resolve(options.agentDist)
  let runtimeFiles=null
  if(releaseMode){
    await verifyReleaseBrowserPaths(productDist,agentDist)
    await verifyDisclosedRuntime(disclosure,'messaging-core',root)
    if(!disclosureFilename)throw new Error('Release static verification requires the source disclosure filename')
    const entry=sourceInfo.artifacts.find(row=>row.filename==='RUNTIME_MANIFEST.json')
    const bytes=await readFile(path.join(path.dirname(path.resolve(disclosureFilename)),entry.filename))
    if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Release runtime manifest changed')
    runtimeFiles=new Map(JSON.parse(bytes.toString('utf8')).files.map(row=>[row.path,row]))
  }
  await Promise.all([stat(path.join(productDist,'index.html')),stat(path.join(agentDist,'index.html'))])
  let source=null,release=null
  if(options.releaseIndex){
    const indexPath=path.resolve(options.releaseIndex);release=JSON.parse(await readFile(indexPath,'utf8'))
    if(path.basename(release.source.filename)!==release.source.filename)throw new Error('Unsafe source artifact name')
    const filename=path.join(path.dirname(indexPath),release.source.filename),bytes=await readFile(filename)
    if(createHash('sha256').update(bytes).digest('hex')!==release.source.sha256)throw new Error('Source archive checksum mismatch')
    source={filename:release.source.filename,bytes}
  }
  const configuredProduct=publicOrigin(options.productOrigin),configuredAgent=publicOrigin(options.agentOrigin)
  if(configuredProduct&&configuredProduct===configuredAgent)throw new Error('Agent and product require separate origins')
  if(options.callerOrigins!==undefined&&(!Array.isArray(options.callerOrigins)||options.callerOrigins.some(value=>typeof value!=='string'||!value.trim())))throw new Error('Caller origins must be an array of bare origins')
  const configuredCallers=(options.callerOrigins??[]).map(publicOrigin)
  if(configuredAgent&&configuredCallers.includes(configuredAgent))throw new Error('The trusted agent cannot be a caller origin')
  const relay=await startServer({dataDir:path.resolve(options.relayDataDir),hostIdentity:options.hostIdentity,verifiedDisclosure:disclosure,releaseMode})
  let productOrigin='',agentOrigin=''
  function proxy(req,res){
    const target=new URL(new URL(req.url,'http://127.0.0.1').pathname+new URL(req.url,'http://127.0.0.1').search,relay.baseUrl)
    const upstream=httpRequest(target,{method:req.method,headers:{...req.headers,host:target.host}},response=>{
      res.writeHead(response.statusCode??502,response.headers);response.pipe(res)
    })
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Relay unavailable')})
    req.on('aborted',()=>upstream.destroy());req.pipe(upstream)
  }
  function application(directory,agent){
    const sockets=new Set()
    const server=createServer(async(req,res)=>{
      try{
        const url=new URL(req.url??'/','http://127.0.0.1')
        res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer')
        res.setHeader('cache-control','no-store')
        res.setHeader('cross-origin-opener-policy',agent?'unsafe-none':'same-origin-allow-popups')
        if(disclosure?.serve(req,res))return
        if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/messaging/v1/'))return proxy(req,res)
        if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
        if(agent)res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if(url.pathname==='/agent-config.json'&&!agent){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({agentUrl:agentOrigin,relayUrl:agentOrigin}));return}
        if(url.pathname==='/release.json'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(sourceInfo??{version:release?.version??options.version??'0.2.1',sourceUrl:source?`/source/${source.filename}`:null,sourceStatus:source?'legacy-development':'development'}));return}
        if(url.pathname==='/config.json'&&agent){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({brandName:configuredBrand,allowedCallerOrigins:[...new Set([productOrigin,...configuredCallers])],relayOrigins:[agentOrigin],...(disclosure?disclosure.component('messaging-core',agentOrigin):{version:release?.version??options.version??'0.2.1',sourceUrl:source?`${agentOrigin}/source/${source.filename}`:null,licenseUrl:'/license',sourceStatus:'development'})}));return}
        if(url.pathname==='/license'&&agent){if(disclosure){res.writeHead(302,{location:sourceInfo.licenseUrl}).end();return}res.writeHead(200,{'content-type':'text/plain'}).end(await readFile(path.join(directory,'LICENSE.txt')));return}
        if(source&&url.pathname===`/source/${source.filename}`){res.writeHead(200,{'content-type':'application/gzip','content-disposition':`attachment; filename="${source.filename}"`}).end(req.method==='HEAD'?undefined:source.bytes);return}
        const decoded=decodeURIComponent(url.pathname),filename=path.resolve(directory,'.'+decoded)
        const relative=path.relative(directory,filename)
        if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403).end();return}
        let selected=filename
        const existing=await stat(selected).catch(()=>null)
        if(!existing?.isFile()){
          if(path.extname(decoded)){res.writeHead(404).end();return}
          selected=path.join(directory,'index.html')
        }
        const runtimeEntry=runtimeFiles?.get(path.relative(root,selected).replaceAll('\\','/'))
        if(runtimeFiles&&!runtimeEntry){res.writeHead(404).end();return}
        const bytes=await readFile(selected)
        if(runtimeEntry&&(bytes.length!==runtimeEntry.bytes||createHash('sha256').update(bytes).digest('hex')!==runtimeEntry.sha256)){res.writeHead(503).end('Release file verification failed');return}
        res.writeHead(200,{'content-type':mime[path.extname(selected)]??'application/octet-stream'})
        res.end(req.method==='HEAD'?undefined:bytes)
      }catch{if(!res.headersSent)res.writeHead(500);res.end('Application error')}
    })
    server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
    server.on('close-owned-connections',()=>{for(const socket of sockets)socket.destroy()})
    server.on('upgrade',(req,socket,head)=>{
      let target
      try{
        const incoming=new URL(req.url??'/','http://127.0.0.1')
        if(incoming.pathname!=='/ws'){socket.destroy();return}
        target=new URL(incoming.pathname+incoming.search,relay.baseUrl)
      }catch{socket.destroy();return}
      const upstream=httpRequest(target,{headers:{...req.headers,host:target.host}})
      upstream.on('upgrade',(response,peer,peerHead)=>{
        socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`+Object.entries(response.headers).map(([key,value])=>`${key}: ${Array.isArray(value)?value.join(', '):value}\r\n`).join('')+'\r\n')
        if(head.length)peer.write(head);if(peerHead.length)socket.write(peerHead)
        socket.pipe(peer);peer.pipe(socket);socket.on('error',()=>peer.destroy());peer.on('error',()=>socket.destroy())
      })
      upstream.on('response',()=>socket.destroy());upstream.on('error',()=>socket.destroy());upstream.end()
    })
    return server
  }
  const product=application(productDist,false),agent=application(agentDist,true)
  const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve(`http://127.0.0.1:${server.address().port}`)})})
  try{
    const productUrl=await listen(product),agentUrl=await listen(agent)
    productOrigin=configuredProduct??productUrl;agentOrigin=configuredAgent??agentUrl
    if(productOrigin===agentOrigin)throw new Error('Agent and product require separate origins')
    let closed=false
    return{productUrl,agentUrl,relayUrl:relay.baseUrl,productOrigin,agentOrigin,
      async close(){if(closed)return;closed=true
        await Promise.all([product,agent].map(server=>new Promise(resolve=>{server.close(resolve);server.emit('close-owned-connections');server.closeAllConnections()})))
        await relay.close()
      }}
  }catch(error){product.close();agent.close();await relay.close();throw error}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const flags=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>value.startsWith('--')?[...pairs,[value.slice(2),all[index+1]]]:pairs,[]))
  if(flags['release-mode']!==undefined&&!['true','false'].includes(flags['release-mode']))throw new Error('--release-mode must be true or false')
  if(!flags['agent-dist']||!flags['data-dir'])throw new Error('Use --agent-dist <released-agent-dist> --data-dir <new-explicit-relay-directory> [--source-disclosure <SOURCE_DISCLOSURE.json> --release-mode true] [--product-origin https://...] [--agent-origin https://...]')
  const started=await startReleaseApplication({agentDist:flags['agent-dist'],productDist:flags['product-dist'],relayDataDir:flags['data-dir'],releaseIndex:flags['release-index'],sourceDisclosure:flags['source-disclosure'],releaseMode:flags['release-mode']===undefined?undefined:flags['release-mode']==='true',productOrigin:flags['product-origin'],agentOrigin:flags['agent-origin']})
  console.log(JSON.stringify({type:'endtoend-release-ready',productUrl:started.productUrl,agentUrl:started.agentUrl,relayUrl:started.relayUrl,productOrigin:started.productOrigin,agentOrigin:started.agentOrigin}))
  const stop=()=>void started.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop)
}
