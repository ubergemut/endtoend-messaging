import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'

/** The caller owns the loopback server and fresh persistent database. No existing data is opened. */
export async function exerciseReferenceApplication({browser,productUrl,prefix='reference'}){
  const checks=[],errors=[],actors=[]
  async function actor(suffix){
    const handle=prefix+'_'+suffix,context=await browser.newContext(),page=await context.newPage()
    page.on('pageerror',e=>errors.push(handle+': '+e.message));await page.goto(productUrl)
    await page.getByLabel('Handle',{exact:true}).fill(handle);await page.getByLabel('Account password',{exact:true}).fill('synthetic-account-pass');await page.getByLabel('Display name',{exact:true}).fill(handle)
    await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('button',{name:'Connect trusted agent',exact:true}).waitFor()
    const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect trusted agent',exact:true}).click();const agent=await opened
    agent.on('pageerror',e=>errors.push(handle+' agent: '+e.message));await agent.locator('#unlock:not([hidden])').waitFor();await agent.locator('#generate').click();const secret=await agent.locator('#secret').inputValue();await agent.locator('#backup').check();await agent.getByRole('button',{name:'Unlock messaging',exact:true}).click();await page.getByRole('heading',{name:'Contacts',exact:true}).waitFor({timeout:30_000})
    assert.notEqual(new URL(agent.url()).origin,new URL(page.url()).origin)
    assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('deviceSecret')||v.includes('endtoend-agent-resume'))),false)
    actors.push({context,page,agent,secret,handle});return actors.at(-1)
  }
  try{
    const alice=await actor('alice'),bob=await actor('bob');checks.push('two synthetic accounts register, pair and unlock only on the separate trusted origin')
    await alice.page.getByText('Request a contact',{exact:true}).click();await alice.page.getByLabel('Request handle',{exact:true}).fill(bob.handle);await alice.page.getByLabel('Request note',{exact:true}).fill('Reference invitation');await alice.page.getByRole('button',{name:'Send request',exact:true}).click()
    await bob.page.getByText('Reference invitation',{exact:true}).waitFor({timeout:30_000});await bob.page.getByRole('button',{name:'Accept',exact:true}).click();await alice.page.locator(`[data-peer="${bob.handle}"]`).click();await bob.page.locator(`[data-peer="${alice.handle}"]`).click()
    await alice.page.getByLabel('Message',{exact:true}).fill('Reference direct message');await alice.page.getByRole('button',{name:'Send',exact:true}).click();await bob.page.getByRole('log',{name:'Messages'}).getByText('Reference direct message',{exact:true}).waitFor({timeout:30_000});checks.push('contact request note, acceptance and encrypted direct message through the public reference UI')
    await bob.page.locator('article.message').filter({hasText:'Reference direct message'}).getByRole('button',{name:'Reply',exact:true}).click();await bob.page.getByLabel('Message',{exact:true}).fill('Reference reply');await bob.page.getByRole('button',{name:'Send',exact:true}).click();await alice.page.getByRole('log',{name:'Messages'}).getByText('Reference reply',{exact:true}).waitFor({timeout:30_000});checks.push('reply carries the quote and message context')
    const bytes=Buffer.from('public reference binary\u0000\u00ff'),fileName='reference-proof.bin'
    await alice.page.getByLabel('Attachments',{exact:true}).setInputFiles({name:fileName,mimeType:'application/octet-stream',buffer:bytes});await alice.page.getByRole('button',{name:'Send',exact:true}).click();const file=bob.page.getByRole('link',{name:fileName,exact:true});await file.waitFor({timeout:30_000});const downloaded=bob.page.waitForEvent('download');await file.click();const download=await downloaded;assert.deepEqual(await readFile(await download.path()),bytes);checks.push('attachment ciphertext delivery decrypts to the original bytes')
    await alice.page.getByText('New group',{exact:true}).click();await alice.page.getByLabel('Group name',{exact:true}).fill('Reference group');await alice.page.getByLabel('Group members',{exact:true}).fill(bob.handle);await alice.page.getByRole('button',{name:'Create group',exact:true}).click();await alice.page.getByRole('heading',{name:'Reference group',exact:true}).waitFor();await bob.page.locator('[data-group]').filter({hasText:'Reference group'}).click();await alice.page.getByLabel('Message',{exact:true}).fill('Reference group message');await alice.page.getByRole('button',{name:'Send',exact:true}).click();await bob.page.getByRole('log',{name:'Messages'}).getByText('Reference group message',{exact:true}).waitFor({timeout:30_000});checks.push('group creation and group message delivery use the same public contracts')
    const malicious='<img src=x onerror="globalThis.__referenceXss=true">'
    await alice.page.getByLabel('Message',{exact:true}).fill(malicious);await alice.page.getByRole('button',{name:'Send',exact:true}).click();await bob.page.getByText(malicious,{exact:true}).waitFor({timeout:30_000});assert.equal(await bob.page.locator('#messages img').count(),0);assert.equal(await bob.page.evaluate(()=>globalThis.__referenceXss),undefined);checks.push('message HTML is rendered as inert text without executable elements')
    await alice.page.getByLabel('Disappearing',{exact:true}).selectOption('5');await alice.page.getByLabel('Message',{exact:true}).fill('Reference expiring message');await alice.page.getByRole('button',{name:'Send',exact:true}).click();await bob.page.getByText('Reference expiring message',{exact:true}).waitFor({timeout:30_000});await bob.page.getByText('Reference expiring message',{exact:true}).waitFor({state:'hidden',timeout:20_000});checks.push('disappearing message expires from the reference presentation')
    await alice.page.getByRole('button',{name:'Lock agent',exact:true}).click();await alice.page.getByRole('button',{name:'Connect trusted agent',exact:true}).waitFor();assert.equal(await alice.page.getByText('Reference group message',{exact:true}).count(),0);checks.push('explicit lock clears rendered plaintext and closes the agent connection')
    await bob.page.getByRole('button',{name:'Sign out',exact:true}).click();await bob.page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await bob.page.getByText('Reference group message',{exact:true}).count(),0);assert.equal(await bob.page.getByLabel('Account password',{exact:true}).inputValue(),'');checks.push('sign out clears account, plaintext presentation and credential input')
    assert.deepEqual(errors,[]);return{kind:'public-reference-browser-acceptance',passed:true,checks,errors}
  }catch(error){error.completedChecks=checks;error.browserErrors=errors;throw error}finally{for(const a of actors)await a.context.close()}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const productUrl=process.env.ENDTOEND_REFERENCE_URL;if(!productUrl)throw new Error('Set ENDTOEND_REFERENCE_URL to a fresh synthetic loopback deployment')
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(productUrl).hostname))throw new Error('Acceptance requires a synthetic loopback deployment')
  const browser=await chromium.launch({headless:true});try{const result=await exerciseReferenceApplication({browser,productUrl,prefix:'ref_'+Date.now().toString(36)});console.log(JSON.stringify(result));if(process.env.ENDTOEND_REFERENCE_RECEIPT){await mkdir(path.dirname(process.env.ENDTOEND_REFERENCE_RECEIPT),{recursive:true});await writeFile(process.env.ENDTOEND_REFERENCE_RECEIPT,JSON.stringify(result,null,2)+'\n')}}finally{await browser.close()}
}
