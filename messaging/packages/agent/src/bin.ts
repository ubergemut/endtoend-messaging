#!/usr/bin/env node
import { startLocalAgent } from './local.ts'
import {loadSourceDisclosure,verifyDisclosedRuntime} from '../../../scripts/source-disclosure.mjs'
import {fileURLToPath} from 'node:url'
import {licenseInfo} from './sourceInfo.ts'
if(process.argv.includes('--help')){
  process.stdout.write('EndToEnd messaging agent\n--license / --source: release source, manifest and notice metadata (no vault required).\nRelease mode: ENDTOEND_RELEASE_MODE=1 and ENDTOEND_SOURCE_DISCLOSURE=<SOURCE_DISCLOSURE.json> are required. Downloads are public at /source-disclosure.json.\nENDTOEND_RELAY, ENDTOEND_VAULT and ENDTOEND_DEVICE_KEY configure messaging.\n');process.exit(0)
}
if(process.argv.includes('--license')||process.argv.includes('--source')){
  const releaseMode=process.env.ENDTOEND_RELEASE_MODE==='1'
  const disclosure=await loadSourceDisclosure(process.env.ENDTOEND_SOURCE_DISCLOSURE,{required:releaseMode})
  if(releaseMode)await verifyDisclosedRuntime(disclosure,'messaging-core',fileURLToPath(new URL('../../../',import.meta.url)))
  if(releaseMode&&!process.env.ENDTOEND_SOURCE_BASE_URL)throw new Error('CLI release disclosure requires ENDTOEND_SOURCE_BASE_URL for a public download origin')
  process.stdout.write(JSON.stringify({program:'EndToEnd messaging agent',...licenseInfo(disclosure?.component('messaging-core',process.env.ENDTOEND_SOURCE_BASE_URL)??{version:'0.2.0',sourceUrl:process.env.ENDTOEND_SOURCE_URL??null,sourceStatus:'development'})})+'\n')
  process.exit(0)
}
const relay=process.env.ENDTOEND_RELAY
const vaultPath=process.env.ENDTOEND_VAULT
if(!relay||!vaultPath)throw new Error('Set ENDTOEND_RELAY and ENDTOEND_VAULT before starting the agent')
const agent=await startLocalAgent({relay,vaultPath,deviceKey:process.env.ENDTOEND_DEVICE_KEY})
process.stdout.write(JSON.stringify({type:'agent-ready',version:1,url:agent.url,capability:agent.capability})+'\n')
for(const name of ['SIGTERM','SIGINT'] as const)process.once(name,()=>{void agent.close()})
const parent=Number(process.env.ENDTOEND_PARENT_PID)
if(Number.isSafeInteger(parent)&&parent>0){
  const watcher=setInterval(()=>{try{process.kill(parent,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){clearInterval(watcher);void agent.close()}}},1000)
  watcher.unref()
}
