// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {verifySdk,verifyLockDerivation,safeSdkPath} from './package-sdk.mjs'
import {prepareConsumerSource,verifyConsumerSource,writeConsumerArchive} from './package-consumer-source.mjs'
import {installConsumerNotices} from './rebuild-sdk-consumers.mjs'

const repository=fileURLToPath(new URL('..',import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=file=>JSON.parse(fs.readFileSync(file,'utf8')),write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value)}
function tree(root,prefix=''){
  return fs.readdirSync(path.join(root,prefix)).sort().flatMap(name=>{
    assert(!['.env','.git','node_modules','dist'].includes(name)&&!name.startsWith('.env.'),'Unexpected consumer source input')
    const relative=prefix?prefix+'/'+name:name,info=fs.lstatSync(path.join(root,relative));assert(!info.isSymbolicLink(),'Consumer input symlink refused')
    return info.isDirectory()?tree(root,relative):[{path:relative,bytes:info.size,sha256:sha(fs.readFileSync(path.join(root,relative)))}]
  })
}
function run(command,args,cwd,log){
  const result=spawnSync(command,args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024})
  write(log,`$ ${path.basename(command)} ${args.join(' ')}\n${result.stdout??''}${result.stderr??''}`)
  assert(!result.error&&result.status===0,`${path.basename(log)} failed: ${result.error?.message??result.stdout?.slice(-1000)} ${result.stderr?.slice(-2000)}`)
  return result.stdout
}
/** A fresh consumer-only workspace: its own source, the exact published SDK, and declared tools.
 * No agent/session/crypto/relay/headless implementation or prebuilt application is copied.
 */
