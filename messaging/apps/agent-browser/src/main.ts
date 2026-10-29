import {loadSignal} from '@e2ee/crypto/browser'
import {createDeviceSecret,HeadlessError,authorizationBinding,validateBootstrap,type AuthorizationBinding,type AuthorizedBootstrap} from '@e2ee/session'
import {createDispatcher,type IdentityApproval} from '@e2ee/agent/dispatcher'
import {openBrowserVault,inspectVault} from './vault.ts'
import './style.css'

type Config={allowedCallerOrigins:string[];relayOrigins:string[];sourceUrl?:string;version?:string;manifestUrl?:string;sourceSha256?:string;sourceManifestSha256?:string;licenseUrl?:string;noticesUrl?:string;noticeUrls?:string[];disclosureUrl?:string;sourceStatus?:string}
type Bootstrap=AuthorizedBootstrap
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
const message=element<HTMLParagraphElement>('status')
const form=element<HTMLFormElement>('unlock')
const secretField=element<HTMLInputElement>('secret')
const backup=element<HTMLInputElement>('backup')
const replace=element<HTMLInputElement>('replace')
const lockButton=element<HTMLButtonElement>('lock')
const approval=element<HTMLElement>('approval')
let vault:Awaited<ReturnType<typeof openBrowserVault>>|null=null
let openingVault:Awaited<ReturnType<typeof openBrowserVault>>|null=null
let connected:{relay:string;token:string;bootstrap:Bootstrap;stay:string;authorization?:AuthorizationBinding}|null=null
let generated=false
let activeSecret=''
let awaiting:{operation:'trustIdentity'|'markVerified';input:Record<string,unknown>;approval:IdentityApproval}|null=null
let pairedPort:MessagePort|null=null
let acceptedPairing=false
let lastCallerActivity=Date.now()
let connectionGeneration=0
let connectionController=new AbortController()
const originalOpener=window.opener
const fragment=new URLSearchParams(location.hash.slice(1))
const capability=fragment.get('capability')??''
const callerOrigin=fragment.get('callerOrigin')??''
history.replaceState(null,'',location.pathname+location.search)
const response=await fetch('/config.json',{cache:'no-store',credentials:'same-origin'})
if(!response.ok)throw new Error('Agent runtime configuration is unavailable')
const config=await response.json() as Config
if(!Array.isArray(config.allowedCallerOrigins)||!Array.isArray(config.relayOrigins))throw new Error('Agent runtime configuration is invalid')
element('release-version').textContent=`Messaging ${config.version??'development'} · ${config.sourceStatus==='verified'?'version-specific source available':'development build'}`
for(const [id,value] of [['source',config.sourceUrl],['source-manifest',config.manifestUrl],['license',config.licenseUrl],['notices',config.noticesUrl]] as const)if(value){const url=new URL(value,location.href);if(url.origin===location.origin||url.protocol==='https:'){element<HTMLAnchorElement>(id).href=url.href}}
if(config.sourceSha256)element('source').title=`Source SHA-256: ${config.sourceSha256}`
const signal=await loadSignal()

