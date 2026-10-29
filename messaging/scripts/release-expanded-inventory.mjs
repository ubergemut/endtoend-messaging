// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto'
import {readFile,writeFile,mkdir,readdir,realpath,lstat} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
import {gunzipSync} from 'node:zlib'

const normalized=value=>value.replaceAll('\\','/')
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=async file=>JSON.parse(await readFile(file,'utf8'))
const unquote=value=>value.startsWith('"')?JSON.parse(value):value

/** Parse the checked-in Yarn v1 format; reject unsupported headers rather than guessing. */
export function parseYarnLock(text){
  if(!text.includes('# yarn lockfile v1'))throw new Error('Expected a Yarn v1 lockfile')
  const entries=[];let current=null,section=null
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()||line.startsWith('#'))continue
    if(!line.startsWith(' ')){
      if(!line.endsWith(':'))throw new Error('Unsupported lockfile entry')
      const header=line.slice(0,-1),selectors=[]
      let start=0,quoted=false,escaped=false
      for(let i=0;i<=header.length;i++){
        if(i===header.length||(!quoted&&header[i]===',')){selectors.push(unquote(header.slice(start,i).trim()));start=i+1;continue}
        if(header[i]==='"'&&!escaped)quoted=!quoted
        escaped=header[i]==='\\'&&!escaped
      }
      current={selectors,dependencies:{},optionalDependencies:{}};entries.push(current);section=null;continue
    }
    if(!current)throw new Error('Lockfile value without entry')
    const group=/^  (dependencies|optionalDependencies):$/.exec(line)
    if(group){section=group[1];continue}
    const scalar=/^  (version|resolved|integrity) (.+)$/.exec(line)
    if(scalar){current[scalar[1]]=unquote(scalar[2]);section=null;continue}
    if(section){const pair=/^    ("(?:\\.|[^"\\])*"|\S+) ("(?:\\.|[^"\\])*"|\S+)$/.exec(line);if(!pair)throw new Error('Unsupported dependency lock line');current[section][unquote(pair[1])]=unquote(pair[2]);continue}
    if(!/^  (?:uid|name) /.test(line))throw new Error(`Unsupported lockfile line: ${line.slice(0,100)}`)
  }
  if(entries.some(entry=>!entry.version||!entry.resolved))throw new Error('Lockfile entry lacks version/resolved source')
  return entries
}

export function tarMembers(bytes){
  const data=gunzipSync(bytes),members=[];let offset=0,longName=null,pax={}
  while(offset+512<=data.length){
    const header=data.subarray(offset,offset+512);if(header.every(byte=>byte===0))break
    const string=(start,size)=>header.subarray(start,start+size).toString('utf8').replace(/\0.*$/s,'')
    const expected=parseInt(string(148,8).trim()||'0',8),actual=header.reduce((sum,byte,i)=>sum+(i>=148&&i<156?32:byte),0)
    if(expected!==actual)throw new Error('Invalid tar header checksum')
    const base=string(0,100),prefix=string(345,155),name=pax.path??longName??(prefix?prefix+'/'+base:base)
    const size=parseInt(string(124,12).trim()||'0',8),type=string(156,1)||'0',start=offset+512,end=start+size
    if(!Number.isSafeInteger(size)||size<0||end>data.length)throw new Error('Invalid tar member bounds')
    const body=data.subarray(start,end)
    if(type==='L')longName=body.toString('utf8').replace(/\0.*$/s,'')
    else if(type==='x'||type==='g'){
      let cursor=0;while(cursor<body.length){const sep=body.indexOf(32,cursor),length=Number(body.subarray(cursor,sep).toString());if(sep<0||!Number.isSafeInteger(length)||length<=sep-cursor+1||cursor+length>body.length)throw new Error('Invalid PAX record');const record=body.subarray(sep+1,cursor+length-1).toString(),eq=record.indexOf('=');if(eq<1)throw new Error('Invalid PAX key');pax[record.slice(0,eq)]=record.slice(eq+1);cursor+=length}
    }
    else{
      if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..'))throw new Error('Unsafe tar member path')
      members.push({path:name,size,type,sha256:hash(body),format:binaryFormat(body)});longName=null;pax={}
    }
    offset=start+Math.ceil(size/512)*512
  }
  return members
}
function binaryFormat(bytes){
  if(bytes.subarray(0,4).equals(Buffer.from([0,97,115,109])))return'WebAssembly'
  if(bytes.subarray(0,2).toString()==='MZ')return'PE/native executable'
  if(bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])))return'ELF/native library'
  return'data-or-text'
}
/** Emscripten's literal package entries are parsed as data, never executed. */
export function pgliteDataMembers(glue,data){
  const entries=[...glue.matchAll(/\{filename:"((?:\\.|[^"\\])*)",start:(\d+(?:e\+?\d+)?),end:(\d+(?:e\+?\d+)?)\}/g)].map(match=>({path:JSON.parse('"'+match[1]+'"'),start:Number(match[2]),end:Number(match[3])}))
  if(!entries.length)throw new Error('PGlite embedded data metadata was not found')
  let cursor=0;const seen=new Set()
  for(const entry of entries){if(!Number.isSafeInteger(entry.start)||!Number.isSafeInteger(entry.end)||entry.start!==cursor||entry.end<entry.start||entry.end>data.length)throw new Error('PGlite embedded data bounds/gaps differ');if(seen.has(entry.path)||entry.path.split('/').includes('..'))throw new Error('PGlite duplicate or unsafe embedded path');seen.add(entry.path);cursor=entry.end;const bytes=data.subarray(entry.start,entry.end);entry.size=bytes.length;entry.sha256=hash(bytes);entry.format=binaryFormat(bytes)}
  if(cursor!==data.length)throw new Error('PGlite data inventory does not cover its whole payload')
  return entries
}

