// SPDX-License-Identifier: AGPL-3.0-only
import {bytesToBase64,type Account,type AgentViews,type FriendRequestView,type PendingSendView,type ConversationFilter} from '@e2ee/client'
import {connectBrowserAgent,type Connection} from './connection.ts'
import './style.css'

const app=document.querySelector<HTMLDivElement>('#app')!
// Only fixed first-party markup is inserted as HTML. All account/message/error data uses textContent.
app.innerHTML=`<header><div><h1>EndToEnd public messenger</h1><p>Standalone AGPL reference application · protocol v1</p></div><div id="identity">Signed out</div></header>
<main><div id="error" class="notice" role="alert" hidden></div><div id="notice" class="notice" role="status">Sign in or create a new account.</div>
<section id="auth"><h2>Account</h2><form id="account-form"><label>Handle<input name="handle" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+"></label><label>Account password<input name="password" type="password" autocomplete="current-password" required minlength="5"></label><label>Display name<input name="displayName" autocomplete="nickname" maxlength="80"></label><div id="auth-actions"><button type="submit" name="mode" value="login">Sign in</button><button type="submit" name="mode" value="register">Create account</button></div></form></section>
<section id="connection" hidden><h2>Trusted messaging agent</h2><p>Open the separate trusted window to create or unlock your device. Enter the device secret only in that window.</p><button id="connect">Connect trusted agent</button></section>
<div id="account-controls" class="row" hidden><button id="sync">Sync now</button><button id="focus-agent">Show trusted agent</button><button id="lock">Lock agent</button><button id="logout">Sign out</button></div>
<div id="workspace" class="layout" hidden><div class="sidebar">
<aside><h2>Contacts</h2><div id="contacts"></div><details><summary>Request a contact</summary><form id="request-form"><label>Request handle<input name="handle" required></label><label>Request note<input name="note" maxlength="1000"></label><button>Send request</button></form></details></aside>
<aside><h2>Requests</h2><div id="requests"></div></aside>
<aside><h2>Groups</h2><div id="groups"></div><details><summary>New group</summary><form id="group-form"><label>Group name<input name="name" required maxlength="100"></label><label>Group members<input name="members" placeholder="alice, bob" required></label><button>Create group</button></form></details></aside></div>
<section><h2 id="conversation-title">Choose a conversation</h2><div id="conversation-actions" class="row"></div><div id="trust" class="notice" hidden></div><div id="messages" role="log" aria-label="Messages" aria-live="polite"></div>
<form id="composer"><fieldset id="compose-fields" disabled><div id="replying" hidden></div><label>Message<textarea name="body" maxlength="100000"></textarea></label><label>Attachments<input name="files" type="file" multiple></label><div class="row"><label for="disappearing">Disappearing</label><select id="disappearing" name="expiry"><option value="0">Off</option><option value="5">5 seconds</option><option value="60">1 minute</option><option value="3600">1 hour</option><option value="86400">1 day</option></select><button>Send</button><button id="cancel-reply" type="button" hidden>Cancel reply</button></div></fieldset></form>
<div id="pending"></div><details id="group-management" hidden><summary>Group membership</summary><div id="group-roster"></div><form id="member-form"><label>Add contact handle<input name="handle" required></label><button>Add member</button></form><button id="leave-group">Leave group</button></details></section></div></main>
<footer><span>Copyright © 2026 EndToEnd contributors. No warranty, except as stated in the applicable licenses. You may modify and redistribute this software under AGPL-3.0-only.</span><span id="release-version">Public messaging</span><a id="license-link" href="/LICENSE.txt">AGPL license</a><a id="source-link" href="/source-disclosure.json">Corresponding source</a><a id="manifest-link" href="/source-disclosure.json">Source manifest and hashes</a><a id="notices-link" href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a></footer>`

