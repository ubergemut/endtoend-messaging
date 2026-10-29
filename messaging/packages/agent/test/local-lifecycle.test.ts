import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDeviceSecret } from '@e2ee/session'
import { startLocalAgent } from '../src/local.ts'
import { acquireVaultLock } from '../src/nodeVault.ts'
import { startReferenceRelay } from './reference-relay.ts'

test('an admitted partial unlock request cannot reopen a stopped agent',{timeout:30000},async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'agent-stopped-request-'))
  const vaultPath=path.join(directory,'vault.json')
  const relay=await startReferenceRelay()
  const agent=await startLocalAgent({relay:relay.baseUrl,vaultPath,deviceKey:createDeviceSecret()})
  let pending:ReturnType<typeof request>|undefined
  try{
    const body=JSON.stringify({version:1,requestId:'late-unlock',operation:'unlock',input:{handle:'stopped_fixture',password:'synthetic-password'}})
    const admitted=new Promise<void>(resolve=>agent.server.once('request',()=>resolve()))
    const response=new Promise<{status:number;body:string}>((resolve,reject)=>{
      pending=request(agent.url+'/v1/command',{method:'POST',headers:{authorization:`Bearer ${agent.capability}`,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
        const chunks:Buffer[]=[]
        res.on('data',chunk=>chunks.push(Buffer.from(chunk)))
        res.on('end',()=>resolve({status:res.statusCode??0,body:Buffer.concat(chunks).toString('utf8')}))
        res.on('error',reject)
      })
      pending.on('error',reject)
      pending.write(body.slice(0,body.length/2))
    })
    await admitted
    await Promise.all([agent.close(),agent.close()])
    const releaseBefore=await acquireVaultLock(vaultPath);await releaseBefore()
    pending!.end(body.slice(body.length/2))
    const received=await response
    assert.equal(received.status,503,received.body)
    const releaseAfter=await acquireVaultLock(vaultPath);await releaseAfter()
  }finally{
    pending?.destroy();await agent.close();agent.server.closeAllConnections()
    await relay.close();await rm(directory,{recursive:true,force:true})
  }
})
