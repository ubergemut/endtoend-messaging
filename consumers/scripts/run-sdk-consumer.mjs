// SPDX-License-Identifier: MIT
// Copyright (c) 2026 EndToEnd contributors. See packages/client/LICENSE.
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {startSdkConsumer} from './serve-sdk-consumer.mjs'

const root=fileURLToPath(new URL('..',import.meta.url))
if(process.argv.slice(2).includes('--help')){console.log('node scripts/run-sdk-consumer.mjs --component endtoend-web|desk-client --disclosure /path/source-disclosure.json --agent https://agent.example --relay https://relay.example [--grant-path /host/grant --audience host-name]\nThe local demo uses native accounts unless a host grant path and audience are supplied. Source access is public and independent of login.');process.exit(0)}
const flags={}
for(let index=2;index<process.argv.length;index+=2){assert(process.argv[index].startsWith('--')&&process.argv[index+1],'Flags require a value');flags[process.argv[index].slice(2)]=process.argv[index+1]}
assert(['endtoend-web','desk-client'].includes(flags.component),'Choose --component endtoend-web or desk-client')
assert(flags.disclosure&&flags.agent&&flags.relay,'Supply --disclosure, --agent and --relay')
const web=flags.component==='endtoend-web'
const service=await startSdkConsumer({directory:path.join(root,web?'apps/web/dist':'apps/desk-client'),sdkRoot:root,configPath:web?'/agent-config.json':'/desk-config.json',sourceDisclosure:flags.disclosure,releaseMode:true,componentId:flags.component})
try{service.configure({agentUrl:flags.agent,relayUrl:flags.relay,...(flags['grant-path']?{grantPath:flags['grant-path'],audience:flags.audience}:{nativeAuth:true})})}catch(error){await service.close();throw error}
console.log(JSON.stringify({url:service.url,component:flags.component,publicSource:service.url+'/release.json'}))
let stopping=false
async function stop(){if(stopping)return;stopping=true;await service.close()}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop())
