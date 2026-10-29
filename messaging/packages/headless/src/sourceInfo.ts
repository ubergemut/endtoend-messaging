// SPDX-License-Identifier: AGPL-3.0-only
import {fileURLToPath} from 'node:url'
import {loadSourceDisclosure,verifyDisclosedRuntime} from '../../../scripts/source-disclosure.mjs'
export type DisclosureOptions={sourceDisclosure?:string;releaseMode?:boolean}
export async function adapterDisclosure(options:DisclosureOptions&{publicBaseRequired?:boolean}={}){
  const releaseMode=options.releaseMode??process.env.ENDTOEND_RELEASE_MODE==='1'
  const disclosure=await loadSourceDisclosure(options.sourceDisclosure??process.env.ENDTOEND_SOURCE_DISCLOSURE,{required:releaseMode})
  if(releaseMode)await verifyDisclosedRuntime(disclosure,'messaging-core',fileURLToPath(new URL('../../../',import.meta.url)))
  const base=process.env.ENDTOEND_SOURCE_BASE_URL
  if(releaseMode&&options.publicBaseRequired&&!base)throw new Error('MCP/CLI release disclosure requires ENDTOEND_SOURCE_BASE_URL for a public download origin')
  const metadata={license:'AGPL-3.0-only',clientLicense:'MIT',...(disclosure?.component('messaging-core',base)??{version:'0.2.0',sourceUrl:null,sourceStatus:'development'})}
  return{disclosure,metadata}
}
export function serveAdapterMetadata(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse,metadata:unknown){
  if(!['/release.json','/licenseInfo'].includes(new URL(req.url??'/','http://127.0.0.1').pathname))return false
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{allow:'GET, HEAD'}).end();return true}
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'}).end(req.method==='HEAD'?undefined:JSON.stringify(metadata));return true
}
