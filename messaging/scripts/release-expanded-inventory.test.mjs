// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {parseYarnLock,pgliteDataMembers,tarMembers,auditExpandedInventory,compareAwaiterHelper} from './release-expanded-inventory.mjs'
const sha=x=>createHash('sha256').update(x).digest('hex')
function tar(name,content,type='0'){
 const header=Buffer.alloc(512),body=Buffer.from(content);header.write(name,0,100);header.write('0000644\0',100);header.write(body.length.toString(8).padStart(11,'0')+'\0',124);header.fill(32,148,156);header.write(type,156);header.write('ustar\0',257);const sum=header.reduce((n,b)=>n+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return Buffer.concat([header,body,Buffer.alloc((512-body.length%512)%512)])
}
test('Yarn grouped and quoted selectors retain exact dependency versions',()=>{
 const lock='# yarn lockfile v1\n\n"@scope/a@^1.0.0", "@scope/a@~1.2.0":\n  version "1.2.3"\n  resolved "https://registry.npmjs.org/@scope/a/-/a-1.2.3.tgz"\n  integrity sha512-abc\n  dependencies:\n    "@scope/b" "^2"\n  optionalDependencies:\n    native "1"\n'
 const [entry]=parseYarnLock(lock);assert.deepEqual(entry.selectors,['@scope/a@^1.0.0','@scope/a@~1.2.0']);assert.equal(entry.dependencies['@scope/b'],'^2');assert.equal(entry.optionalDependencies.native,'1');assert.throws(()=>parseYarnLock(lock.replace('  resolved ','  source ')),/Unsupported/)
})

test('compiler helper correspondence refuses changed runtime semantics',()=>{
 const template='export const awaiterHelper = { text: `var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {\nreturn generator();\n};` };'
 const emitted='var __awaiter$2 = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {\nreturn generator();\n};'
 assert.equal(compareAwaiterHelper(template,emitted).bodyMatches,true)
 assert.throws(()=>compareAwaiterHelper(template,emitted.replace('return generator();','return Promise.resolve();')),/differs/)
})
test('embedded Emscripten metadata accepts minifier exponents and rejects gaps/duplicates',()=>{
 const data=Buffer.alloc(1100),glue='{filename:"/one",start:0,end:1e3},{filename:"/two",start:1e3,end:1100}'
 assert.deepEqual(pgliteDataMembers(glue,data).map(x=>x.size),[1000,100]);assert.throws(()=>pgliteDataMembers(glue.replace('start:1e3','start:1001'),data),/bounds/);assert.throws(()=>pgliteDataMembers(glue.replace('/two','/one'),data),/duplicate/);assert.throws(()=>pgliteDataMembers(glue,data.subarray(0,1000)),/bounds/)
})
test('payload tar reader identifies WASM and refuses unsafe and corrupt headers',()=>{
 const blob=tar('lib/example.so',Buffer.from([0,97,115,109,1,0,0,0]));assert.equal(tarMembers(gzipSync(blob))[0].format,'WebAssembly');assert.throws(()=>tarMembers(gzipSync(tar('../escape','bad'))),/Unsafe/);blob[0]^=1;assert.throws(()=>tarMembers(gzipSync(blob)),/checksum/)
 let record='path=../escape\n',length=record.length+3;while(String(length).length+1+record.length!==length)length=String(length).length+1+record.length;const pax=tar('PaxHeader',length+' '+record,'x');assert.throws(()=>tarMembers(gzipSync(Buffer.concat([pax,tar('safe','bad')]))),/Unsafe/)
})
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'endtoend-inventory-'));t.after(async()=>{const absolute=path.resolve(root);assert.ok(absolute.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(absolute).startsWith('endtoend-inventory-'));await rm(absolute,{recursive:true,force:true})})
 await mkdir(path.join(root,'docs/release/inventory'),{recursive:true});const bytes=Buffer.from('public source'),lock=Buffer.from('# yarn lockfile v1\n');await writeFile(path.join(root,'source.tgz'),bytes);await writeFile(path.join(root,'LICENSE'),bytes);await writeFile(path.join(root,'yarn.lock'),lock)
 const inventory={yarnLockSha256:sha(lock),issues:[],npm:{installedPackages:1,packages:[{name:'fixture',notices:[{path:'LICENSE',sha256:sha(bytes)}],preferredSource:{archive:'source.tgz'}}],preferredSources:{packages:[{archive:'source.tgz',sha256:sha(bytes)}],upstream:[]}},pglite:{preferredSourceChecks:[],components:[],buildRecipes:[],embeddedSourceMaps:[]}}
 const save=()=>writeFile(path.join(root,'docs/release/inventory/EXPANDED_INVENTORY.json'),JSON.stringify(inventory));await save();return{root,inventory,save}
}
test('offline audit requires no installed dependencies and detects source mutation',async t=>{
 const f=await fixture(t);assert.equal((await auditExpandedInventory(f.root)).passed,true);await writeFile(path.join(f.root,'source.tgz'),'changed');const result=await auditExpandedInventory(f.root);assert.equal(result.passed,false);assert.equal(result.issues[0].code,'preferred-source-checksum')
})
test('offline audit refuses traversing evidence references',async t=>{
 const f=await fixture(t);f.inventory.npm.preferredSources.packages[0].archive='../escape';await f.save();const result=await auditExpandedInventory(f.root);assert.equal(result.passed,false);assert.ok(result.issues.some(x=>x.code==='unsafe-audit-path'))
})
test('offline audit refuses an ancestor junction even when the target bytes match',async t=>{
 const f=await fixture(t),outside=await mkdtemp(path.join(tmpdir(),'endtoend-inventory-outside-'));t.after(async()=>{assert.ok(path.resolve(outside).startsWith(path.resolve(tmpdir())+path.sep));await rm(outside,{recursive:true,force:true})});await writeFile(path.join(outside,'copy'),'public source');await symlink(outside,path.join(f.root,'junction'),process.platform==='win32'?'junction':'dir');f.inventory.npm.preferredSources.packages[0].archive='junction/copy';await f.save();const result=await auditExpandedInventory(f.root);assert.equal(result.passed,false);assert.ok(result.issues.some(x=>x.code==='preferred-source-link'))
})