async function files(directory,{skipNodeModules=false}={}){
  const result=[]
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name==='.git'||(skipNodeModules&&entry.name==='node_modules'))continue
    const name=path.join(directory,entry.name)
    if(entry.isSymbolicLink())continue
    if(entry.isDirectory())result.push(...await files(name,{skipNodeModules}))
    else if(entry.isFile())result.push(name)
  }
  return result
}
function isNotice(file){return file.split(/[\\/]/).some(part=>/^(?:licen[cs]es?|copying|notices?|copyrights?|authors|thirdpartynoticetext|thirdpartynotices?)(?:$|[.\-_])/i.test(part)||/\.LICENSE$/i.test(part))}

/** Compare the actual compiler-emitted helper body, allowing Rollup's module binding rewrite only. */
export function compareAwaiterHelper(typescriptSource,emitted){
  const template=/export const awaiterHelper\b[\s\S]+?text:\s*`([\s\S]+?)`/.exec(typescriptSource)?.[1]
  if(!template)throw new Error('Preferred TypeScript awaiter helper not found')
  const expected=template.slice(template.indexOf('function (thisArg')).trim().replace(/\s+/g,'')
  const matches=[...emitted.matchAll(/var __awaiter(?:\$\d+)? = \(undefined && undefined\.__awaiter\) \|\| (function \(thisArg, _arguments, P, generator\) \{[\s\S]+?\n\};)/g)]
  if(!matches.length||matches.some(match=>match[1].trim().replace(/\s+/g,'')!==expected))throw new Error('Emitted awaiter differs from preferred helper body')
  return{copiesCompared:matches.length,bodyMatches:true,recordedAdaptation:'Rollup renames helper bindings and replaces module-level this with undefined; the complete helper function body is otherwise unchanged apart from whitespace.'}
}
async function noticeCandidates(directory){
  const all=await files(directory,{skipNodeModules:true}),result=all.filter(file=>isNotice(normalized(path.relative(directory,file))))
  for(const file of all.filter(file=>/^readme(?:\.|$)/i.test(path.basename(file)))){
    const text=await readFile(file,'utf8')
    if(/(?:permission (?:is hereby granted|to use, copy)|copyright and license)/i.test(text)&&/(?:provided|warrant|liable)/i.test(text))result.push(file)
  }
  return [...new Set(result)]
}
async function captureNotices(root,directory,outputRoot,group){
  const result=[]
  for(const file of await noticeCandidates(directory)){
    const bytes=await readFile(file),relative=normalized(path.relative(directory,file)),target=path.join(outputRoot,group,relative)
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes)
    result.push({sourcePath:normalized(path.relative(root,file)),path:normalized(path.relative(root,target)),sha256:hash(bytes),bytes:bytes.length})
  }
  return result
}
async function verifyRecord(root,record,issues){
  const relative=record.archive??record.path
  if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..')){issues.push({code:'unsafe-or-missing-preferred-source-path',path:relative});return false}
  let bytes;try{
    let cursor=root;for(const segment of relative.split('/')){cursor=path.join(cursor,segment);if((await lstat(cursor)).isSymbolicLink()){issues.push({code:'preferred-source-link',path:relative});return false}}
    const resolved=await realpath(path.join(root,relative));if(!resolved.startsWith((await realpath(root))+path.sep)){issues.push({code:'preferred-source-outside-root',path:relative});return false}
    bytes=await readFile(resolved)
  }catch{issues.push({code:'preferred-source-missing',path:relative});return false}
  if(hash(bytes)!==record.sha256){issues.push({code:'preferred-source-checksum',path:relative});return false}
  if(record.integrity){const matched=record.integrity.split(' ').some(value=>{const sep=value.indexOf('-');return createHash(value.slice(0,sep)).update(bytes).digest('base64')===value.slice(sep+1)});if(!matched){issues.push({code:'preferred-source-integrity',path:relative});return false}}
  return true
}
async function npmPreferredSources(root,issues){
  const sources=await json(path.join(root,'dependencies/preferred-source/npm/PROVENANCE.json')).catch(()=>({records:[]})),upstream=await json(path.join(root,'dependencies/preferred-source/npm-upstream/PROVENANCE.json')).catch(()=>({records:[]}))
  for(const record of [...sources.records,...upstream.records])record.passed=await verifyRecord(root,record,issues)
  for(const record of sources.records){if(record.registryMetadata)await verifyRecord(root,{path:record.registryMetadata,sha256:record.registryMetadataSha256},issues)}
  return{packages:sources.records,upstream:upstream.records}
}
function licenseObligations(license){
  const value=typeof license==='string'?license:JSON.stringify(license)
  const obligations=['Preserve original license, copyright, disclaimer and attribution files in source and applicable distributions.','Third-party terms remain effective; first-party AGPL/MIT declarations do not replace this grant.']
  if(/Apache/.test(value))obligations.push('Retain applicable NOTICE and patent/attribution terms; identify project modifications if made.')
  if(/BSD/.test(value))obligations.push('Retain source notices and reproduce the applicable copyright/conditions/disclaimer with binary distributions; honor any non-endorsement clause.')
  if(/CC-BY/.test(value))obligations.push('Retain data attribution, license link and modification indication required by the Creative Commons Attribution grant.')
  if(/MPL/.test(value))obligations.push('Offer covered source under MPL with original notices and evaluate the specific larger-work/secondary-license route.')
  if(/ISC|MIT|0BSD/.test(value))obligations.push('Retain the grant and disclaimer with copies/substantial portions as the exact original text requires.')
  return obligations
}
async function resolvePackage(from,name){
  let directory=from
  while(true){const candidate=path.join(directory,'node_modules',name,'package.json');if(existsSync(candidate))return path.dirname(candidate);const parent=path.dirname(directory);if(parent===directory)return null;directory=parent}
}
async function workspacePackages(root){
  const result=[{directory:root,meta:await json(path.join(root,'package.json'))}]
  for(const parent of ['apps','packages'])for(const name of await readdir(path.join(root,parent))){const directory=path.join(root,parent,name);if(existsSync(path.join(directory,'package.json')))result.push({directory,meta:await json(path.join(directory,'package.json'))})}
  return result
}
async function installedPackages(root,workspaces){
  const result=new Map(),visited=new Set()
  async function scan(directory){
    if(!existsSync(directory))return
    for(const item of await readdir(directory,{withFileTypes:true})){
      if(item.name.startsWith('.'))continue
      if(item.name.startsWith('@')){await scan(path.join(directory,item.name));continue}
      const folder=path.join(directory,item.name)
      if(!existsSync(path.join(folder,'package.json')))continue
      const actual=await realpath(folder);if(visited.has(actual))continue;visited.add(actual)
      const meta=await json(path.join(folder,'package.json'))
      const workspace=workspaces.some(entry=>path.resolve(entry.directory)===path.resolve(actual))
      result.set(normalized(path.relative(root,folder)),{directory:folder,actual,meta,workspace,roles:new Set(),parents:[],dependencies:[]})
      await scan(path.join(folder,'node_modules'))
    }
  }
  await scan(path.join(root,'node_modules'));for(const entry of workspaces)await scan(path.join(entry.directory,'node_modules'))
  return result
}
function seedRole(workspace,kind){
  if(kind==='devDependencies')return'build-or-test-tool'
  if(workspace==='@e2ee/api')return'persistent-relay-runtime'
  if(workspace==='@e2ee/headless')return'HTTP-GraphQL-MCP-CLI-adapter-runtime'
  if(workspace==='@e2ee/web')return'product-browser-declared-runtime'
  if(workspace==='@e2ee/agent-browser')return'trusted-browser-declared-runtime'
  if(workspace==='@e2ee/agent')return'local-agent-runtime'
  return'workspace-runtime'
}
async function browserBundles(root,workspaces,packages,issues){
  const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')).href),result=[]
  for(const workspace of workspaces.filter(entry=>entry.meta.name==='@e2ee/web'||entry.meta.name==='@e2ee/agent-browser')){
    const captured=[]
    const output=await build({root:workspace.directory,configFile:path.join(workspace.directory,'vite.config.ts'),logLevel:'silent',build:{write:false,emptyOutDir:false},plugins:[{name:'expanded-source-inventory',generateBundle(_options,bundle){for(const [file,item] of Object.entries(bundle)){if(item.type==='chunk')captured.push({file,modules:Object.entries(item.modules).filter(([,details])=>details.renderedLength>0).map(([id,details])=>({id:id.startsWith('\0')?normalized(id).replaceAll(normalized(root)+'/',''):normalized(path.relative(root,id)),renderedLength:details.renderedLength}))})}}}]})
    for(const chunk of captured)for(const module of chunk.modules){
      let owner=[...packages.entries()].filter(([prefix])=>module.id===prefix||module.id.startsWith(prefix+'/')).sort((a,b)=>b[0].length-a[0].length)[0]
      if(owner){owner[1].roles.add('actual-browser-bundled-runtime');module.package=owner[1].meta.name;module.version=owner[1].meta.version}
      else if(module.id.startsWith('\0')){module.provenance='generated-bundler-runtime-helper';module.tool=module.id.includes('modulepreload')?'vite':'@rollup/plugin-commonjs bundled by vite';const vite=[...packages.values()].find(item=>item.meta.name==='vite');vite?.roles.add('generated-browser-runtime-helper');}
      else module.provenance='first-party-or-generated-crypto-source'
    }
    result.push({workspace:workspace.meta.name,chunks:captured,artifacts:output.output.map(item=>({path:item.fileName,type:item.type,sha256:hash(item.type==='chunk'?Buffer.from(item.code):Buffer.from(item.source))}))})
  }
  return result
}
async function captureAssets(root){
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean),assets=[],externalRefs=[]
  for(const name of tracked){
    if(!/^(?:apps|packages|docs)\//.test(name)||name.startsWith('docs/release/inventory/'))continue
    if(/\.(?:png|jpg|jpeg|svg|gif|webp|ico|ttf|otf|woff2?)$/i.test(name))assets.push({path:name,sha256:hash(await readFile(path.join(root,name))),provenance:'first-party asset covered by owner October24 confirmation; screenshot generation scripts retained where applicable',licenseRole:'first-party AGPL/reference-product asset; existing grants preserved'})
    if(/\.(?:css|tsx|html)$/.test(name)){
      const content=await readFile(path.join(root,name),'utf8')
      for(const match of content.matchAll(/(?:url\(|(?:src|href)=)["']?(https?:\/\/[^\s"'<>);]+)/g))externalRefs.push({path:name,url:match[1]})
    }
  }
  const fontStacks=[],inlineIcons=[],generators=[]
  for(const name of ['apps/web/src','apps/agent-browser/src'])for(const file of await files(path.join(root,name))){
    if(file.endsWith('.css'))for(const match of (await readFile(file,'utf8')).matchAll(/font-family\s*:\s*([^;}]+)/g))fontStacks.push({path:normalized(path.relative(root,file)),stack:match[1].trim(),distribution:'Names of installed system fonts/fallbacks only; no font binary is embedded or supplied by this CSS'})
    if(/\.(?:tsx|ts)$/.test(file)){const source=await readFile(file,'utf8'),count=[...source.matchAll(/<svg\b/g)].length;if(count)inlineIcons.push({path:normalized(path.relative(root,file)),svgElements:count,sourceSha256:hash(Buffer.from(source))})}
  }
  for(const name of ['scripts/capture-guide.mjs','scripts/check-site-design.mjs','scripts/e2e-walkthrough.mjs'])if(existsSync(path.join(root,name)))generators.push({path:name,sha256:hash(await readFile(path.join(root,name))),role:'First-party screenshot/guide generation or design verification; image ownership relies on accepted author confirmation, not hash equality'})
  return{assets,externalAssetReferences:externalRefs,fonts:assets.filter(item=>/\.(?:ttf|otf|woff2?)$/i.test(item.path)),fontStacks,inlineIcons:{provenance:'Inline SVG paths in first-party UI source; no icon/font library import found by bundle module inventory',files:inlineIcons},screenshotGenerators:generators,documentation:{firstPartyAuthority:'Owner October24 confirmation applies to original documentation; third-party legal texts and preferred-source trees retain their own terms',thirdPartyExclusions:['docs/release/third-party/**','docs/release/inventory/npm-notices/**','docs/release/inventory/pglite-notices/**','dependencies/preferred-source/**']}}
}

async function pgliteInventory(root,outputRoot,issues){
  const directory=path.join(root,'node_modules/@electric-sql/pglite'),meta=await json(path.join(directory,'package.json')),payloads=[],embeddedJs=[]
  for(const file of await files(path.join(directory,'dist'))){
    const relative=normalized(path.relative(directory,file))
    if(/\.(?:wasm|data|tar\.gz|node|dll|exe)$/i.test(file)){
      const bytes=await readFile(file);payloads.push({path:relative,bytes:bytes.length,sha256:hash(bytes),format:binaryFormat(bytes),...(file.endsWith('.tar.gz')?{members:tarMembers(bytes)}:{})})
    }
    if(file.endsWith('.map')){
      const sourceMap=await json(file)
      for(let i=0;i<(sourceMap.sources??[]).length;i++){
        const original=sourceMap.sources[i]
        embeddedJs.push({map:relative,source:original,sha256:sourceMap.sourcesContent?.[i]?hash(Buffer.from(sourceMap.sourcesContent[i])):null})
      }
    }
  }
  const data=await readFile(path.join(directory,'dist/pglite.data')),glue=await readFile(path.join(directory,'dist/pglite.js'),'utf8')
  const embeddedFs=pgliteDataMembers(glue,data)
  const preferred=path.join(root,'dependencies/preferred-source/pglite-'+meta.version),provenance=await json(path.join(preferred,'PROVENANCE.json')).catch(()=>null),postgres=await json(path.join(preferred,'POSTGRES_PROVENANCE.json')).catch(()=>null),embedded=await json(path.join(preferred,'EMBEDDED_PROVENANCE.json')).catch(()=>null)
  if(!provenance||!postgres||!embedded)issues.push({code:'pglite-preferred-source-missing',package:meta.name})
  const records=[...(provenance?.files??[]),...(postgres?.files??[]),...(embedded?.components??[])]
  const sourceChecks=[]
  for(const record of records){const sourcePath=record.archive??record.path;if(record.status==='unresolved'||!sourcePath){issues.push({code:'pglite-source-unresolved',component:record.name});continue}const file=path.join(preferred,sourcePath);let actual=null;try{actual=hash(await readFile(file))}catch{};const passed=actual===record.sha256;if(!passed)issues.push({code:'pglite-source-checksum',path:sourcePath});sourceChecks.push({path:normalized(path.relative(root,file)),sha256:record.sha256,passed,url:record.url})}
  for(const entry of embeddedJs){
    let candidate
    if(entry.source.includes('pg-protocol/src/'))candidate=path.join(preferred,'upstream/packages/pg-protocol/src',entry.source.split('pg-protocol/src/')[1])
    else if(/^(?:\.\.\/)+src\//.test(entry.source))candidate=path.join(preferred,'upstream/packages/pglite/src',entry.source.replace(/^(?:\.\.\/)+src\//,''))
    else for(const name of ['tsup','tinytar','async-mutex'])if(entry.source.includes('/node_modules/'+name+'/')){const record=embedded?.components.find(item=>item.name.startsWith(name+'-'));if(record)candidate=path.join(preferred,record.sourceDirectory,entry.source.split('/node_modules/'+name+'/')[1]);break}
    if(candidate){entry.preferredSource=normalized(path.relative(root,candidate));entry.matchesPreferredSource=existsSync(candidate)&&hash(await readFile(candidate))===entry.sha256;if(!entry.matchesPreferredSource)issues.push({code:'pglite-embedded-js-source-mismatch',source:entry.source})}
    else if(entry.source==='../release/pglite.js'){entry.treatment='Emscripten-generated PostgreSQL glue; captured original in package source map, preferred C/JS/runtime sources and generation recipe below';entry.preferredSource=['dependencies/preferred-source/pglite-'+meta.version+'/postgres-pglite','dependencies/preferred-source/pglite-'+meta.version+'/embedded/emscripten-3.1.74']}
    else issues.push({code:'pglite-embedded-js-unmapped',source:entry.source})
  }
  const licenseMap={age:'Apache-2.0',pg_hashids:'MIT',pg_ivm:'PostgreSQL',pg_uuidv7:'MPL-2.0',pgtap:'PostgreSQL-style permissive (exact README terms retained)',vector:'PostgreSQL','zlib-1.3.1':'Zlib','libxml2-v2.14.5':'MIT with per-file copyright notices','libxslt-v1.1.43':'MIT with libexslt and per-file notices','openssl-3.0.17':'Apache-2.0','uuid-1.6.2':'OSSP permissive/ISC-style (exact terms retained)','emscripten-3.1.74':'MIT OR NCSA for project; system runtime subcomponents retain their own MIT/BSD/Apache-2.0 WITH LLVM-exception and other notices','async-mutex-0.4.1':'MIT','tinytar-0.1.0':'MIT','tsup-8.3.0':'MIT'}
  const components=[{name:'pglite-wrapper',sourceDirectory:'upstream',license:'Apache-2.0 OR PostgreSQL',role:'TypeScript wrapper and modified pg-protocol bundled runtime'},{name:'postgres-pglite',sourceDirectory:'postgres-pglite',license:'PostgreSQL plus included per-file notices',role:'Modified PostgreSQL C runtime, contrib extensions, catalog/SQL/timezone/text-search data'},...(embedded?.components??[]).map(item=>({...item,license:licenseMap[item.name],role:item.name.startsWith('emscripten-')?'JS/system-library runtime included in WASM/glue; compiler tooling also retained conservatively':item.name.startsWith('tsup-')?'Actually bundled cjs/esm runtime shim (not only a build tool)':item.name.startsWith('async-mutex-')||item.name.startsWith('tinytar-')?'Actually bundled JS runtime':'Native/WASM library or distributed extension source'}))]
  for(const component of components){if(component.name.startsWith('async-mutex-preferred-'))component.license='MIT';if(component.name.startsWith('typescript-preferred-')){component.license='Apache-2.0';component.role='Conservatively retained compiler emitted __awaiter helper source; compiler tooling is also present'}}
  for(const component of components){component.notices=await captureNotices(root,path.join(preferred,component.sourceDirectory),outputRoot,'pglite-notices/'+component.name);if(!component.notices.length)issues.push({code:'pglite-component-notice-missing',component:component.name});component.sourceDirectory=normalized(path.relative(root,path.join(preferred,component.sourceDirectory)))}
  const mplNotice=path.join(root,'dependencies/preferred-source/mpl-pg-uuidv7/DISTRIBUTION_NOTICE.txt')
  if(existsSync(mplNotice)){const bytes=await readFile(mplNotice),target=path.join(outputRoot,'pglite-notices/pg_uuidv7/DISTRIBUTION_NOTICE.txt');await writeFile(target,bytes);components.find(c=>c.name==='pg_uuidv7').notices.push({sourcePath:normalized(path.relative(root,mplNotice)),path:normalized(path.relative(root,target)),sha256:hash(bytes),bytes:bytes.length})}
  const helperSource=path.join(preferred,'embedded/typescript-preferred-5.3.3/src/compiler/factory/emitHelpers.ts'),helperOutput=path.join(preferred,'embedded/async-mutex-0.4.1/index.mjs')
  let generatedHelper
  try{const source=await readFile(helperSource),emitted=await readFile(helperOutput);generatedHelper={...compareAwaiterHelper(source.toString(),emitted.toString()),preferredSource:{path:normalized(path.relative(root,helperSource)),sha256:hash(source)},emittedSource:{path:normalized(path.relative(root,helperOutput)),sha256:hash(emitted)}}}catch(error){issues.push({code:'pglite-awaiter-source-mismatch',error:error.message})}
  const buildRecipes=['upstream/packages/pglite/tsup.config.ts','upstream/pnpm-lock.yaml','postgres-pglite/build-with-docker.sh','postgres-pglite/pglite-wasm/build-pglite.sh','postgres-pglite/pglite-wasm/builder/Dockerfile'].filter(file=>existsSync(path.join(preferred,file)))
  const recipeRecords=await Promise.all(buildRecipes.map(async file=>({path:normalized(path.relative(root,path.join(preferred,file))),sha256:hash(await readFile(path.join(preferred,file)))})))
  return{package:meta.name,version:meta.version,wrapperDeclaredLicense:meta.license,wrapperUpstreamAlternative:'Pinned upstream also offers PostgreSQL terms; original Apache npm grant retained',postgresLicense:'PostgreSQL',sourceCommit:provenance?.commit,postgresCommit:postgres?.commit,payloads,embeddedFileSystem:embeddedFs,embeddedSourceMaps:embeddedJs,preferredSourceChecks:sourceChecks,generatedHelper,components,buildRecipes:recipeRecords,obligations:['Retain wrapper Apache terms plus PostgreSQL COPYRIGHT and all incorporated component notices; wrapper metadata does not cover the whole WASM/data/extension payload.','Include pinned TypeScript/PostgreSQL/extension/build-library/runtime preferred source and generation recipes; classify Emscripten runtime/library source separately from its general-purpose compiler.','All distributed extension tarballs are inventoried even though the relay currently creates no optional extension.','The pg_uuidv7 MPL-2.0 component uses the source/grant route recorded in docs/release/source-closure/PG_UUIDV7_ASSESSMENT.md.'],rebuildClaim:'Source/recipe correspondence is established by pinned gitlinks, build inputs, package attestation and source-map matches. No independent byte-identical PGlite native rebuild is claimed.',unresolved:[]}
}

export async function generateExpandedInventory(root,{output='docs/release/inventory',withBundles=true}={}){
  root=path.resolve(root);const outputRoot=path.resolve(root,output);await mkdir(outputRoot,{recursive:true})
  const issues=[],workspaces=await workspacePackages(root),lockBytes=await readFile(path.join(root,'yarn.lock')),lock=parseYarnLock(lockBytes.toString()),packages=await installedPackages(root,workspaces),preferredSources=await npmPreferredSources(root,issues)
  const lockSelectors=new Map(lock.flatMap(entry=>entry.selectors.map(selector=>[selector,entry])))
  const byActual=new Map([...packages.values()].map(item=>[path.resolve(item.actual),item]))
  async function connect(parent,name,range,role,kind){
    const folder=await resolvePackage(parent.directory,name)
    if(!folder){if(kind!=='optionalDependencies')issues.push({code:'installed-dependency-missing',parent:parent.meta.name,name,range});return}
    const actual=path.resolve(await realpath(folder)),child=byActual.get(actual)
    if(!child){issues.push({code:'installed-dependency-not-enumerated',parent:parent.meta.name,name});return}
    if(role)child.roles.add(role);child.parents.push({name:parent.meta.name,range,kind})
    const entry=lockSelectors.get(name+'@'+range)
    if(!child.workspace&&(!entry||entry.version!==child.meta.version))issues.push({code:'installed-lock-mismatch',parent:parent.meta.name,name,range,installed:child.meta.version,locked:entry?.version??null})
    parent.dependencies?.push({name,range,path:normalized(path.relative(root,child.directory)),kind})
  }
  for(const workspace of workspaces)for(const kind of ['dependencies','devDependencies','optionalDependencies'])for(const [name,range] of Object.entries(workspace.meta[kind]??{}))await connect(workspace,name,range,seedRole(workspace.meta.name,kind),kind)
  // Package devDependencies are not implicitly production dependencies. Actual inlined code is inspected separately.
  for(let pass=0;pass<packages.size;pass++){
    let changed=false
    for(const parent of packages.values())for(const kind of ['dependencies','optionalDependencies'])for(const [name,range] of Object.entries(parent.meta[kind]??{})){
      const folder=await resolvePackage(parent.directory,name);if(!folder){if(kind!=='optionalDependencies')issues.push({code:'transitive-dependency-missing',parent:parent.meta.name,name});continue}
      const child=byActual.get(path.resolve(await realpath(folder)));if(!child)continue
      for(const role of parent.roles)if(!child.roles.has(role)){child.roles.add(role);changed=true}
      if(pass===0)await connect(parent,name,range,[...parent.roles][0],kind)
    }
    if(!changed)break
  }
  const bundles=withBundles?await browserBundles(root,workspaces,packages,issues):[]
  const inventory=[]
  for(const [location,item] of packages){
    if(item.workspace)continue
    const ownFiles=await files(item.directory,{skipNodeModules:true}),noticeFiles=ownFiles.filter(file=>isNotice(normalized(path.relative(item.directory,file)))),notices=[]
    if(!noticeFiles.length)for(const file of ownFiles.filter(file=>/^readme(?:\.|$)/i.test(path.basename(file)))){const text=await readFile(file,'utf8');if(text.includes('Permission is hereby granted, free of charge')&&text.includes('THE SOFTWARE IS PROVIDED'))noticeFiles.push(file)}
    if(!noticeFiles.length&&item.meta.name.startsWith('@esbuild/')){const parent=[...packages.values()].find(entry=>entry.meta.name==='esbuild');if(parent)noticeFiles.push(...(await files(parent.directory,{skipNodeModules:true})).filter(file=>isNotice(path.relative(parent.directory,file))))}
    if(!noticeFiles.length&&item.meta.name.startsWith('@rollup/rollup-')){const parent=[...packages.values()].find(entry=>entry.meta.name==='rollup');if(parent)noticeFiles.push(...(await files(parent.directory,{skipNodeModules:true})).filter(file=>isNotice(path.relative(parent.directory,file))))}
    for(let i=0;i<noticeFiles.length;i++){
      const file=noticeFiles[i],bytes=await readFile(file),target=path.join(outputRoot,'npm-notices',item.meta.name.replaceAll('/','__')+'@'+item.meta.version,String(i)+'-'+path.basename(file));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes)
      notices.push({sourcePath:normalized(path.relative(root,file)),path:normalized(path.relative(root,target)),sha256:hash(bytes),bytes:bytes.length})
    }
    if(!item.meta.license&&!item.meta.licenses)issues.push({code:'package-license-missing',package:item.meta.name,version:item.meta.version})
    if(!notices.length)issues.push({code:'package-notice-missing',package:item.meta.name,version:item.meta.version})
    const records=lock.filter(entry=>entry.version===item.meta.version&&entry.selectors.some(selector=>selector.startsWith(item.meta.name+'@')))
    const native=[]
    for(const file of ownFiles.filter(file=>/\.(?:node|wasm|exe|dll|so|data)$/i.test(file))){const bytes=await readFile(file);native.push({path:normalized(path.relative(root,file)),bytes:bytes.length,sha256:hash(bytes),format:binaryFormat(bytes)})}
    const preferred=preferredSources.packages.find(record=>record.name===item.meta.name&&record.version===item.meta.version),upstream=preferredSources.upstream.filter(record=>record.packages.includes(item.meta.name))
    if(!preferred)issues.push({code:'npm-exact-package-source-missing',package:item.meta.name,version:item.meta.version})
    inventory.push({name:item.meta.name,version:item.meta.version,installedPath:location,license:item.meta.license??item.meta.licenses,repository:item.meta.repository??null,lockedSources:records.map(({selectors,resolved,integrity})=>({selectors,resolved,integrity})),roles:[...item.roles].sort(),parents:item.parents,dependencies:item.dependencies,notices,nativePayloads:native,preferredSource:preferred,preferredUpstream:upstream,obligations:licenseObligations(item.meta.license??item.meta.licenses),sourceTreatment:upstream.length?'Exact npm distribution plus matching upstream preferred source/build recipes retained; retain component grants.':item.meta.name==='@electric-sql/pglite'?'Exact npm distribution plus separately inventoried preferred C/TS/runtime/extension sources retained below.':item.roles.has('persistent-relay-runtime')||item.roles.has('HTTP-GraphQL-MCP-CLI-adapter-runtime')?'Exact npm source archive retained. Authored JS package source or included TS/source-map inputs are the editable runtime form; compiled packages are supplemented by upstream source.':'Exact npm archive/lock/notices retained for required general-purpose build/test tool or type metadata. This tool is not itself the covered messaging program; compiler-injected/browser runtime code is inventoried separately and its upstream source retained. No blanket tooling exclusion covers copied runtime helpers.'})
  }
  const pglite=await pgliteInventory(root,outputRoot,issues),assets=await captureAssets(root)
  const lockedNotInstalled=lock.filter(entry=>!inventory.some(item=>item.version===entry.version&&entry.selectors.some(selector=>selector.startsWith(item.name+'@')))).map(entry=>({...entry,disposition:'locked but not installed on the reviewed platform; not classified as a shipped payload by this inventory'}))
  const result={kind:'endtoend-expanded-rights-dependency-asset-inventory',generatedAt:new Date().toISOString(),yarnLockSha256:hash(lockBytes),platform:{os:process.platform,arch:process.arch,node:process.version},workspaces:workspaces.map(item=>({path:normalized(path.relative(root,item.directory))||'.',name:item.meta.name,license:item.meta.license,dependencies:item.meta.dependencies??{},devDependencies:item.meta.devDependencies??{}})),npm:{installedPackages:inventory.length,lockedEntries:lock.length,packages:inventory,lockedNotInstalled,preferredSources},browserBundles:bundles,pglite,assets,issues:[...new Map(issues.map(item=>[JSON.stringify(item),item])).values()],legalCertification:false,scope:'Broader messaging subsystem; candidate2 frozen artifacts are not altered or recertified.'}
  result.engineeringCoveragePassed=result.issues.length===0
  await writeFile(path.join(outputRoot,'EXPANDED_INVENTORY.json'),JSON.stringify(result,null,2)+'\n')
  await writeFile(path.join(outputRoot,'OBLIGATIONS.md'),renderObligations(result))
  return result
}
function renderObligations(data){return `# Expanded dependency and asset obligations\n\nExact lock: \`${data.yarnLockSha256}\`. Inventoried ${data.npm.installedPackages} installed npm packages and ${data.npm.lockedEntries} lock entries. Actual browser chunks and PGlite WASM/data/extension payloads are recorded in EXPANDED_INVENTORY.json. This is evidence for the expanded scope, not candidate2 acceptance.\n\n## Required treatment\n\n- Distinguish actual runtime/bundled libraries from external tools using each package's roles and module evidence. Build-only package metadata is insufficient for bundled runtime code.\n- Retain each package's captured original license/copyright/notice files, including parent-license mappings for platform tool packages. Do not replace third-party grants with first-party AGPL or MIT declarations.\n- Include preferred source for covered libraries and generated runtime code. The package lock identifies versions; it does not replace required source.\n- PGlite ${data.pglite.version}: preserve wrapper Apache terms, PostgreSQL COPYRIGHT, all embedded JS/native/runtime/extension notices and pinned source archives/build scripts under dependencies/preferred-source/pglite-${data.pglite.version}. Optional distributed extension archives still need provenance even when the relay does not load them.\n- First-party screenshots, inline icons and original documentation rely on the accepted October24 owner confirmation. Fonts use the recorded system stacks; external asset references, if any, require independent inspection. Legal texts and upstream trees remain third-party material.\n\n## Current machine findings\n\n${data.issues.length?data.issues.map(item=>'- '+JSON.stringify(item)).join('\n'):'No machine-detected metadata/notice/source-acquisition gaps.'}\n\nSource acquisition is not a claim of byte-identical PGlite rebuilding. Validate the captured source/build relationship and explain remaining generation or compatibility questions before the final release assessment.\n`}

/** Verify offered source evidence without npm, Vite, a private checkout or a network. */
export async function auditExpandedInventory(root,{output='docs/release/inventory'}={}){
  root=path.resolve(root)
  const data=await json(path.join(root,output,'EXPANDED_INVENTORY.json')),issues=[],records=new Map()
  const add=(relative,sha256)=>{if(!relative||!sha256)return;if(path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').includes('..')){issues.push({code:'unsafe-audit-path',path:relative});return}const existing=records.get(relative);if(existing&&existing!==sha256)issues.push({code:'conflicting-audit-digest',path:relative});records.set(relative,sha256)}
  for(const p of data.npm.packages){for(const n of p.notices)add(n.path,n.sha256);if(!p.preferredSource||!p.notices.length)issues.push({code:'incomplete-package',package:p.name})}
  for(const r of [...data.npm.preferredSources.packages,...data.npm.preferredSources.upstream]){add(r.archive,r.sha256);add(r.registryMetadata,r.registryMetadataSha256)}
  for(const r of data.pglite.preferredSourceChecks)add(r.path,r.sha256)
  for(const c of data.pglite.components)for(const n of c.notices)add(n.path,n.sha256)
  for(const r of data.pglite.buildRecipes)add(r.path,r.sha256)
  for(const r of data.pglite.embeddedSourceMaps)if(typeof r.preferredSource==='string')add(r.preferredSource,r.sha256)
  if(data.pglite.generatedHelper){const helper=data.pglite.generatedHelper;add(helper.preferredSource.path,helper.preferredSource.sha256);add(helper.emittedSource.path,helper.emittedSource.sha256);try{compareAwaiterHelper(await readFile(path.join(root,helper.preferredSource.path),'utf8'),await readFile(path.join(root,helper.emittedSource.path),'utf8'))}catch(error){issues.push({code:'pglite-awaiter-source-mismatch',error:error.message})}}
  // Private product assets are assessed by hashes only and deliberately excluded from the offered public source.
  add('yarn.lock',data.yarnLockSha256)
  for(const [relative,sha256] of records)await verifyRecord(root,{path:relative,sha256},issues)
  issues.push(...data.issues)
  return{kind:'expanded-inventory-offline-audit',passed:issues.length===0,filesChecked:records.size,installedNpm:data.npm.installedPackages,sourceArchives:data.npm.preferredSources.packages.length+data.npm.preferredSources.upstream.length,issues}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),root=args.includes('--root')?args[args.indexOf('--root')+1]:fileURLToPath(new URL('..',import.meta.url)),output=args.includes('--output')?args[args.indexOf('--output')+1]:'docs/release/inventory'
  if(args.includes('--audit')){const result=await auditExpandedInventory(root,{output});console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1}
  else{const result=await generateExpandedInventory(root,{output,withBundles:!args.includes('--no-bundles')});console.log(JSON.stringify({installedNpm:result.npm.installedPackages,lockedEntries:result.npm.lockedEntries,browserBundles:result.browserBundles.length,pglitePayloads:result.pglite.payloads.length,pgliteEmbeddedFs:result.pglite.embeddedFileSystem.length,assets:result.assets.assets.length,issues:result.issues.length,output}));if(args.includes('--check')&&result.issues.length)process.exitCode=1}
}
