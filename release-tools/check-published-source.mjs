// SPDX-License-Identifier: AGPL-3.0-only
// Modified October 31, 2026: explicitly pinned 0.2.1 core release verification.
// Verify a clean published source snapshot against its separately approved catalog.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const requireThat=(condition,message)=>{if(!condition)throw new Error(message)}
const identities=['filename','bytes','sha256','manifestFilename','manifestSha256']
const grants={'messaging-core':'AGPL-3.0-only','endtoend-web':'AGPL-3.0-only','desk-client':'MIT','mit-sdk':'MIT'}
const limits={catalog:1024*1024,manifest:16*1024*1024,file:512*1024*1024,files:100000,total:2*1024*1024*1024}

function relativeName(value){
  requireThat(typeof value==='string'&&value.length>0&&value.length<=2048&&!path.isAbsolute(value)&&!/[\\:\x00-\x1f\x7f]/.test(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..'),'Unsafe source path: '+value)
  return value
}
function basename(value){relativeName(value);requireThat(!value.includes('/'),'Expected an artifact basename: '+value);return value}
function record(value){requireThat(value&&digest(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0,'Invalid catalog file identity');basename(value.filename);return value}
function sameTuple(left,right,label){requireThat(left&&right&&identities.every(key=>left[key]===right[key]),label+' identities differ')}
function within(root,filename){const relative=path.relative(root,filename);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)}

// Only unlisted, known installation/build outputs are omitted. Listed SDK ESM still gets checked.
function generated(name){
  return name.split('/').includes('node_modules')
    || /^(?:\.build|coverage|test-results)(?:\/|$)/.test(name)
    || /^packages\/crypto\/(?:target|pkg-node|pkg-web)(?:\/|$)/.test(name)
    || /^packages\/(?:client|protocol)\/dist(?:\/|$)/.test(name)
    || /^apps\/(?:agent-browser|messaging-reference|web)\/dist(?:\/|$)/.test(name)
}

// Stop taking work on failure, then finish all in-flight reads before returning to callers.
async function boundedParallel(values,operation){
  let cursor=0,failure
  async function worker(){
    while(!failure){
      const index=cursor++
      if(index>=values.length)return
      try{await operation(values[index])}catch(error){failure??=error}
    }
  }
  await Promise.all(Array.from({length:Math.min(32,values.length)},worker))
  if(failure)throw failure
}

/** No network calls, builds, extraction, Git operations or filesystem mutations occur here. */
export async function checkPublishedSource({root,catalog,expectedCatalogSha256,expectedReleaseVersion='0.2.0'}={}){
  const result={kind:'endtoend-published-source-integrity',passed:false,expectedCatalogSha256,catalogSha256:null,sourceTrees:[],runtimeManifests:[],issues:[]}
  try{
    requireThat(typeof root==='string'&&root.length>0&&typeof catalog==='string'&&catalog.length>0,'Supply root and catalog paths')
    requireThat(digest(expectedCatalogSha256),'An independently pinned expected catalog SHA-256 is required')
    requireThat(['0.2.0','0.2.1'].includes(expectedReleaseVersion),'Unsupported explicitly selected release')
    const directory=path.resolve(root),catalogFile=path.resolve(catalog)
    requireThat(within(directory,catalogFile),'Catalog must be inside the published repository')
    const inspected=new Map()
    async function inspect(filename){
      const absolute=path.resolve(filename),parsed=path.parse(absolute)
      let current=parsed.root
      for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
        current=path.join(current,part)
        // Cache the in-flight promise too: sibling workers must not restat every ancestor.
        if(!inspected.has(current))inspected.set(current,fs.lstat(current))
        const stat=await inspected.get(current)
        requireThat(!stat.isSymbolicLink(),'Symlink in published source path: '+current)
      }
      return await inspected.get(absolute)
    }
    requireThat((await inspect(directory)).isDirectory(),'Published root must be a directory')
    async function bytes(filename,maximum){
      const stat=await inspect(filename)
      requireThat(stat.isFile()&&stat.size<=maximum,'Expected bounded regular file: '+filename)
      const value=await fs.readFile(filename)
      requireThat(value.length===stat.size,'File changed while reading: '+filename)
      return value
    }
    const catalogBytes=await bytes(catalogFile,limits.catalog)
    result.catalogSha256=hash(catalogBytes)
    requireThat(result.catalogSha256===expectedCatalogSha256,'Catalog differs from the independently approved hash')
    const descriptor=JSON.parse(catalogBytes.toString('utf8'))
    requireThat(descriptor.schemaVersion===1&&descriptor.version===expectedReleaseVersion,'Unsupported catalog schema/release')
    requireThat(Array.isArray(descriptor.components)&&descriptor.components.length===4,'Exactly four released components are required')
    const components=new Map(),offered=new Map()
    for(const component of descriptor.components){
      requireThat(component&&Object.hasOwn(grants,component.id)&&!components.has(component.id),'Unknown or duplicate component')
      requireThat(component.license===grants[component.id]&&component.version===(component.id==='messaging-core'?expectedReleaseVersion:component.id==='mit-sdk'?'0.2.1':'0.2.0'),'Component grant/version differs: '+component.id)
      record(component.source);basename(component.source.manifestFilename);requireThat(digest(component.source.manifestSha256),'Invalid source manifest hash')
      requireThat(Array.isArray(component.artifacts)&&component.artifacts.length>0&&Array.isArray(component.notices)&&component.notices.length>0,'Artifacts and license notices are required: '+component.id)
      for(const row of [component.source,...component.artifacts,...component.notices]){
        record(row)
        const prior=offered.get(row.filename)
        requireThat(!prior||prior.bytes===row.bytes&&prior.sha256===row.sha256,'Conflicting shared catalog file: '+row.filename)
        offered.set(row.filename,row)
      }
      components.set(component.id,component)
    }
    sameTuple(components.get('desk-client').source,components.get('endtoend-web').source,'Shared consumer source')
    const trees=[['messaging',['messaging-core'],'SOURCE_MANIFEST.json'],['consumers',['endtoend-web','desk-client'],'CONSUMER_SOURCE_MANIFEST.json'],['sdk',['mit-sdk'],'SDK_MANIFEST.json']]
    let totalBytes=0
    for(const [folder,ids,manifestFilename] of trees){
      const component=components.get(ids[0]),sourceRoot=path.join(directory,folder)
      requireThat(component.source.manifestFilename===manifestFilename,'Unexpected source manifest: '+component.id)
      requireThat((await inspect(sourceRoot)).isDirectory(),'Missing component source directory: '+folder)
      const manifestBytes=await bytes(path.join(sourceRoot,manifestFilename),limits.manifest)
      requireThat(hash(manifestBytes)===component.source.manifestSha256,'Source manifest hash mismatch: '+folder)
      const manifest=JSON.parse(manifestBytes.toString('utf8'))
      requireThat(component.id==='mit-sdk'?manifest.sdkVersion==='0.2.1'&&manifest.license==='MIT':manifest.version===component.version,'Source manifest version/grant differs: '+folder)
      requireThat(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=limits.files,'Missing bounded source inventory: '+folder)
      const seen=new Set()
      for(const row of manifest.files){
        relativeName(row.path)
        requireThat(row.path!==manifestFilename&&!seen.has(row.path)&&digest(row.sha256)&&Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=limits.file,'Invalid or duplicate source record: '+row.path)
        seen.add(row.path)
        requireThat((totalBytes+=row.bytes)<=limits.total,'Source inventory total exceeds the limit')
      }
      await boundedParallel(manifest.files,async row=>{
        const value=await bytes(path.join(sourceRoot,row.path),limits.file)
        requireThat(value.length===row.bytes&&hash(value)===row.sha256,'Source file differs: '+folder+'/'+row.path)
      })
      // Scan directories a level at a time with the same global bound, rather than
      // multiplying parallel recursive walkers or serializing thousands of directory reads.
      let directories=['']
      while(directories.length){
        const next=[]
        await boundedParallel(directories,async prefix=>{
          for(const name of await fs.readdir(path.join(sourceRoot,prefix))){
            const relative=prefix?prefix+'/'+name:name
            relativeName(relative)
            if(relative===manifestFilename||generated(relative))continue
            const stat=await inspect(path.join(sourceRoot,relative))
            if(stat.isDirectory())next.push(relative)
            else requireThat(stat.isFile()&&seen.has(relative),'Unlisted source file: '+folder+'/'+relative)
          }
        })
        directories=next
      }
      result.sourceTrees.push({directory:folder,components:ids,manifestSha256:hash(manifestBytes),filesChecked:seen.size})
    }
    const runtimePairs=[]
    for(const [id,filename] of [['messaging-core','RUNTIME_MANIFEST.json'],['endtoend-web','CONSUMER_RUNTIME_MANIFEST.json'],['desk-client','CONSUMER_RUNTIME_MANIFEST.json']]){
      const component=components.get(id),row=component.artifacts.find(item=>item.filename===filename)
      requireThat(row,'Runtime manifest is missing: '+id)
      const value=await bytes(path.join(path.dirname(catalogFile),filename),limits.manifest)
      requireThat(value.length===row.bytes&&hash(value)===row.sha256,'Runtime manifest hash mismatch: '+id)
      const manifest=JSON.parse(value.toString('utf8'))
      requireThat(manifest.version===component.version&&manifest.matchingSourceSha256===component.source.sha256&&manifest.matchingSourceManifestSha256===component.source.manifestSha256,'Runtime/source binding differs: '+id)
      const runtime=component.artifacts.filter(item=>item.filename!==filename)
      requireThat(runtime.length===1,'Exactly one runtime archive is required: '+id)
      runtimePairs.push([id,{...runtime[0],manifestFilename:filename,manifestSha256:row.sha256}])
      if(!result.runtimeManifests.some(item=>item.filename===filename))result.runtimeManifests.push({filename,sha256:row.sha256})
    }
    const runtimes=new Map(runtimePairs)
    sameTuple(runtimes.get('endtoend-web'),runtimes.get('desk-client'),'Shared consumer runtime')
    const sdk=components.get('mit-sdk')
    requireThat(sdk.artifacts.length===1&&sdk.artifacts[0].filename===sdk.source.filename&&sdk.artifacts[0].bytes===sdk.source.bytes&&sdk.artifacts[0].sha256===sdk.source.sha256,'SDK source/ESM artifact differs')
    result.passed=true
  }catch(error){result.issues.push(error.message)}
  return result
}

export async function main(args=process.argv.slice(2)){
  const flags={},allowed=new Set(['--root','--catalog','--expected-catalog-sha256','--expected-release-version'])
  for(let index=0;index<args.length;index+=2){
    const flag=args[index]
    requireThat(allowed.has(flag)&&!Object.hasOwn(flags,flag)&&args[index+1]&&!args[index+1].startsWith('--'),'Supply unique --root, --catalog and --expected-catalog-sha256 values')
    flags[flag]=args[index+1]
  }
  const result=await checkPublishedSource({root:flags['--root'],catalog:flags['--catalog'],expectedCatalogSha256:flags['--expected-catalog-sha256'],expectedReleaseVersion:flags['--expected-release-version']})
  console.log(JSON.stringify(result,null,2))
  if(!result.passed)process.exitCode=1
  return result
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{await main()}catch(error){console.log(JSON.stringify({kind:'endtoend-published-source-integrity',passed:false,issues:[error.message]},null,2));process.exitCode=1}
}
