// SPDX-License-Identifier: MIT
// Synthetic public-protocol fixture only. No engine/private app source is read.
// Usage: node public-interface-lifecycle.mjs <playwright-module> <SDK-extraction> [chromium-executable]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { strict as assert } from 'node:assert';

const modulePath = process.argv[2];
const sdkRoot = process.argv[3];
if (!modulePath || !sdkRoot) throw new Error('Pass the Playwright module path and the published SDK extraction directory.');
const playwrightModule = await import(pathToFileURL(resolve(modulePath)).href);
const { chromium } = playwrightModule.default || playwrightModule;
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const events = [];
let mode = 'native';
let fixture = {};
let agentOrigin, relayOrigin;
const account = { id: 'fixture-account', handle: 'fixture_user', displayName: 'Fixture User' };
const peer = { id: 'fixture-peer', handle: 'fixture_peer', displayName: 'Peer <b>inert</b>', identityKey: 'public-fixture', verified: false };
const token = 'synthetic-test-token';
const grant = () => ({ version: 1, protocolVersion: 1, audience: 'fixture-audience', token,
  expiresAt: new Date(Date.now() + 600_000).toISOString(), account, bootstrapPath: '/messaging/v1/session' });
const servers = [];
async function serve(handler) {
  const server = createServer(handler); servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  response.end(JSON.stringify(value));
}
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }

