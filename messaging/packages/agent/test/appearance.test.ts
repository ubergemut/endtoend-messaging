// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {brandName,agentAppearance,contrast} from '../src/appearance.ts'

test('host branding accepts a bounded plain name and rejects executable or misleading input',()=>{
  assert.equal(brandName(undefined),'EndToEnd');assert.equal(brandName('The Choice'),'The Choice')
  for(const input of ['',null,' A','A\nB','<script>','https://host.invalid','A'.repeat(49)])assert.throws(()=>brandName(input))
})
test('data-only appearance rejects CSS, remote assets, extra fields and oversized input',()=>{
  for(const input of ['null','[]','{"__proto__":{}}','{"background":"url(https://invalid)"}','{"text":"#fff"}','{"style":"display:none"}','{"text":"#123456;"}',' '.repeat(1025)])assert.throws(()=>agentAppearance(input))
  assert.equal(agentAppearance(null).palette.background,'#101b2a')
})
test('light and dark host colors retain readable text, inputs, buttons, links and focus',()=>{
  for(const surface of ['#ffffff','#000000','#777777','#e1e8fb','#101b2a']){
    const result=agentAppearance(JSON.stringify({background:surface,surface,text:surface,button:surface,buttonText:surface,border:surface,focus:surface,link:surface}))
    const p=result.palette
    for(const [text,bg,min] of [[p.text,p.surface,4.5],[p.buttonText,p.button,4.5],[p.border,p.surface,3],[p.focus,p.surface,3],[p.link,p.surface,4.5],[result.pageText,p.background,4.5]] as const)assert.ok(contrast(text,bg)>=min)
  }
})
