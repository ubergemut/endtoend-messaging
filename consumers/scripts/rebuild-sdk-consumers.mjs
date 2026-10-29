// SPDX-License-Identifier: AGPL-3.0-only
// Complete standalone build for the retained AGPL frontend and independent MIT desk.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'

export function consumerNotices(root) {
  let notices='EndToEnd full frontend: AGPL-3.0-only. Earlier grants remain valid.\nThe separately authored desk client and protocol/client SDK retain their MIT grants.\n\n'
  for(const [label,file] of [['MIT SDK','packages/client/LICENSE'],['React','node_modules/react/LICENSE'],['React DOM','node_modules/react-dom/LICENSE'],['Scheduler','node_modules/scheduler/LICENSE'],['Vite browser preload helper','node_modules/vite/LICENSE.md']])notices+=`=== ${label} ===\n${fs.readFileSync(path.join(root,file),'utf8')}\n\n`
  return notices
}

export function installConsumerNotices(root,{web:includeWeb=true}={}) {
  const web=path.join(root,'apps/web/dist'),desk=path.join(root,'apps/desk-client')
  if(includeWeb){
    fs.mkdirSync(web,{recursive:true})
    fs.writeFileSync(path.join(web,'LICENSE.txt'),fs.readFileSync(path.join(root,'LICENSE')))
    fs.writeFileSync(path.join(web,'THIRD_PARTY_NOTICES.txt'),consumerNotices(root))
  }
  fs.writeFileSync(path.join(desk,'THIRD_PARTY_NOTICES.txt'),'EndToEnd desk client and protocol/client SDK: MIT.\nThe separately running messaging service has its own license and source offer.\n\n'+fs.readFileSync(path.join(desk,'LICENSE'),'utf8')+'\n=== Protocol and client SDK ===\n'+fs.readFileSync(path.join(root,'packages/client/LICENSE'),'utf8'))
}

export async function rebuildSdkConsumers({root=fileURLToPath(new URL('..',import.meta.url)),log=console.log}={}) {
  root=path.resolve(root)
  const run=(args,cwd=root)=>{
    const result=spawnSync(process.execPath,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024})
    log(`$ node ${args.join(' ')}\n${result.stdout??''}${result.stderr??''}`)
    assert(!result.error&&result.status===0,`Consumer rebuild failed: ${result.error?.message??args.join(' ')}`)
  }
  run(['packages/client/build.mjs'])
  run(['../../node_modules/typescript/bin/tsc','--noEmit'],path.join(root,'apps/web'))
  const tests=fs.readdirSync(path.join(root,'apps/web/test')).filter(name=>name.endsWith('.test.ts')).sort().map(name=>'test/'+name)
  run(['--import','tsx','--test',...tests],path.join(root,'apps/web'))
  for(const name of ['desk.js','test/browser-acceptance.mjs','test/public-interface-lifecycle.mjs'])run(['--check',name],path.join(root,'apps/desk-client'))
  const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')))
  await build({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts')})
  installConsumerNotices(root)
  return {passed:true}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await rebuildSdkConsumers()