relayOrigin = await serve(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type,authorization' }); response.end(); return;
  }
  if (request.url === '/api/auth/login' || request.url === '/api/auth/register') {
    const input = await body(request); events.push({ kind: 'native-auth', path: request.url, hasPassword: typeof input.password === 'string', cookie: request.headers.cookie || null });
    json(response, { token, account });
  } else if (request.url === '/api/auth/logout' || request.url === '/messaging/v1/session/revoke') {
    events.push({ kind: 'revoke', path: request.url, authorized: request.headers.authorization === `Bearer ${token}` }); json(response, { ok: true });
  } else json(response, { error: 'No synthetic fixture endpoint' }, 404);
});
agentOrigin = await serve(async (request, response) => {
  if (request.url === '/fixture-event' && request.method === 'POST') { events.push(await body(request)); json(response, { ok: true }); return; }
  response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  response.end(`<!doctype html><html><title>Public agent fixture</title><body><h1>Synthetic trusted agent</h1><script>
    const fixture = ${JSON.stringify(fixture)};
    const account = ${JSON.stringify(account)}, peer = ${JSON.stringify(peer)};
    const hash = new URLSearchParams(location.hash.slice(1));
    const callerOrigin = hash.get('callerOrigin'), capability = hash.get('capability');
    let port, unlocked = true, sends = 0;
    const messages = [{id:'fixture-message',peerId:peer.id,groupId:null,body:'Private fixture card <img src=x onerror=alert(1)>',fromMe:false,at:new Date().toISOString(),expiresAt:null,attachments:[{mediaId:'fixture-file',name:'fixture.bin',mime:'application/octet-stream'}]}];
    const record = event => fetch('/fixture-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)});
    const status = () => ({unlocked,handle:account.handle,accountId:account.id,relay:${JSON.stringify(relayOrigin)},vaultPath:'fixture-only',pendingTrustHandle:null});
    const views = () => ({messages,friends:[peer],groups:[],seen:[],peers:{},pendingTrust:null,revision:1});
    window.addEventListener('message', event => {
      const data = event.data;
      if(event.origin!==callerOrigin || event.source!==opener || data?.type!=='endtoend-agent-connect' || data.version!==1 || data.capability!==capability || !event.ports[0]) return;
      record({kind:'pairing',version:data.version,hasNonce:typeof data.nonce==='string',capabilityLength:capability.length});
      port=event.ports[0]; port.start();
      port.postMessage({type:'endtoend-agent-connected',version:fixture.wrongConnectedVersion?2:1,nonce:fixture.wrongNonce?'other-nonce':data.nonce});
      port.onmessage = async event => {
        const request=event.data;
        if(request.version!==1 || typeof request.requestId!=='string') return;
        record({kind:'command',operation:request.operation,operationId:request.operationId||null,input:request.operation==='attach'?{expectedAccountId:request.input.expectedAccountId,authorization:request.input.authorization||null}:request.operation==='send'?{body:request.input.body}:undefined});
        let result;
        switch(request.operation){
          case 'attach': result=status(); break;
          case 'capabilities': result={version:1,protocolVersion:1,operations:['status','views','requests','sync','pendingSends','retryPending','send','safetyNumber','markVerified','trustIdentity'],events:[],cancellation:'local-only',operationIds:'send-idempotency',attachments:'base64'}; break;
          case 'requestUnlock': case 'status': result=status(); break;
          case 'views': result=views(); break;
          case 'requests': case 'pendingSends': case 'retryPending': result=[]; break;
          case 'sync': result={messages:[],pendingTrustHandle:null}; break;
          case 'focus': result={message:null,threadId:null}; break;
          case 'markSeen': result={seen:request.input.ids.length}; break;
          case 'send':
            sends++;
            if(fixture.forbiddenSend){port.postMessage({version:1,requestId:request.requestId,ok:false,error:{code:'forbidden',message:'Synthetic membership restriction'}});return;}
            if(fixture.timeoutFirstSend && sends===1){port.postMessage({version:1,requestId:request.requestId,ok:false,error:{code:'timeout',message:'Synthetic uncertain delivery'}});return;}
            result={id:'sent-'+sends,peerId:peer.id,groupId:null,body:request.input.body,fromMe:true,at:new Date().toISOString(),expiresAt:null,replyTo:request.input.replyTo||null};
            if(fixture.delaySend) await new Promise(resolve=>setTimeout(resolve,fixture.delaySend));
            messages.push(result);break;
          case 'attachment': result={base64:'AAH/gA0K'};break;
          case 'safetyNumber': result={handle:peer.handle,safetyNumber:'12345 67890',verified:false};break;
          case 'markVerified': case 'trustIdentity': result={pending:true};break;
          case 'lock': case 'disconnect': unlocked=false;result={unlocked:false};break;
          default: result={ok:true};
        }
        if(fixture.delayViews && request.operation==='views') await new Promise(resolve=>setTimeout(resolve,fixture.delayViews));
        port.postMessage({version:1,requestId:request.requestId,ok:true,result});
      };
    });
    opener.postMessage({type:'endtoend-agent-ready',version:fixture.wrongReadyVersion?2:1},callerOrigin);
  </script></body></html>`);
});
const deskOrigin = await serve(async (request, response) => {
  if (request.url === '/desk-config.json') {
    json(response, fixture.invalidConfig || { agentUrl: agentOrigin, relayUrl: relayOrigin,
      ...(mode === 'native' ? { nativeAuth: true } : { audience: 'fixture-audience', grantPath: '/host/grant' }) }); return;
  }
  if (request.url === '/host/grant') { events.push({kind:'host-grant',cookie:request.headers.cookie||null}); json(response,grant()); return; }
  const paths = {
    '/': ['index.html', 'text/html'], '/desk.js': ['desk.js', 'text/javascript'], '/desk.css': ['desk.css', 'text/css'],
    '/sdk/client/index.js': [resolve(sdkRoot,'packages/client/dist/index.js'),'text/javascript'],
    '/sdk/client/relay-service.js': [resolve(sdkRoot,'packages/client/dist/relay-service.js'),'text/javascript'],
    '/sdk/protocol/index.js': [resolve(sdkRoot,'packages/protocol/dist/index.js'),'text/javascript']
  };
  const route = paths[request.url]; if(!route){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'content-type':route[1],'cache-control':'no-store'});response.end(await readFile(resolve(appRoot,route[0])));
});
const browser = await chromium.launch({ headless: true, ...(process.argv[4] ? { executablePath: process.argv[4] } : {}) });
const results = [];
const errors = [];
async function scenario(name, config, work) {
  fixture = config; events.length = 0;
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addCookies([{ name: 'fixture-host', value: 'synthetic-cookie', url: deskOrigin }]);
  const page = await context.newPage(); page.on('pageerror', error => errors.push({scenario:name,message:error.message}));
  try { await work(page, context); results.push({ name, passed: true }); }
  finally { await context.close(); }
}
async function connect(page) {
  await page.goto(deskOrigin);
  await page.locator('#notice').filter({hasText:'Your desk is ready'}).waitFor();
  const popupPromise = page.waitForEvent('popup');
  if(mode==='native') {await page.locator('#login-handle').fill(account.handle);await page.locator('#login-password').fill('synthetic-password');await page.locator('#login').click();}
  else await page.locator('#connect-agent').click();
  const popup=await popupPromise;
  await page.locator('#connection-status').filter({hasText:'Agent connected'}).waitFor();
  await page.locator('[data-message-id="fixture-message"]').waitFor();
  return popup;
}
async function cleared(page) {
  await page.locator('#desk').waitFor({state:'hidden'});
  assert.equal(await page.locator('#transcript').textContent(),'');
  assert.equal(await page.locator('#message-details').textContent(),'');
  assert.equal(await page.locator('#message-body').inputValue(),'');
  assert.equal(await page.locator('#login-password').inputValue(),'');
  assert.equal(await page.locator('#pending-sends').textContent(),'');
}
try {
  for (const authMode of ['native','host']) {
    mode=authMode;
    await scenario(`${mode}: public attach and immediate lock cleanup`,{},async page=>{
      await connect(page);
      assert.equal(await page.locator('#transcript img').count(),0);
      assert.equal(await page.locator('#contacts b').count(),0);
      await page.locator('#message-body').fill('Unsent private text');
      await page.locator('#safety-number').click();
      await page.locator('#safety-value').filter({hasText:'12345'}).waitFor();
      await page.locator('#lock').click();await cleared(page);
      for(let attempt=0;attempt<30 && !events.some(event=>event.kind==='revoke' && event.authorized);attempt++) await page.waitForTimeout(100);
      assert(events.some(event=>event.kind==='revoke' && event.authorized),`Messaging session was not revoked: ${JSON.stringify(events)}`);
      const attach=events.find(event=>event.operation==='attach');
      assert.equal(attach.input.expectedAccountId,account.id);
      assert.deepEqual(attach.input.authorization,mode==='host'?{audience:'fixture-audience',bootstrapPath:'/messaging/v1/session'}:null);
      if(mode==='host') assert.equal(events.find(event=>event.kind==='host-grant').cookie,'fixture-host=synthetic-cookie');
      else assert.equal(events.find(event=>event.kind==='native-auth').cookie,null);
    });
    await scenario(`${mode}: late send cannot restore cleared plaintext`,{delaySend:700},async page=>{
      await connect(page);await page.locator('#message-body').fill('Late secret text');await page.locator('#send').click();
      await page.locator('#lock').click();await cleared(page);await page.waitForTimeout(1000);await cleared(page);
    });
    await scenario(`${mode}: late views cannot restore cleared plaintext`,{delayViews:600},async page=>{
      await connect(page);await page.locator('#sync').click();await page.waitForTimeout(100);
      await page.locator('#lock').click();await cleared(page);await page.waitForTimeout(900);await cleared(page);
    });
    await scenario(`${mode}: cancelled pairing revokes already issued authority`,{wrongReadyVersion:true},async page=>{
      await page.goto(deskOrigin);
      const popupPromise=page.waitForEvent('popup');
      if(mode==='native'){await page.locator('#login-handle').fill(account.handle);await page.locator('#login-password').fill('synthetic-password');await page.locator('#login').click();}
      else await page.locator('#connect-agent').click();
      await popupPromise;await page.waitForTimeout(150);await page.locator('#cancel-connect').click();await cleared(page);
      for(let attempt=0;attempt<30 && !events.some(event=>event.kind==='revoke');attempt++) await page.waitForTimeout(100);
      assert(events.some(event=>event.kind==='revoke' && event.authorized),'Cancelling pairing left issued authority unrevoked.');
    });
  }
  mode='native';
  await scenario('membership forbidden keeps the current desk open',{forbiddenSend:true},async page=>{
    await connect(page);await page.locator('#message-body').fill('Restricted message');await page.locator('#send').click();
    await page.locator('#notice').filter({hasText:'forbidden'}).waitFor();assert(await page.locator('#desk').isVisible());
    await page.locator('#signout').click();await cleared(page);
  });
  await scenario('uncertain send reuses operation ID and exact input',{timeoutFirstSend:true},async page=>{
    await connect(page);await page.locator('#message-body').fill('Exactly one intent');await page.locator('#send').click();
    await page.locator('#uncertain-send').waitFor({state:'visible'});await page.locator('#retry-intent').click();
    await page.locator('#notice').filter({hasText:'Message sent.'}).waitFor();
    const sends=events.filter(event=>event.operation==='send');assert.equal(sends.length,2);assert.equal(sends[0].operationId,sends[1].operationId);assert.deepEqual(sends[0].input,sends[1].input);
    await page.locator('#signout').click();await cleared(page);
  });
  for(const fault of ['wrongReadyVersion','wrongConnectedVersion','wrongNonce']) {
    await scenario(`reject ${fault} and cancel pairing`,{[fault]:true},async page=>{
      await page.goto(deskOrigin);await page.locator('#login-handle').fill(account.handle);await page.locator('#login-password').fill('synthetic-password');
      const popupPromise=page.waitForEvent('popup');await page.locator('#login').click();await popupPromise;await page.waitForTimeout(250);
      assert.equal(events.filter(event=>event.operation==='attach').length,0);await page.locator('#cancel-connect').click();await cleared(page);
    });
  }
  await scenario('blocked popup does not issue native credentials',{},async page=>{
    await page.addInitScript(()=>{window.open=()=>null;});await page.goto(deskOrigin);
    await page.locator('#login-handle').fill(account.handle);await page.locator('#login-password').fill('synthetic-password');await page.locator('#login').click();
    await page.locator('#notice').filter({hasText:'popup was blocked'}).waitFor();await cleared(page);
    assert.equal(events.filter(event=>event.kind==='native-auth').length,0);
  });
  await scenario('closed popup clears pending pairing',{wrongReadyVersion:true},async page=>{
    await page.goto(deskOrigin);await page.locator('#login-handle').fill(account.handle);await page.locator('#login-password').fill('synthetic-password');
    const popupPromise=page.waitForEvent('popup');await page.locator('#login').click();const popup=await popupPromise;await popup.close();
    await page.locator('#notice').filter({hasText:'window was closed'}).waitFor();await cleared(page);
  });
  await scenario('pairing timeout clears the desk',{wrongReadyVersion:true},async page=>{
    await page.clock.install();await page.goto(deskOrigin);await page.locator('#login-handle').fill(account.handle);await page.locator('#login-password').fill('synthetic-password');
    const popupPromise=page.waitForEvent('popup');await page.locator('#login').click();await popupPromise;
    await page.clock.fastForward(45_001);await page.locator('#notice').filter({hasText:'45 seconds'}).waitFor();await cleared(page);
  });
  await scenario('unsafe host grant path is refused',{invalidConfig:{agentUrl:agentOrigin,relayUrl:relayOrigin,audience:'fixture-audience',grantPath:'//other.invalid/grant'}},async page=>{
    await page.goto(deskOrigin);await page.locator('#notice').filter({hasText:'safe same-origin'}).waitFor();assert(await page.locator('#connect-agent').isDisabled());
  });
  assert.deepEqual(errors,[],'Browser raised unexpected errors.');
  process.stdout.write(JSON.stringify({passed:true,scenarios:results},null,2)+'\n');
} finally {
  await browser.close();
  await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
}