function status(){return vault?.session.status()??{unlocked:false,handle:connected?.bootstrap.account.handle??null,accountId:connected?.bootstrap.account.id??null,relay:connected?.relay??'',vaultPath:'agent browser',pendingTrustHandle:null}}
function rememberKey(){return connected?`endtoend-agent-resume:${JSON.stringify([connected.relay,connected.bootstrap.account.id])}`:''}
function saveRememberedSecret(){
  if(!connected)return
  const durations:Record<string,number>={day:86400000,week:604800000,month:2592000000,forever:0}
  if(connected.stay==='tab'){localStorage.removeItem(rememberKey());return}
  if(activeSecret&&connected.stay in durations)localStorage.setItem(rememberKey(),JSON.stringify({secret:activeSecret,until:durations[connected.stay]?Date.now()+durations[connected.stay]:null}))
}
function lock(forget=true){
  connectionGeneration+=1
  connectionController.abort();connectionController=new AbortController()
  vault?.close();vault=null;openingVault?.close();openingVault=null;activeSecret='';secretField.value='';generated=false;backup.checked=false;replace.checked=false
  awaiting=null;approval.hidden=true;lockButton.hidden=true
  if(forget&&rememberKey())localStorage.removeItem(rememberKey())
  form.hidden=!connected;message.textContent='Messaging is locked.'
}
async function bootstrap(relay:string,token:string,authorization?:AuthorizationBinding){
  const url=new URL(relay)
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!config.relayOrigins.includes(url.origin))throw new HeadlessError('Relay is not configured for this agent','invalid')
  if(!token||token.length>8192)throw new HeadlessError('Missing relay authorization','invalid')
  const binding=authorizationBinding(authorization)
  const reply=await fetch(`${url.origin}${binding.bootstrapPath}`,{headers:{authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:connectionController.signal})
  if(!reply.ok)throw new HeadlessError('Account authorization expired. Reconnect from EndToEnd.','relay')
  const value=validateBootstrap(await reply.json(),binding)
  return {relay:url.origin,bootstrap:value,authorization:authorization===undefined?undefined:binding}
}
async function performUnlock(secret:string){
  if(!connected)throw new HeadlessError('Connect your account first','locked')
  const generation=connectionGeneration
  const context=connected
  const verified=await bootstrap(context.relay,context.token,context.authorization)
  if(generation!==connectionGeneration||verified.bootstrap.account.id!==context.bootstrap.account.id)throw new HeadlessError('Account changed during unlock','locked')
  const exists=await inspectVault(context.relay,context.bootstrap.account.id)
  if(verified.bootstrap.enrolled&&!exists&&!replace.checked)throw new HeadlessError('This account has another device. Explicitly confirm replacement here.','replace-keys')
  const opened=await openBrowserVault({relay:context.relay,accountId:context.bootstrap.account.id,secret,signal})
  if(generation!==connectionGeneration){opened.close();throw new HeadlessError('Unlock was cancelled','locked')}
  openingVault=opened
  try{
    // Existing local identities are checked before Session.attach can flush any pending work.
    if(exists){
      const outer=opened.session
      if(verified.bootstrap.identityKey&&await opened.identity()!==verified.bootstrap.identityKey){opened.close();throw new HeadlessError('This device was replaced. Its history remains sealed.','replace-keys')}
      if(generation!==connectionGeneration)throw new HeadlessError('Unlock was cancelled','locked')
      await outer.attach(context.token,context.bootstrap.account,{authorization:context.authorization})
    }else{
      await opened.session.attach(context.token,context.bootstrap.account,{authorization:context.authorization,replaceKeys:replace.checked})
    }
    if(generation!==connectionGeneration){opened.close();throw new HeadlessError('Unlock was cancelled','locked')}
    vault=opened;activeSecret=secret;secretField.value='';form.hidden=true;lockButton.hidden=false;message.textContent='Messaging is unlocked. Return to EndToEnd to use it.'
    saveRememberedSecret()
  }catch(error){opened.close();throw error}finally{if(openingVault===opened)openingVault=null}
}
const dispatcher=createDispatcher({signal,session:()=>vault?.session??null,status,sourceInfo:{version:config.version??'0.2.0',sourceUrl:config.sourceUrl,sourceSha256:config.sourceSha256,manifestUrl:config.manifestUrl,sourceManifestSha256:config.sourceManifestSha256,licenseUrl:config.licenseUrl,noticesUrl:config.noticesUrl,noticeUrls:config.noticeUrls,disclosureUrl:config.disclosureUrl,sourceStatus:config.sourceStatus},
  async attach(input){
    if(typeof input.relay!=='string'||typeof input.token!=='string')throw new HeadlessError('Missing relay authorization','invalid')
    const generation=connectionGeneration
    const binding=input.authorization===undefined?undefined:authorizationBinding(input.authorization)
    const verified=await bootstrap(input.relay,input.token,binding)
    if(generation!==connectionGeneration)throw new HeadlessError('Account connection was cancelled','locked')
    if(typeof input.expectedAccountId==='string'&&verified.bootstrap.account.id!==input.expectedAccountId)throw new HeadlessError('Authorized account does not match the requested account','invalid')
    const same=connected?.relay===verified.relay&&connected?.bootstrap.account.id===verified.bootstrap.account.id
    if(!same)lock(false)
    connected={...verified,token:input.token,stay:typeof input.stay==='string'?input.stay:'week'}
    const attachedGeneration=connectionGeneration
    element('account').textContent=`Account: ${verified.bootstrap.account.handle}`
    const exists=await inspectVault(verified.relay,verified.bootstrap.account.id)
    if(attachedGeneration!==connectionGeneration)throw new HeadlessError('Account connection was cancelled','locked')
    element('replace-label').hidden=!verified.bootstrap.enrolled||exists
    if(vault){await vault.session.attach(input.token,verified.bootstrap.account,{authorization:binding});if(attachedGeneration!==connectionGeneration)throw new HeadlessError('Account connection was cancelled','locked');return status()}
    form.hidden=false;message.textContent=exists?'Enter your device secret here to unlock messaging.':'Create and save a device secret here.'
    try{const saved=JSON.parse(localStorage.getItem(rememberKey())??'null') as {secret:string;until:number|null}|null
      if(saved&&(!saved.until||saved.until>Date.now())&&exists){await performUnlock(saved.secret)}
      else if(saved)localStorage.removeItem(rememberKey())
    }catch(error){
      if(attachedGeneration!==connectionGeneration)throw error
      if(error instanceof HeadlessError&&error.code==='device-key')localStorage.removeItem(rememberKey())
      message.textContent=error instanceof Error?error.message:'Enter your device secret to unlock messaging.'
    }
    if(attachedGeneration!==connectionGeneration)throw new HeadlessError('Account connection was cancelled','locked')
    return status()
  },
  async requestUnlock(){window.focus();form.hidden=!!vault||!connected;return{...status(),pending:!vault}},
  async setStay(stay){if(!connected)throw new HeadlessError('Connect an account first','locked');connected.stay=stay;saveRememberedSecret();return{stay}},
  async unlock(){throw new HeadlessError('Enter device secrets in the trusted agent window','invalid')},
  async confirm(operation,input){
    const generation=connectionGeneration
    const current=vault
    if(!current)throw new HeadlessError('Agent is locked','locked')
    const handle=typeof input.handle==='string'?input.handle:undefined
    const pending=current.session.record?.pendingTrust
    const peer=operation==='trustIdentity'&&pending?current.session.friendRecords.find(friend=>friend.id===pending.peerId):null
    const decisionHandle=operation==='trustIdentity'?peer?.handle:handle
    const safety=decisionHandle?await current.session.safetyNumber(decisionHandle):null
    if(generation!==connectionGeneration||current!==vault)throw new HeadlessError('Identity decision was cancelled','locked')
    let snapshot:IdentityApproval
    if(operation==='trustIdentity'){
      if(!pending)throw new HeadlessError('No identity is waiting for trust','invalid')
      if(peer&&current.session.friendRecords.find(friend=>friend.id===pending.peerId)?.identityKey!==pending.identityKey)throw new HeadlessError('The identity changed while preparing approval. Sync and review it again.','untrusted')
      snapshot={operation,peerId:pending.peerId,identityKey:pending.identityKey}
    }else{
      if(!handle||!safety)throw new HeadlessError('Choose a contact to verify','invalid')
      snapshot={operation,handle,safetyNumber:safety.safetyNumber}
    }
    awaiting={operation,input,approval:snapshot};approval.hidden=false
    element('approval-text').textContent=operation==='trustIdentity'?'Trust this changed identity only after checking who owns it. This does not mark the new safety number verified.':'Confirm that you compared this safety number with your contact and it matched.'
    element('safety').textContent=operation==='trustIdentity'?`${JSON.stringify(snapshot)}${safety?`\n${safety.handle}\n${safety.safetyNumber}`:''}`:safety?`${safety.handle}\n${safety.safetyNumber}`:JSON.stringify(snapshot)
    window.focus();return{pending:true}
  },
  lock(){lock()},
  disconnect(){lock(false)},
})

