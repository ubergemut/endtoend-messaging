// SPDX-License-Identifier: AGPL-3.0-only
import {stat,readFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {startReleaseApplication,verifyReleaseBrowserPaths} from './serve-endtoend.mjs'
import {openMessagingState} from './messaging-state.mjs'
import {validateHostIdentityConfig} from '../apps/api/src/hostIdentity.ts'
import {loadSourceDisclosure,verifyDisclosedRuntime} from './source-disclosure.mjs'

const root=fileURLToPath(new URL('..',import.meta.url))
function origin(value){
  if(value===undefined)return
  const url=new URL(value)
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Public URLs must be bare origins')
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Public origins require HTTPS')
  return url.origin
}

/** Standalone public stack: reference app, trusted device agent and real persistent relay. */
export async function startMessaging(options={}){
  const releaseMode=options.releaseMode??process.env.ENDTOEND_RELEASE_MODE==='1'
  const disclosure=await loadSourceDisclosure(options.sourceDisclosure??process.env.ENDTOEND_SOURCE_DISCLOSURE,{required:releaseMode})
  if(releaseMode)await verifyDisclosedRuntime(disclosure,'messaging-core',root)
  const sourceRoot=path.resolve(options.sourceRoot??root)
  const referenceDist=path.resolve(options.referenceDist??path.join(sourceRoot,'apps/messaging-reference/dist'))
  const agentDist=path.resolve(options.agentDist??path.join(sourceRoot,'apps/agent-browser/dist'))
  if(releaseMode)await verifyReleaseBrowserPaths(referenceDist,agentDist)
  const referenceOrigin=origin(options.referenceOrigin),agentOrigin=origin(options.agentOrigin)
  if(referenceOrigin&&referenceOrigin===agentOrigin)throw new Error('Reference application and trusted agent need separate origins')
  if(options.hostIdentity!==undefined&&options.hostIdentityConfig!==undefined)throw new Error('Provide either hostIdentity or a host identity configuration file')
  let hostIdentity=options.hostIdentity
  if(options.hostIdentityConfig!==undefined){
    const file=path.resolve(options.hostIdentityConfig),metadata=await stat(file)
    if(!metadata.isFile()||metadata.size>65536)throw new Error('Host identity configuration must be a JSON file no larger than 64 KiB')
    hostIdentity=JSON.parse(await readFile(file,'utf8'))
  }
  if(hostIdentity!==undefined)validateHostIdentityConfig(hostIdentity)
  if(options.callerOrigins!==undefined&&(!Array.isArray(options.callerOrigins)||options.callerOrigins.some(value=>typeof value!=='string')))throw new Error('Caller origins must be an array of bare origins')
  const callerOrigins=(options.callerOrigins??[]).map(origin)
  if(agentOrigin&&callerOrigins.includes(agentOrigin))throw new Error('The trusted agent cannot be a caller origin')
  await Promise.all([stat(path.join(referenceDist,'index.html')),stat(path.join(agentDist,'index.html'))])
  const state=await openMessagingState(options.dataDir,{sourceRoot})
  let application
  try{application=await startReleaseApplication({version:'0.2.0',productDist:referenceDist,agentDist,relayDataDir:state.relayDataDir,releaseIndex:options.releaseIndex,sourceDisclosure:options.sourceDisclosure??process.env.ENDTOEND_SOURCE_DISCLOSURE,verifiedDisclosure:disclosure,releaseMode,productOrigin:referenceOrigin,agentOrigin,hostIdentity,callerOrigins})}
  catch(error){await state.close();throw error}
  let closing
  return{referenceUrl:application.productUrl,agentUrl:application.agentUrl,relayUrl:application.relayUrl,referenceOrigin:application.productOrigin,agentOrigin:application.agentOrigin,deploymentId:state.deploymentId,dataDir:state.directory,
    async close(){if(closing)return closing;closing=(async()=>{try{await application.close()}finally{await state.close()}})();return closing}}
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const allowed=new Set(['data-dir','reference-dist','agent-dist','release-index','source-disclosure','release-mode','reference-origin','agent-origin','host-identity-config','caller-origins']),flags={}
  for(let i=2;i<process.argv.length;i+=2){const name=process.argv[i]?.replace(/^--/,'');if(!process.argv[i]?.startsWith('--')||!allowed.has(name)||!process.argv[i+1]||process.argv[i+1].startsWith('--')||flags[name])throw new Error('Use --data-dir <explicit-directory-outside-source> [--reference-dist <path>] [--agent-dist <path>] [--release-index <path>] [--reference-origin https://...] [--agent-origin https://...]');flags[name]=process.argv[i+1]}
  if(flags['release-mode']!==undefined&&!['true','false'].includes(flags['release-mode']))throw new Error('--release-mode must be true or false')
  const started=await startMessaging({dataDir:flags['data-dir'],referenceDist:flags['reference-dist'],agentDist:flags['agent-dist'],releaseIndex:flags['release-index'],sourceDisclosure:flags['source-disclosure'],releaseMode:flags['release-mode']===undefined?undefined:flags['release-mode']==='true',referenceOrigin:flags['reference-origin'],agentOrigin:flags['agent-origin'],hostIdentityConfig:flags['host-identity-config'],callerOrigins:flags['caller-origins']?.split(',').map(value=>value.trim())})
  console.log(JSON.stringify({type:'endtoend-messaging-ready',version:'0.2.0',referenceUrl:started.referenceUrl,agentUrl:started.agentUrl,relayUrl:started.relayUrl,referenceOrigin:started.referenceOrigin,agentOrigin:started.agentOrigin,deploymentId:started.deploymentId}))
  const stop=()=>void started.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop)
}
