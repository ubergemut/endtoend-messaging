// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {startMessaging} from '../../../scripts/serve-messaging.mjs'
import {contrast} from '../../../packages/agent/src/appearance.ts'

const directory=await mkdtemp(path.join(tmpdir(),'endtoend-hosted-browser-')),checks=[],errors=[]
let service,browser
const output=process.env.ENDTOEND_HOSTED_BROWSER_OUTPUT
try{
 service=await startMessaging({dataDir:path.join(directory,'state'),brandName:'Example App'})
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})})
 for(const [mode,width] of [['light',1360],['dark',1360],['light',390],['dark',390],['invalid',390]]){
  const palette=mode==='invalid'?{text:'red;display:none'}:{background:mode==='light'?'#f4f7fc':'#101b2a',surface:mode==='light'?'#ffffff':'#18283c',text:'#777777',button:mode==='light'?'#114488':'#88bbff',buttonText:'#777777',border:'#777777',focus:'#777777',link:'#777777'}
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500}),page=await context.newPage()
  try{
   page.on('pageerror',error=>errors.push(error.message))
   // Simulate a host's optional fragment field before trusted code reads the native pairing.
   // The stock reference opens about:blank first and then navigates that owned popup.
   await context.addInitScript(({appearance,agentOrigin})=>{if(location.origin===agentOrigin&&location.hash){const fragment=new URLSearchParams(location.hash.slice(1));fragment.set('appearance',JSON.stringify(appearance));history.replaceState(null,'',location.pathname+'#'+fragment.toString())}},{appearance:palette,agentOrigin:service.agentOrigin})
   await page.goto(service.referenceUrl)
   const handle='hosted_'+mode+'_'+width+'_'+Date.now().toString(36)
   await page.getByLabel('Handle',{exact:true}).fill(handle);await page.getByLabel('Account password',{exact:true}).fill('synthetic-hosted-password');await page.getByLabel('Display name',{exact:true}).fill('Synthetic appearance test')
   await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('button',{name:'Connect trusted agent',exact:true}).waitFor()
   const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect trusted agent',exact:true}).click();const agent=await opened;await agent.setViewportSize({width,height:900});agent.on('pageerror',error=>errors.push(error.message));assert.equal(await agent.evaluate(()=>innerWidth),width)
   await agent.locator('#unlock:not([hidden])').waitFor();assert.equal(await agent.title(),'Example App secure messaging');assert.equal(new URL(agent.url()).hash,'');assert.notEqual(new URL(agent.url()).origin,new URL(page.url()).origin)
   const colors=await agent.evaluate(()=>{const hex=c=>'#'+c.match(/\d+/g).slice(0,3).map(v=>Number(v).toString(16).padStart(2,'0')).join('');const main=getComputedStyle(document.querySelector('main')),input=getComputedStyle(document.querySelector('#secret')),button=getComputedStyle(document.querySelector('#generate')),link=getComputedStyle(document.querySelector('#source'));return {text:hex(main.color),surface:hex(main.backgroundColor),input:hex(input.color),inputBackground:hex(input.backgroundColor),button:hex(button.color),buttonBackground:hex(button.backgroundColor),link:hex(link.color),overflow:document.documentElement.scrollWidth>innerWidth}})
   assert.ok(contrast(colors.text,colors.surface)>=4.5);assert.ok(contrast(colors.input,colors.inputBackground)>=4.5);assert.ok(contrast(colors.button,colors.buttonBackground)>=4.5);assert.ok(contrast(colors.link,colors.surface)>=4.5);assert.equal(colors.overflow,false)
   assert.ok(await agent.locator('#license').isVisible());assert.ok(await agent.locator('#source').isVisible());assert.match(await agent.locator('main').innerText(),/Copyright EndToEnd contributors/)
   if(mode==='invalid')assert.equal(colors.surface,'#18283c');else assert.equal(colors.surface,palette.surface)
   await agent.locator('#secret').focus();assert.equal(await agent.locator('#secret').evaluate(node=>getComputedStyle(node).outlineStyle),'solid')
   if(output){await mkdir(output,{recursive:true});await agent.screenshot({path:path.join(output,mode+'-'+width+'.png'),fullPage:true})}
   await agent.locator('#generate').click();await agent.locator('#backup').check();await agent.getByRole('button',{name:'Unlock messaging',exact:true}).click();await page.getByRole('heading',{name:'Contacts',exact:true}).waitFor({timeout:30000});assert.match(await agent.locator('#status').innerText(),/Return to Example App/);assert.equal(await agent.locator('#secret').inputValue(),'')
   checks.push({mode,width,readable:true,unlocked:true,separateOrigin:true,sourceVisible:true})
  }finally{await context.close()}
 }
 const context=await browser.newContext(),page=await context.newPage();try{await page.goto(service.agentUrl+'/#'+new URLSearchParams({callerOrigin:service.referenceOrigin,capability:'a'.repeat(43),appearance:JSON.stringify({surface:'#ffffff'})}));await page.getByText('Open this trusted agent from a registered Example App client.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('main')).backgroundColor),'rgb(24, 40, 60)');checks.push({unregisteredOpenerIgnored:true})}finally{await context.close()}
 assert.deepEqual(errors,[])
 const receipt={kind:'generic-hosted-controls-browser',passed:true,checks,syntheticOnly:true,publicDeployment:false};if(output)await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt))
}finally{
 await browser?.close();await service?.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('endtoend-hosted-browser-'));await rm(directory,{recursive:true,force:true})
}