window.addEventListener('message',event=>{
  if(event.source!==originalOpener||event.origin!==callerOrigin||!config.allowedCallerOrigins.includes(event.origin))return
  const data=event.data
  if(!data||data.type!=='endtoend-agent-connect'||data.version!==1||data.capability!==capability||!/^[A-Za-z0-9_-]{32,128}$/.test(capability)||typeof data.nonce!=='string'||data.nonce.length>160||event.ports.length!==1)return
  if(pairedPort||acceptedPairing)return
  acceptedPairing=true;lastCallerActivity=Date.now()
  pairedPort=event.ports[0]
  pairedPort.onmessage=async packet=>{
    lastCallerActivity=Date.now()
    const result=await dispatcher.dispatch(packet.data)
    if(vault&&!vault.session.status().unlocked){
      lock(false);connected=null;form.hidden=true;element('account').textContent=''
      message.textContent='Messaging authorization ended. Reconnect from your application.'
    }
    pairedPort?.postMessage(result)
  }
  pairedPort.onmessageerror=()=>{dispatcher.revoke(false);pairedPort?.close();pairedPort=null}
  pairedPort.start();pairedPort.postMessage({type:'endtoend-agent-connected',version:1,nonce:data.nonce})
  message.textContent='Connected. Sign in from EndToEnd to select your account.'
})
if(originalOpener&&config.allowedCallerOrigins.includes(callerOrigin)&&/^[A-Za-z0-9_-]{32,128}$/.test(capability)){
  originalOpener.postMessage({type:'endtoend-agent-ready',version:1},callerOrigin)
}else{message.textContent='Open this trusted agent from a registered EndToEnd client.'}
element('generate').addEventListener('click',()=>{secretField.value=createDeviceSecret();secretField.type='text';generated=true;backup.checked=false;element('backup-label').hidden=false;message.textContent='Save this secret before unlocking. Account passwords cannot recover it.'})
element('copy').addEventListener('click',()=>{void navigator.clipboard.writeText(secretField.value).then(()=>{message.textContent='Device secret copied.'}).catch(()=>{message.textContent='Copy the displayed device secret manually.'})})
form.addEventListener('submit',event=>{event.preventDefault();if(generated&&!backup.checked){message.textContent='Confirm that you saved your device secret first.';return}
  const generation=connectionGeneration
  const secret=secretField.value.trim();secretField.type='password';message.textContent='Opening the sealed vault…'
  void performUnlock(secret).catch(error=>{if(generation===connectionGeneration)message.textContent=error instanceof Error?error.message:'Unlock failed'})
})
lockButton.addEventListener('click',()=>dispatcher.revoke())
element('decline').addEventListener('click',()=>{awaiting=null;approval.hidden=true})
element('approve').addEventListener('click',()=>{const requested=awaiting;if(!requested)return;awaiting=null;approval.hidden=true
  const generation=connectionGeneration
  void dispatcher.trusted(requested.operation,requested.input,requested.approval).then(()=>{if(generation===connectionGeneration)message.textContent='Identity decision saved on this device.'}).catch(error=>{if(generation===connectionGeneration)message.textContent=error.message})
})
window.addEventListener('pagehide',()=>{dispatcher.revoke(false);pairedPort?.close();pairedPort=null})
window.addEventListener('pageshow',event=>{if(event.persisted){dispatcher.revoke(false);pairedPort?.close();pairedPort=null;connected=null;form.hidden=true;message.textContent='Reconnect from EndToEnd to continue.'}})
setInterval(()=>{
  if(originalOpener?.closed||(pairedPort&&Date.now()-lastCallerActivity>30000)){
    dispatcher.revoke(false);pairedPort?.close();pairedPort=null;connected=null;form.hidden=true
    element('account').textContent='';message.textContent='Caller disconnected. Reconnect from EndToEnd.'
  }
},1000)
