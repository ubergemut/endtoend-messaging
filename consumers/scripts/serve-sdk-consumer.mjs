// SPDX-License-Identifier: MIT
// Copyright (c) 2026 EndToEnd contributors. See packages/client/LICENSE.
import {createServer, request} from 'node:http'
import {request as secureRequest} from 'node:https'
import {readFile, realpath, stat} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {loadSourceDisclosure,verifyDisclosedRuntime} from './source-disclosure.mjs'

const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain'}
function origin(value){
  const url=new URL(value)
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('A bare HTTPS or loopback origin is required')
  return url.origin
}
function grantPath(value){if(typeof value!=='string'||!/^\/(?!\/)[A-Za-z0-9/_-]+$/.test(value)||value.split('/').some(part=>part==='.'||part==='..'))throw Error('A plain same-origin grant path is required');return value}
function boundedFile(root,filename){const relative=path.relative(root,filename);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative)}
/** Independent static SDK consumer host. It does not import or implement the messaging subsystem.
 * Configure once before navigating a browser. hostHandler belongs to this host's authentication
 * backend, and can answer its grantPath; it is never invoked by the messaging service/agent.
 */
export async function startSdkConsumer({directory,sdkRoot,configPath='/desk-config.json',hostHandler,sourceDisclosure,releaseMode=false,componentId,runtimeManifestFilename='CONSUMER_RUNTIME_MANIFEST.json'}={}){
  if(!['/desk-config.json','/agent-config.json'].includes(configPath))throw Error('Unsupported consumer config path')
  const root=await realpath(path.resolve(directory)),sdk=await realpath(path.resolve(sdkRoot))
  const disclosure=await loadSourceDisclosure(sourceDisclosure,{required:releaseMode})
  if(disclosure&&!disclosure.component(componentId))throw Error('Consumer release component is not disclosed')
  let releaseFiles
  if(releaseMode){
    await verifyDisclosedRuntime(disclosure,componentId,sdk,runtimeManifestFilename)
    if(!['endtoend-web','desk-client'].includes(componentId))throw Error('Unsupported consumer release component')
    const expected=await realpath(path.join(sdk,componentId==='endtoend-web'?'apps/web/dist':'apps/desk-client'))
    if(root!==expected)throw Error('Consumer served directory differs from verified component runtime')
    const entry=disclosure.descriptor.components.find(item=>item.id===componentId).artifacts.find(row=>row.filename===runtimeManifestFilename)
    // The helper verified this external manifest before reading it here. Bind again against its
    // disclosed hash so changing it between verification and construction cannot add served files.
    const bytes=await readFile(path.join(path.dirname(path.resolve(sourceDisclosure)),entry.filename))
    if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Consumer runtime manifest changed')
    releaseFiles=new Map(JSON.parse(bytes).files.map(row=>[path.resolve(sdk,row.path),row]))
  }
  await Promise.all([stat(path.join(root,'index.html')),stat(path.join(sdk,'packages/client/dist/index.js')),stat(path.join(sdk,'packages/protocol/dist/index.js'))])
  const assets=new Map([
    ['/sdk/client/index.js',path.join(sdk,'packages/client/dist/index.js')],
    ['/sdk/client/relay-service.js',path.join(sdk,'packages/client/dist/relay-service.js')],
    ['/sdk/protocol/index.js',path.join(sdk,'packages/protocol/dist/index.js')],
  ])
  let config=null,closed=false
  const sockets=new Set()
  const server=createServer(async(req,res)=>{
    try{
      res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('cross-origin-opener-policy','same-origin-allow-popups')
      const url=new URL(req.url??'/','http://127.0.0.1')
      if(disclosure&&disclosure.serve(req,res))return
      if(url.pathname==='/release.json'){
        if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
        const info=disclosure?.component(componentId)
        const release=info?{...info,messagingSourceUrl:config?config.agentUrl+'/source-disclosure.json':null}:{version:'development',sourceUrl:null,sourceStatus:'Development only: release source is not configured'}
        res.writeHead(200,{'content-type':'application/json'}).end(req.method==='HEAD'?undefined:JSON.stringify(release));return
      }
      if(!config){res.writeHead(503).end('Consumer is not configured');return}
      if(hostHandler&&url.pathname===config.grantPath){await hostHandler(req,res);return}
      if(config.nativeAuth&&url.pathname.startsWith('/api/')){
        const target=new URL(url.pathname+url.search,config.relayUrl)
        const {cookie: _hostCookie,...headers}=req.headers
        const upstream=(target.protocol==='https:'?secureRequest:request)(target,{method:req.method,headers:{...headers,host:target.host}},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res)})
        upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Relay unavailable')});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);return
      }
      if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
      if(url.pathname===configPath){res.writeHead(200,{'content-type':'application/json'}).end(req.method==='HEAD'?undefined:JSON.stringify(config));return}
      let selected=assets.get(url.pathname)
      if(!selected){
        const decoded=decodeURIComponent(url.pathname)
        if(decoded.startsWith('/sdk/')){res.writeHead(404).end();return}
        selected=path.resolve(root,'.'+decoded)
        if(!boundedFile(root,selected)&&selected!==root){res.writeHead(403).end();return}
        const info=await stat(selected).catch(()=>null)
        if(!info?.isFile()){
          if(path.extname(decoded)){res.writeHead(404).end();return}
          selected=path.join(root,'index.html')
        }
        selected=await realpath(selected)
        if(!boundedFile(root,selected)){res.writeHead(403).end();return}
      }
      if(releaseFiles&&!releaseFiles.has(selected)){res.writeHead(404).end();return}
      const bytes=await readFile(selected)
      const expected=releaseFiles?.get(selected)
      if(expected&&(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)){res.writeHead(503).end('Release asset changed; restart with matching source disclosure');return}
      res.writeHead(200,{'content-type':types[path.extname(selected)]??'text/plain'}).end(req.method==='HEAD'?undefined:bytes)
    }catch{if(!res.headersSent)res.writeHead(500);res.end('Consumer host error')}
  })
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  const url=await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve(`http://127.0.0.1:${server.address().port}`)})})
  return{url,configure(value){
    if(config)throw Error('Consumer is already configured')
    const agentUrl=origin(value.agentUrl),relayUrl=origin(value.relayUrl)
    if(agentUrl===url)throw Error('Trusted agent requires a separate origin')
    if(value.grantPath!==undefined){
      grantPath(value.grantPath)
      if(typeof value.audience!=='string'||!value.audience.trim()||value.audience.length>256||/[\u0000-\u001f\u007f]/.test(value.audience))throw Error('Host mode requires a bounded audience')
    }else if(value.audience!==undefined)throw Error('Host mode requires a grant path')
    config={agentUrl,relayUrl,...(value.grantPath?{audience:value.audience,grantPath:value.grantPath}:{}),...(value.nativeAuth===true?{nativeAuth:true}:{})}
  },async close(){if(closed)return;closed=true;await new Promise(resolve=>{server.close(resolve);for(const socket of sockets)socket.destroy();server.closeAllConnections()})}}
}