const element=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!
const form=(id:string)=>element<HTMLFormElement>(id)
const input=(id:string,name:string)=>form(id).elements.namedItem(name) as HTMLInputElement
type Login={token:string;account:Account}
let login:Login|null=null,connection:Connection|null=null,view:AgentViews|null=null,requests:FriendRequestView[]=[],pending:PendingSendView[]=[],selection:ConversationFilter|null=null,replyTo:string|undefined
let generation=0,busy=false,refreshing=false,connecting:AbortController|null=null
const downloads=new Map<string,string>(),sendIds=new Map<string,string>(),fileIds=new WeakMap<File,string>()
const button=(label:string,action:()=>void)=>{const node=document.createElement('button');node.type='button';node.textContent=label;node.onclick=action;return node}
const text=(tag:string,value:string)=>{const node=document.createElement(tag);node.textContent=value;return node}
function valid(c:Connection,g:number){return connection===c&&generation===g}
function clearError(){element('#error').hidden=true;element('#error').textContent=''}
function error(reason:unknown){element('#error').textContent=reason instanceof Error?reason.message:String(reason);element('#error').hidden=false}
function notice(value:string){element('#notice').textContent=value}
function clearPresentation(){view=null;requests=[];pending=[];selection=null;replyTo=undefined;for(const url of downloads.values())URL.revokeObjectURL(url);downloads.clear();sendIds.clear();for(const id of ['#composer','#request-form','#group-form','#member-form'])form(id).reset();clearError();render()}
function select(next:ConversationFilter){selection=next;replyTo=undefined;render()}

