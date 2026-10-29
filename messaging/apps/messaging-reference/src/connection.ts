// SPDX-License-Identifier: AGPL-3.0-only
// First-party reference handshake adapted from the original EndToEnd browser consumer.
import {AgentClient,MessagePortTransport} from '@e2ee/client'

export type RuntimeConfig={agentUrl:string;relayUrl:string}
export type Connection={client:AgentClient;popup:Window;close(forget?:boolean):Promise<void>}

export function validateConfig(value:unknown,callerOrigin:string):RuntimeConfig{
  if(!value||typeof value!=='object')throw new Error('Missing agent configuration')
  const input=value as RuntimeConfig,agent=new URL(input.agentUrl),relay=new URL(input.relayUrl)
  const safe=(url:URL)=>!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))
  if(!safe(agent)||!safe(relay)||agent.origin===callerOrigin)throw new Error('The trusted agent requires a separate secure origin')
  return{agentUrl:agent.href,relayUrl:relay.href.replace(/\/$/,'')}
}

/** Open inside the user gesture, authenticate source+origin+nonce, then attach only the account token. */
export async function connectBrowserAgent(token:string,accountId:string,signal:AbortSignal):Promise<Connection>{
  const opened=window.open('about:blank','_blank','popup,width=540,height=720')
  if(!opened)throw new Error('Allow the trusted agent popup, then connect again')
  const popup:Window=opened
  let client:AgentClient|undefined,handshakeAbort:(()=>void)|undefined
  const abort=()=>{handshakeAbort?.();if(client)void client.call(signal.reason==='logout'?'lock':'disconnect').catch(()=>{}).finally(()=>{void client?.close();popup.close()});else popup.close()}
  signal.addEventListener('abort',abort,{once:true})
  try{
    signal.throwIfAborted()
    const response=await fetch('/agent-config.json',{cache:'no-store',signal})
    if(!response.ok)throw new Error('Configure /agent-config.json before connecting')
    const config=validateConfig(await response.json(),location.origin),agent=new URL(config.agentUrl),channel=new MessageChannel(),nonce=crypto.randomUUID(),capability=crypto.randomUUID()+crypto.randomUUID()
    agent.hash=new URLSearchParams({capability,callerOrigin:location.origin}).toString()
    await new Promise<void>((resolve,reject)=>{
      let sent=false,finished=false
      const timeout=setTimeout(()=>finish(new Error('Trusted agent connection timed out')),30_000),closed=setInterval(()=>{if(popup.closed)finish(new Error('Trusted agent window closed'))},300)
      function finish(error?:Error){if(finished)return;finished=true;clearTimeout(timeout);clearInterval(closed);window.removeEventListener('message',ready);channel.port1.removeEventListener('message',connected);handshakeAbort=undefined;if(error){channel.port1.close();channel.port2.close();reject(error)}else resolve()}
      function ready(event:MessageEvent){if(signal.aborted||sent||event.source!==popup||event.origin!==agent.origin||event.data?.type!=='endtoend-agent-ready')return;sent=true;popup.postMessage({type:'endtoend-agent-connect',version:1,nonce,capability},agent.origin,[channel.port2])}
      function connected(event:MessageEvent){if(event.data?.type==='endtoend-agent-connected'&&event.data.nonce===nonce)finish()}
      handshakeAbort=()=>finish(new Error('Connection cancelled'));window.addEventListener('message',ready);channel.port1.addEventListener('message',connected);channel.port1.start();popup.location.href=agent.href
    })
    signal.throwIfAborted();client=new AgentClient(new MessagePortTransport(channel.port1))
    await client.attach({relay:config.relayUrl,token,expectedAccountId:accountId,stay:'tab'});signal.throwIfAborted()
    await client.requestUnlock();signal.throwIfAborted()
    let closed=false
    return{client,popup,async close(forget=true){if(closed)return;closed=true;try{if(!popup.closed)await client!.call(forget?'lock':'disconnect')}finally{await client!.close();popup.close()}}}
  }catch(error){await client?.close();popup.close();throw error}
  finally{signal.removeEventListener('abort',abort)}
}
