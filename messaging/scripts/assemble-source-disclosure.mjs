// SPDX-License-Identifier: AGPL-3.0-only
// Assemble already built, immutable local artifacts. This command never publishes.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {loadSourceDisclosure} from './source-disclosure.mjs'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'))
const check=(condition,message)=>{if(!condition)throw Error(message)}
function basename(value){check(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)&&value!=='.'&&value!=='..','Plain artifact basename required');return value}
export async function assembleSourceDisclosure({messagingIndex,consumerIndex,sdkArchive,sdkReceipt,output}){
  output=path.resolve(output);check(!fs.existsSync(output),'Choose a new disclosure output; existing evidence is never overwritten')
  const core=json(messagingIndex),consumers=json(consumerIndex),sdk=json(sdkReceipt)
  check(core.completeStandaloneBuild===true&&consumers.source&&sdk.passed===true,'Completed immutable build identities required')
  fs.mkdirSync(output,{recursive:true})
  const supplied=new Map()
  function put(filename,bytes){
    basename(filename);const row={filename,bytes:bytes.length,sha256:hash(bytes)}
    if(supplied.has(filename)){check(supplied.get(filename).sha256===row.sha256,'Artifact filename collision');return row}
    fs.writeFileSync(path.join(output,filename),bytes);supplied.set(filename,row);return row
  }
  function copy(directory,record){
    const filename=basename(record.filename),file=path.join(directory,filename),info=fs.lstatSync(file)
    check(info.isFile()&&!info.isSymbolicLink(),'Artifact must be a regular file')
    const bytes=fs.readFileSync(file);check(bytes.length===record.bytes&&hash(bytes)===record.sha256,'Immutable artifact hash differs: '+filename)
    return put(filename,bytes)
  }
  function source(directory,record){
    const archive=copy(directory,record),name=basename(record.manifestFilename),bytes=fs.readFileSync(path.join(directory,name))
    check(hash(bytes)===record.manifestSha256,'Source manifest hash differs');put(name,bytes)
    return{...archive,manifestFilename:name,manifestSha256:record.manifestSha256}
  }
  const coreDir=path.dirname(path.resolve(messagingIndex)),consumerDir=path.dirname(path.resolve(consumerIndex))
  const coreSource=source(coreDir,core.source),consumerSource=source(consumerDir,consumers.source)
  function artifacts(directory,rows){return rows.flatMap(row=>{
    const artifact=copy(directory,row),name=basename(row.manifestFilename),bytes=fs.readFileSync(path.join(directory,name))
    check(hash(bytes)===row.manifestSha256,'Runtime manifest hash differs');return[artifact,put(name,bytes)]
  })}
  const coreArtifacts=artifacts(coreDir,core.runtimeArtifacts),consumerArtifacts=artifacts(consumerDir,consumers.runtimeArtifacts)
  const coreNotices=[
    put('MESSAGING_LICENSE.txt',fs.readFileSync(path.join(coreDir,'runtime/LICENSE'))),
    put('MESSAGING_NOTICES.txt',fs.readFileSync(path.join(coreDir,'runtime/apps/agent-browser/dist/THIRD_PARTY_NOTICES.txt'))),
    put('MESSAGING_MODIFICATIONS.txt',fs.readFileSync(path.join(coreDir,'runtime/docs/release/NOTICE.md'))),
  ]
  const components=[{id:'messaging-core',version:core.version,license:'AGPL-3.0-only',source:coreSource,artifacts:coreArtifacts,notices:coreNotices}]
  for(const item of consumers.components){
    check(['endtoend-web','desk-client'].includes(item.id),'Unknown independently built consumer')
    const notices=[item.licenseFilename,item.noticesFilename].map(name=>put(basename(name),fs.readFileSync(path.join(consumerDir,name))))
    components.push({id:item.id,version:item.version,license:item.license,source:consumerSource,artifacts:consumerArtifacts,notices})
  }
  const sdkDir=path.dirname(path.resolve(sdkArchive)),sdkIdentity={...sdk.archive,manifestFilename:'SDK_MANIFEST.json'}
  check(path.basename(sdkArchive)===sdkIdentity.filename,'SDK archive filename differs')
  const sdkSource=source(sdkDir,sdkIdentity)
  const sdkManifest=json(path.join(sdkDir,'SDK_MANIFEST.json'))
  const sdkLicenseRecord=sdkManifest.files.find(row=>row.path==='packages/client/LICENSE')
  // Both current first-party SDK grants use this exact MIT text; the immutable manifest records each.
  check(sdkLicenseRecord&&sdkManifest.files.some(row=>row.path==='packages/protocol/LICENSE'&&row.sha256===sdkLicenseRecord.sha256),'SDK grants need separate retained text if they differ')
  const license=fs.readFileSync(new URL('../packages/client/LICENSE',import.meta.url));check(hash(license)===sdkLicenseRecord.sha256,'SDK license bytes differ from frozen artifact')
  components.push({id:'mit-sdk',version:sdk.sdkVersion,license:'MIT',source:sdkSource,artifacts:[copy(sdkDir,sdk.archive)],notices:[put('SDK_LICENSE.txt',license)]})
  const disclosure={schemaVersion:1,version:core.version,components}
  fs.writeFileSync(path.join(output,'source-disclosure.json'),JSON.stringify(disclosure,null,2)+'\n')
  await loadSourceDisclosure(path.join(output,'source-disclosure.json'),{required:true})
  fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),[...supplied.values()].sort((a,b)=>a.filename.localeCompare(b.filename)).map(row=>row.sha256+'  '+row.filename).join('\n')+'\n')
  return{passed:true,output,disclosureSha256:hash(fs.readFileSync(path.join(output,'source-disclosure.json'))),components:components.map(item=>({id:item.id,version:item.version,sourceSha256:item.source.sha256})),files:supplied.size,published:false}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flags={};for(let i=2;i<process.argv.length;i+=2){check(process.argv[i]?.startsWith('--')&&process.argv[i+1],'Use named file/path arguments');flags[process.argv[i].slice(2)]=process.argv[i+1]}
  console.log(JSON.stringify(await assembleSourceDisclosure({messagingIndex:flags['messaging-index'],consumerIndex:flags['consumer-index'],sdkArchive:flags['sdk-archive'],sdkReceipt:flags['sdk-receipt'],output:flags.out}),null,2))
}