export async function buildSdkConsumers({root=repository,archive,receipt,output,yarnCli,closureSource}){
  output=path.resolve(output);root=path.resolve(root)
  assert(!fs.existsSync(output),'Select a new consumer evidence directory')
  const relative=path.relative(root,output);assert(relative&&(path.isAbsolute(relative)||relative.startsWith('..'+path.sep)),'Build outside the source checkout')
  const identity=json(receipt).archive;assert.equal(sha(fs.readFileSync(archive)),identity.sha256)
  const workspace=path.join(output,'workspace');fs.mkdirSync(workspace,{recursive:true})
  const members=run('tar',['-tzf',archive],output,path.join(output,'sdk-members.log')).trim().split(/\r?\n/).map(name=>name.replace(/^\.\//,''))
  members.forEach(safeSdkPath);assert.equal(new Set(members).size,members.length)
  run('tar',['-xzf',archive,'-C',workspace],output,path.join(output,'sdk-extract.log'))
  const manifest=json(path.join(workspace,'SDK_MANIFEST.json'));assert.equal(sha(fs.readFileSync(path.join(workspace,'SDK_MANIFEST.json'))),identity.manifestSha256)
  const sdkProof=verifySdk(workspace,manifest)
  const inputFiles=[]
  const copy=(name)=>{const source=path.join(root,name);for(const record of fs.statSync(source).isDirectory()?tree(source):[{path:'',bytes:fs.statSync(source).size,sha256:sha(fs.readFileSync(source))}]){
    const target=name+(record.path?'/'+record.path:'');write(path.join(workspace,target),fs.readFileSync(path.join(source,record.path)));inputFiles.push({path:target,bytes:record.bytes,sha256:record.sha256})
  }}
  for(const name of ['SDK_MANIFEST.json','SDK_PROVENANCE.json','README.md']){
    write(path.join(workspace,'provenance/sdk',name),fs.readFileSync(path.join(workspace,name)));fs.unlinkSync(path.join(workspace,name))
  }
  write(path.join(workspace,'provenance/sdk/PACKAGE_RECEIPT.json'),fs.readFileSync(receipt))
  for(const name of ['apps/web/src','apps/web/public','apps/web/test','apps/web/BOUNDARY.md','apps/web/package.json','apps/web/index.html','apps/web/vite.config.ts','apps/web/tsconfig.json','apps/desk-client','docs/PROTOCOL.md','LICENSE',
    'scripts/build-sdk-consumers.mjs','scripts/package-consumer-source.mjs','scripts/package-consumer-source.test.mjs','scripts/rebuild-sdk-consumers.mjs','scripts/run-sdk-consumer.mjs','scripts/serve-sdk-consumer.mjs','scripts/source-disclosure.mjs'])copy(name)
  write(path.join(workspace,'package.json'),JSON.stringify({name:'endtoend-independent-consumers',version:'0.2.0',private:true,type:'module',packageManager:'yarn@1.22.22',workspaces:['apps/web','apps/desk-client','packages/client','packages/protocol'],scripts:{build:'node scripts/rebuild-sdk-consumers.mjs'}},null,2)+'\n')
  const originalLock=fs.readFileSync(path.join(root,'yarn.lock'),'utf8');write(path.join(workspace,'yarn.lock'),originalLock)
  const yarn=(args,label)=>run(process.execPath,[yarnCli,...args],workspace,path.join(output,label+'.log'))
  assert.equal(yarn(['--version'],'yarn-version').trim(),'1.22.22')
  yarn(['install','--production=false','--ignore-scripts','--non-interactive','--no-progress','--offline'],'install')
  const lock=fs.readFileSync(path.join(workspace,'yarn.lock'),'utf8'),lockProof=verifyLockDerivation(originalLock,lock),lockHash=sha(Buffer.from(lock))
  yarn(['install','--frozen-lockfile','--production=false','--ignore-scripts','--non-interactive','--no-progress','--offline'],'install-frozen')
  assert.equal(sha(fs.readFileSync(path.join(workspace,'yarn.lock'))),lockHash)
  installConsumerNotices(workspace,{web:false})
  const source=prepareConsumerSource({workspace,output,closureSource,version:'0.2.0',sdkIdentity:{...identity,version:'0.2.1'}})
  yarn(['workspace','@e2ee/web','run','check'],'web-typecheck')
  yarn(['workspace','@e2ee/web','test'],'web-tests')
  yarn(['workspace','@e2ee/desk-client','run','check'],'desk-syntax')
  // Resolve build tools inside the fresh consumer workspace, not the source checkout.
  const {build}=await import(pathToFileURL(path.join(workspace,'node_modules/vite/dist/node/index.js')))
  const modules=[]
  const portable=id=>id.replaceAll('\\','/').replace(workspace.replaceAll('\\','/'),'[consumer-workspace]')
  await build({root:path.join(workspace,'apps/web'),configFile:path.join(workspace,'apps/web/vite.config.ts'),plugins:[{
    name:'consumer-boundary-record',generateBundle(){for(const id of this.getModuleIds()){
      const info=this.getModuleInfo(id);if(!info?.isIncluded)continue
      const physical=id.replace(/^\0/,'').split('?')[0]
      if(path.isAbsolute(physical))assert(physical.startsWith(workspace+path.sep)||physical.replaceAll('\\','/').startsWith(workspace.replaceAll('\\','/')+'/'),`External runtime input: ${id}`)
      assert(!/[\\/]packages[\\/](crypto|session|agent|headless|contract)[\\/]|[\\/]apps[\\/](api|agent-browser|messaging-reference)[\\/]/.test(id),`Protected implementation bundled: ${id}`)
      modules.push({id:portable(id),imports:info.importedIds.map(portable),dynamicImports:info.dynamicallyImportedIds.map(portable)})
    }}
  }]})
  assert(modules.some(item=>item.id.includes('packages/client/dist/index.js')),'Built SDK was not consumed')
  assert(!modules.some(item=>/packages\/(client|protocol)\/src\//.test(item.id)),'Consumer reached into SDK source')
  const webDist=path.join(workspace,'apps/web/dist')
  installConsumerNotices(workspace)
  const {default:ts}=await import(pathToFileURL(path.join(workspace,'node_modules/typescript/lib/typescript.js')))
  const outputs=fs.readdirSync(path.join(webDist,'assets')).sort().map(name=>{
    const bytes=fs.readFileSync(path.join(webDist,'assets',name));assert(!name.endsWith('.wasm'),'Consumer bundles WASM')
    if(name.endsWith('.js')){
      // The /how page embeds protocol documentation describing AES. Scan executable identifiers,
      // not prose strings; the complete bundler graph above is the primary implementation check.
      const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,bytes.toString())
      for(let token=scanner.scan();token!==ts.SyntaxKind.EndOfFileToken;token=scanner.scan())if(token===ts.SyntaxKind.Identifier)assert(!['e2ee_crypto','libsignal_protocol','currentDataKey','openSealedVault'].includes(scanner.getTokenText()),'Protected implementation identifier in consumer output')
    }
    return{path:'apps/web/dist/assets/'+name,bytes:bytes.length,sha256:sha(bytes)}
  })
  // Rebuild from the offered source, with no original checkout or prebuilt frontend present.
  run(process.execPath,[yarnCli,'install','--frozen-lockfile','--production=false','--ignore-scripts','--non-interactive','--no-progress','--offline'],source.extraction,path.join(output,'extract-install.log'))
  assert.equal(sha(fs.readFileSync(path.join(source.extraction,'yarn.lock'))),lockHash)
  run(process.execPath,['scripts/rebuild-sdk-consumers.mjs'],source.extraction,path.join(output,'extract-rebuild.log'))
  const runtimePaths=['apps/web/dist','apps/desk-client/index.html','apps/desk-client/desk.js','apps/desk-client/desk.css','apps/desk-client/LICENSE','apps/desk-client/THIRD_PARTY_NOTICES.txt','apps/desk-client/package.json','apps/web/package.json',
    'packages/client/dist','packages/client/package.json','packages/client/LICENSE','packages/protocol/dist','packages/protocol/package.json','packages/protocol/LICENSE',
    'scripts/run-sdk-consumer.mjs','scripts/serve-sdk-consumer.mjs','scripts/source-disclosure.mjs','package.json','yarn.lock','LICENSE','README.md','MODIFICATIONS.md']
  const runtimeFiles=[]
  const visit=(relative)=>{const info=fs.lstatSync(path.join(workspace,relative));assert(!info.isSymbolicLink());if(info.isDirectory())for(const name of fs.readdirSync(path.join(workspace,relative)).sort())visit(relative+'/'+name);else runtimeFiles.push({path:relative,bytes:info.size,sha256:sha(fs.readFileSync(path.join(workspace,relative)))})}
  for(const relative of runtimePaths)visit(relative)
  for(const item of runtimeFiles)assert.equal(sha(fs.readFileSync(path.join(source.extraction,item.path))),item.sha256,`Fresh offered source did not reproduce ${item.path}`)
  const sourceAfterRebuild=verifyConsumerSource(source.extraction,source.manifest)
  const runtimeManifest={kind:'endtoend-browser-consumers-runtime',version:'0.2.0',matchingSourceSha256:source.archive.sha256,matchingSourceManifestSha256:source.archive.manifestSha256,files:runtimeFiles.sort((a,b)=>a.path.localeCompare(b.path))}
  write(path.join(workspace,'CONSUMER_RUNTIME_MANIFEST.json'),JSON.stringify(runtimeManifest,null,2)+'\n')
  write(path.join(output,'CONSUMER_RUNTIME_MANIFEST.json'),fs.readFileSync(path.join(workspace,'CONSUMER_RUNTIME_MANIFEST.json')))
  const runtime=writeConsumerArchive({root:workspace,output,filename:'endtoend-browser-consumers-0.2.0-runtime.tar.gz',files:[...runtimeFiles,{path:'CONSUMER_RUNTIME_MANIFEST.json'}]})
  runtime.manifestFilename='CONSUMER_RUNTIME_MANIFEST.json';runtime.manifestSha256=sha(fs.readFileSync(path.join(output,runtime.manifestFilename)))
  const components=[{id:'endtoend-web',version:'0.2.0',license:'AGPL-3.0-only',licenseFilename:'WEB_LICENSE.txt',noticesFilename:'WEB_NOTICES.txt'},{id:'desk-client',version:'0.2.0',license:'MIT',licenseFilename:'DESK_LICENSE.txt',noticesFilename:'DESK_NOTICES.txt'}]
  for(const [target,relative] of [['WEB_LICENSE.txt','LICENSE'],['WEB_NOTICES.txt','apps/web/dist/THIRD_PARTY_NOTICES.txt'],['DESK_LICENSE.txt','apps/desk-client/LICENSE'],['DESK_NOTICES.txt','apps/desk-client/THIRD_PARTY_NOTICES.txt']])write(path.join(output,target),fs.readFileSync(path.join(workspace,relative)))
  const releaseIndex={version:'0.2.0',source:source.archive,runtimeArtifacts:[runtime],components,published:false}
  write(path.join(output,'CONSUMER_RELEASE_INDEX.json'),JSON.stringify(releaseIndex,null,2)+'\n')
  const result={kind:'independent-sdk-consumer-build',passed:true,executedAt:new Date().toISOString(),sdkArchiveSha256:identity.sha256,sdkManifestSha256:identity.manifestSha256,sdkProof,sourceFiles:inputFiles,lockProof,lockSha256:lockHash,modules:modules.sort((a,b)=>a.id.localeCompare(b.id)),outputs,workspace,sourceArchive:source.archive,sourcePreparation:source.verification,sourceAfterIndependentRebuild:sourceAfterRebuild,sourceExtraction:source.extraction,preferredDependencySource:source.dependencies,runtime,protectedSiblingSourcePresent:false,prebuiltApplicationUsed:false,installedToolsIncludedInArtifacts:false}
  write(path.join(output,'CONSUMER_BUILD_RECEIPT.json'),JSON.stringify(result,null,2)+'\n');return result
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const flags={};for(let i=2;i<process.argv.length;i+=2){assert(process.argv[i].startsWith('--')&&process.argv[i+1]);flags[process.argv[i].slice(2)]=process.argv[i+1]}
  const result=await buildSdkConsumers({root:flags.root,archive:flags.archive,receipt:flags.receipt,output:flags.output,yarnCli:flags['yarn-cli'],closureSource:flags['closure-source']});console.log(JSON.stringify({passed:true,workspace:result.workspace,modules:result.modules.length,source:result.sourceArchive,runtime:result.runtime,receipt:path.join(flags.output,'CONSUMER_BUILD_RECEIPT.json')}))
}