function render(){
  element('#auth').hidden=!!login;element('#account-controls').hidden=!login;element('#connection').hidden=!login||!!view;element('#workspace').hidden=!view
  element('#identity').textContent=login?`@${login.account.handle} · ${view?'unlocked':'locked'}`:'Signed out'
  element<HTMLButtonElement>('#connect').disabled=!!connecting
  element<HTMLButtonElement>('#sync').disabled=!connection||busy;element<HTMLButtonElement>('#focus-agent').disabled=!connection;element<HTMLButtonElement>('#lock').disabled=!connection
  if(!view){for(const id of ['#messages','#contacts','#requests','#groups','#pending','#trust','#conversation-actions','#group-roster','#replying'])element(id).replaceChildren();element('#conversation-title').textContent='Choose a conversation';element('#trust').hidden=true;element('#group-management').hidden=true;element<HTMLFieldSetElement>('#compose-fields').disabled=true;return}
  const contacts=element('#contacts');contacts.replaceChildren()
  for(const friend of view.friends){const row=document.createElement('div');row.className='item';const open=button('@'+friend.handle,()=>select({handle:friend.handle}));open.className='conversation';open.dataset.peer=friend.handle;open.setAttribute('aria-pressed',String(selection?.handle===friend.handle));row.append(open);contacts.append(row)}
  if(!view.friends.length)contacts.append(text('p','Request a contact to start a direct chat.'))
  const requestList=element('#requests');requestList.replaceChildren()
  for(const request of requests.filter(r=>r.status==='pending')){const row=document.createElement('div');row.className='item';row.append(text('strong',`${request.direction==='incoming'?'From':'To'} @${request.handle}`));if(request.note)row.append(text('p',request.note));const actions=request.direction==='incoming'?['accept','decline'] as const:['cancel'] as const;for(const action of actions)row.append(button(action[0].toUpperCase()+action.slice(1),()=>void run(c=>c.client.respondRequest(request.id,action))));requestList.append(row)}
  if(!requestList.childNodes.length)requestList.append(text('p','No pending requests.'))
  const groups=element('#groups');groups.replaceChildren()
  for(const group of view.groups){const open=button(group.name,()=>select({groupId:group.id}));open.className='conversation';open.dataset.group=group.id;open.setAttribute('aria-pressed',String(selection?.groupId===group.id));groups.append(open)}
  if(!view.groups.length)groups.append(text('p','No groups yet.'))
  const friend=view.friends.find(f=>f.handle===selection?.handle),group=view.groups.find(g=>g.id===selection?.groupId)
  element('#conversation-title').textContent=group?.name??(friend?'@'+friend.handle:'Choose a conversation')
  element<HTMLFieldSetElement>('#compose-fields').disabled=!selection||busy
  const actions=element('#conversation-actions');actions.replaceChildren()
  if(friend){actions.append(button('Safety number',()=>void run(async(c,g)=>{const result=await c.client.safetyNumber(friend.handle);if(valid(c,g))notice(`@${friend.handle}: ${result.safetyNumber}${result.verified?' · verified':''}`)})),button('Verify in trusted agent',()=>void run(c=>{c.popup.focus();return c.client.markVerified(friend.handle)})),button('Unfriend',()=>void run(async(c,g)=>{await c.client.unfriend(friend.handle);if(valid(c,g))selection=null})),button('Block',()=>void run(async(c,g)=>{await c.client.block(friend.handle);if(valid(c,g))selection=null})))}
  const trust=element('#trust');trust.replaceChildren();trust.hidden=!view.pendingTrust
  if(view.pendingTrust){trust.append(text('p','An identity changed. Sending remains blocked until you review it in the trusted agent.'),button('Review identity in trusted agent',()=>void run(c=>{c.popup.focus();return c.client.trustIdentity()})))}
  const messages=element('#messages');messages.replaceChildren()
  const visible=view.messages.filter(m=>selection?.groupId?m.groupId===selection.groupId:friend?m.peerId===friend.id&&!m.groupId:false).filter(m=>!m.expiresAt||Date.parse(m.expiresAt)>Date.now())
  for(const message of visible){const row=document.createElement('article');row.className='message'+(message.fromMe?' mine':'');row.dataset.message=message.id;row.append(text('small',`${message.fromMe?'You':message.senderHandle??'Contact'} · ${new Date(message.at).toLocaleTimeString()}`));if(message.quote)row.append(text('blockquote',message.quote));row.append(text('p',message.body));for(const attachment of message.attachments??[]){const link=document.createElement('a');link.textContent=attachment.name;link.download=attachment.name;link.href=downloads.get(attachment.mediaId)??'#';link.onclick=async event=>{if(downloads.has(attachment.mediaId))return;event.preventDefault();const c=connection,g=generation;if(!c)return;try{const bytes=await c.client.attachment(attachment.mediaId);if(!valid(c,g)||!view?.messages.some(m=>m.id===message.id&&(!m.expiresAt||Date.parse(m.expiresAt)>Date.now())))return;const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'}));downloads.set(attachment.mediaId,url);link.href=url;link.click()}catch(reason){if(valid(c,g))error(reason)}};row.append(link,document.createElement('br'))}if(!message.system)row.append(button('Reply',()=>{replyTo=message.id;render();input('#composer','body').focus()}));messages.append(row)}
  const retainedMedia=new Set(view.messages.filter(m=>!m.expiresAt||Date.parse(m.expiresAt)>Date.now()).flatMap(m=>(m.attachments??[]).map(a=>a.mediaId)))
  for(const [id,url] of downloads)if(!retainedMedia.has(id)){URL.revokeObjectURL(url);downloads.delete(id)}
  element('#replying').hidden=!replyTo;element('#replying').textContent=replyTo?'Replying to: '+(view.messages.find(m=>m.id===replyTo)?.body??replyTo):'';element('#cancel-reply').hidden=!replyTo
  const pendingList=element('#pending');pendingList.replaceChildren()
  if(pending.length){pendingList.append(text('h3','Pending sends'));for(const item of pending)pendingList.append(text('p',`${item.attachmentNames.join(', ')||item.body||'Message'} · ${item.state==='blocked'?'Blocked: membership changed; this intent cannot be retried.':'Saved on device; awaiting delivery.'}`));if(pending.some(p=>p.state==='pending'))pendingList.append(button('Retry pending sends',()=>void run(c=>c.client.retryPending())))}
  element('#group-management').hidden=!group
  const roster=element('#group-roster');roster.replaceChildren()
  for(const [index,id] of (group?.memberIds??[]).entries()){const row=document.createElement('p');row.append(document.createTextNode(group?.memberHandles[index]??id));if(id!==login?.account.id)row.append(button('Remove member',()=>void run(c=>c.client.removeMember(group!.id,id))));roster.append(row)}
}

async function refresh(sync=false){
  const c=connection,g=generation;if(!c||refreshing||busy)return;refreshing=true
  try{const status=await c.client.status();if(!valid(c,g))return;if(!status.unlocked){clearPresentation();notice('Unlock messaging in the trusted agent window.');return}if(sync)await c.client.sync();if(!valid(c,g))return;await c.client.dropExpired();if(!valid(c,g))return;const [next,requestRecords,pendingRecords]=await Promise.all([c.client.views(),c.client.requests(),c.client.pendingSends()]);if(!valid(c,g))return;view=next;requests=requestRecords;pending=pendingRecords;render();if(!view.pendingTrust)notice('Device unlocked. Messages and attachments are encrypted by the public agent.')}
  catch(reason){if(valid(c,g)){clearPresentation();error(reason)}}finally{if(g===generation)refreshing=false}
}
async function run(work:(connection:Connection,generation:number)=>Promise<unknown>){
  const c=connection,g=generation;if(!c||busy)return;busy=true;clearError();render()
  try{await work(c,g)}catch(reason){if(valid(c,g))error(reason)}finally{if(valid(c,g)){busy=false;await refresh();render()}}
}
form('#account-form').onsubmit=event=>{event.preventDefault();const mode=(event as SubmitEvent).submitter?.getAttribute('value')??'login';void authenticate(mode)}
async function authenticate(mode:string){
  if(busy)return;const g=++generation;busy=true;clearError();const handle=input('#account-form','handle').value.trim(),password=input('#account-form','password').value,displayName=input('#account-form','displayName').value.trim()||handle
  try{const response=await fetch('/api/auth/'+(mode==='register'?'register':'login'),{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({handle,password,displayName})}),result=await response.json();if(!response.ok)throw new Error(result.error??'Sign in failed');if(g!==generation)return;login=result as Login;input('#account-form','password').value='';notice('Account ready. Connect the trusted agent to unlock messaging.');render()}
  catch(reason){if(g===generation)error(reason)}finally{if(g===generation){busy=false;render()}}
}
element('#connect').onclick=()=>{if(!login||connecting)return;const auth=login,g=++generation,controller=new AbortController();connecting=controller;clearError();clearPresentation();const old=connection;connection=null;void old?.close(false);const pendingConnection=connectBrowserAgent(auth.token,auth.account.id,controller.signal);render();void pendingConnection.then(async next=>{if(controller.signal.aborted||g!==generation||login!==auth){await next.close(controller.signal.reason==='logout');return}connection=next;notice('Complete the unlock in the trusted agent window.');await refresh()}).catch(reason=>{if(g===generation)error(reason)}).finally(()=>{if(connecting===controller)connecting=null;render()})}
element('#focus-agent').onclick=()=>connection?.popup.focus()
element('#sync').onclick=()=>{clearError();void refresh(true)}
element('#cancel-reply').onclick=()=>{replyTo=undefined;render()}
element('#lock').onclick=()=>{const c=connection;generation++;connecting?.abort('logout');connecting=null;connection=null;busy=false;refreshing=false;clearPresentation();notice('Messaging locked. Reconnect to unlock.');void c?.close(true).catch(error)}
element('#logout').onclick=()=>{const auth=login,c=connection;generation++;connecting?.abort('logout');connecting=null;connection=null;login=null;busy=false;refreshing=false;clearPresentation();form('#account-form').reset();notice('Signed out.');void c?.close(true).catch(()=>{});if(auth)void fetch('/api/auth/logout',{method:'POST',headers:{authorization:'Bearer '+auth.token}}).catch(()=>{})}
form('#request-form').onsubmit=event=>{event.preventDefault();const handle=input('#request-form','handle').value.trim(),note=input('#request-form','note').value;void run(async(c,g)=>{await c.client.requestFriend(handle,note);if(valid(c,g))form('#request-form').reset()})}
form('#group-form').onsubmit=event=>{event.preventDefault();const name=input('#group-form','name').value.trim(),handles=input('#group-form','members').value.split(',').map(h=>h.trim()).filter(Boolean);void run(async(c,g)=>{const group=await c.client.createGroup(name,handles);if(valid(c,g)){selection={groupId:group.id};form('#group-form').reset()}})}
form('#member-form').onsubmit=event=>{event.preventDefault();const groupId=selection?.groupId,handle=input('#member-form','handle').value.trim(),friend=view?.friends.find(f=>f.handle===handle);if(!groupId)return;if(!friend){error(new Error('Add an accepted contact by handle'));return}void run(async(c,g)=>{await c.client.addMember(groupId,friend.id);if(valid(c,g))form('#member-form').reset()})}
element('#leave-group').onclick=()=>{const groupId=selection?.groupId;if(groupId)void run(async(c,g)=>{await c.client.leaveGroup(groupId);if(valid(c,g))selection=null})}
form('#composer').onsubmit=event=>{event.preventDefault();const filter=selection?{...selection}:null;if(!filter)return;const body=input('#composer','body').value,files=Array.from(input('#composer','files').files??[]),expiresInSeconds=Number(input('#composer','expiry').value)||undefined,reply=replyTo;if(!body&&!files.length)return
  for(const file of files)if(!fileIds.has(file))fileIds.set(file,crypto.randomUUID())
  const key=JSON.stringify({filter,body,reply,expiresInSeconds,files:files.map(file=>fileIds.get(file))}),operationId=sendIds.get(key)??crypto.randomUUID();sendIds.set(key,operationId)
  void run(async(c,g)=>{const payload={...filter,body,...(reply?{replyTo:reply}:{}),...(expiresInSeconds?{expiresInSeconds}:{})};if(files.length){const encoded=await Promise.all(files.map(async file=>({name:file.name,mime:file.type||'application/octet-stream',base64:bytesToBase64(new Uint8Array(await file.arrayBuffer()))})));if(!valid(c,g))return;await c.client.sendAttachments({...payload,files:encoded},operationId)}else if(filter.groupId)await c.client.sendGroup({...payload,groupId:filter.groupId},operationId);else await c.client.send({...payload,handle:filter.handle!},operationId);if(valid(c,g)){sendIds.delete(key);input('#composer','body').value='';input('#composer','files').value='';replyTo=undefined}})
}
function suspend(){generation++;connecting?.abort('navigation');connecting=null;const c=connection;connection=null;busy=false;refreshing=false;clearPresentation();if(login)notice('Messaging disconnected. Reconnect to unlock.');void c?.close(false).catch(()=>{})}
window.addEventListener('pagehide',suspend)
window.addEventListener('pageshow',event=>{if(event.persisted)suspend()})
setInterval(()=>{if(connection?.popup.closed){suspend();notice('Trusted agent window closed. Reconnect to unlock.')}else void refresh(true)},2000)
// Version-specific source metadata is optional at development time; deployments supply the exact source link.
void fetch('/release.json',{cache:'no-store'}).then(async response=>{if(!response.ok)return;const release=await response.json();element('#release-version').textContent=`Messaging ${release.version??'development'} · ${release.sourceStatus==='verified'?'version-specific source available':'development build'}`;for(const [id,value] of [['#source-link',release.sourceUrl],['#manifest-link',release.manifestUrl],['#license-link',release.licenseUrl],['#notices-link',release.noticesUrl]])if(typeof value==='string'){const url=new URL(value,location.href);if(url.origin===location.origin||url.protocol==='https:')element<HTMLAnchorElement>(id).href=url.href}if(typeof release.sourceSha256==='string')element('#source-link').title=`Source SHA-256: ${release.sourceSha256}`}).catch(()=>{})
render()
