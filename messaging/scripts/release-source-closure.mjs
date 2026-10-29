// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {cpSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs'
import {dirname,isAbsolute,join,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const defaultRoot=dirname(dirname(fileURLToPath(import.meta.url)))
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
export function closurePaths(root,prefix=''){
  return readdirSync(join(root,prefix)).sort().flatMap(name=>{
    if(/[\r\n\0]/.test(name)||name==='.git'||(name==='node_modules'&&!prefix.startsWith('dependencies/preferred-source/')))throw new Error(`Unexpected closure payload: ${prefix}/${name}`)
    const path=prefix?`${prefix}/${name}`:name,absolute=join(root,path),stat=lstatSync(absolute)
    if(stat.isSymbolicLink())throw new Error(`Closure symlink refused: ${path}`)
    if(stat.isDirectory())return closurePaths(root,path)
    if(!stat.isFile())throw new Error(`Unsupported closure payload: ${path}`)
    return[path]
  })
}
export function closureFiles(root,prefix=''){return closurePaths(root,prefix).map(path=>{const file=join(root,path);return{path,bytes:lstatSync(file).size,sha256:digest(readFileSync(file))}})}
/** Complete archives are authoritative; selected inspection files let offline audits run without duplicating whole trees. */
export function preferredSourceSelection(root){
  const base='dependencies/preferred-source',selected=new Set()
  const add=path=>{
    if(typeof path!=='string'||!path.startsWith(base+'/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error(`Unsafe preferred-source selection: ${path}`)
    if(!lstatSync(join(root,path)).isFile())throw new Error(`Expected preferred-source file: ${path}`)
    selected.add(path)
  }
  for(const name of readdirSync(join(root,base)).sort()){
    const area=`${base}/${name}`
    if(!lstatSync(join(root,area)).isDirectory())add(area)
    else if(name==='npm'||name==='npm-upstream'){for(const item of readdirSync(join(root,area))){const file=`${area}/${item}`;if(lstatSync(join(root,file)).isFile())add(file)}}
    else if(!name.startsWith('pglite-'))for(const file of closurePaths(root,area))add(file)
    else{
      for(const item of readdirSync(join(root,area))){const file=`${area}/${item}`;if(lstatSync(join(root,file)).isFile())add(file)}
      const embedded=`${area}/embedded`
      for(const item of readdirSync(join(root,embedded))){const file=`${embedded}/${item}`;if(lstatSync(join(root,file)).isFile())add(file)}
      for(const file of closurePaths(root,`${area}/postgres-pglite/pglite/pg_uuidv7`))add(file)
    }
  }
  const inventory=JSON.parse(readFileSync(join(root,'docs/release/inventory/EXPANDED_INVENTORY.json'),'utf8'))
  for(const row of inventory.pglite.preferredSourceChecks)add(row.path)
  for(const component of inventory.pglite.components)for(const notice of component.notices)if(notice.sourcePath?.startsWith(base+'/'))add(notice.sourcePath)
  for(const row of inventory.pglite.buildRecipes)add(row.path)
  for(const row of inventory.pglite.embeddedSourceMaps)if(typeof row.preferredSource==='string')add(row.preferredSource)
  if(inventory.pglite.generatedHelper)for(const row of [inventory.pglite.generatedHelper.preferredSource,inventory.pglite.generatedHelper.emittedSource])add(row.path)
  return[...selected].sort()
}
export function verifyClosure(root,manifest){
  const issues=[],seen=new Set()
  for(const file of manifest.files??[]){
    if(typeof file.path!=='string'||isAbsolute(file.path)||file.path.includes('\\')||file.path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(file.path)){issues.push(`Unsafe or duplicate closure path: ${file.path}`);continue}
    seen.add(file.path)
    try{
      let current=root
      for(const part of file.path.split('/')){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw new Error('symlink')}
      const stat=lstatSync(current)
      if(!stat.isFile()||stat.size!==file.bytes||digest(readFileSync(current))!==file.sha256)issues.push(`Closure file changed: ${file.path}`)
    }catch{issues.push(`Closure file missing or unsafe: ${file.path}`)}
  }
  const actual=closurePaths(root).filter(path=>path!=='CLOSURE_MANIFEST.json')
  if(!seen.size)issues.push('Closure manifest is empty')
  for(const path of actual)if(!seen.has(path))issues.push(`Unmanifested closure file: ${path}`)
  return{passed:issues.length===0,filesChecked:seen.size,issues}
}
function run(command,args,cwd){
  const result=spawnSync(command,args,{cwd,windowsHide:true,encoding:'utf8',maxBuffer:32*1024*1024})
  if(result.error||result.status!==0)throw new Error(`${command} failed: ${result.error?.message??result.stderr}`)
  return result.stdout
}
export function packageClosure(root,output){
  root=resolve(root);output=resolve(output)
  if(existsSync(output))throw new Error('Use a new output directory; never overwrite source-closure evidence')
  const inputs=['LICENSE','LICENSING.md','yarn.lock','packages/crypto/Cargo.lock','packages/crypto/Cargo.toml','docs/release/AGPL_MVP_TEN_STEP_PLAN.md','docs/release/FEATURE_MATRIX.md','docs/release/scope','docs/release/source-closure','docs/release/inventory','dependencies/preferred-source']
  for(const path of inputs)if(!existsSync(join(root,path)))throw new Error(`Required closure input missing: ${path}`)
  for(const input of inputs){const rel=relative(resolve(root,input),output);if(!rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`)))throw new Error(`Closure output overlaps an input: ${input}`)}
  const helpers=readdirSync(join(root,'scripts')).filter(name=>/^release-(?:scope|source-closure|expanded-inventory|mpl|hacl)[\w.-]*\.mjs$/.test(name)||/^hacl-source-closure(?:\.test)?\.mjs$/.test(name)).map(name=>`scripts/${name}`)
  mkdirSync(output,{recursive:true})
  const stage=join(output,'source');mkdirSync(stage)
  const preferredFiles=preferredSourceSelection(root)
  for(const path of [...inputs.filter(path=>path!=='dependencies/preferred-source'),...helpers,...preferredFiles]){mkdirSync(dirname(join(stage,path)),{recursive:true});cpSync(join(root,path),join(stage,path),{recursive:true,dereference:false,errorOnExist:true})}
  writeFileSync(join(stage,'SOURCE_LAYOUT.json'),JSON.stringify({kind:'endtoend-source-closure-layout',authoritativePreferredSource:'Complete unmodified upstream source archives with original layouts/notices; individual inspection files are selected for offline validation and are not complete expanded upstream trees',selectedInspectionAndArchiveFiles:preferredFiles.length,originalSourceArchivesFiltered:false,duplicatedExpandedTreesOmitted:true},null,2)+'\n')
  writeFileSync(join(stage,'README.md'),'# EndToEnd 0.2.0 preparation: steps 1–3 source-closure supplement\n\nThis is the frozen scope, dependency/rights assessment and preferred-source supplement. It is not the complete runnable 0.2.0 release. Steps 4–10 still package the standalone product, evaluate concrete consumers and provide the final source offer. Prior candidate archives remain unchanged.\n\nCLOSURE_MANIFEST.json hashes every supplied input. Upstream source and notices retain their original terms. Assessments explain the exact source relationships and known limitations; engineering verification is not a legal opinion or publication authorization.\n')
  const manifest={kind:'endtoend-steps-1-3-preferred-source-closure',plannedReleaseVersion:'0.2.0',completeRunnableRelease:false,published:false,legalCertification:false,files:closureFiles(stage)}
  writeFileSync(join(stage,'CLOSURE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n')
  const verification=verifyClosure(stage,manifest)
  if(!verification.passed)throw new Error(JSON.stringify(verification))
  const list=[...manifest.files.map(file=>file.path),'CLOSURE_MANIFEST.json'].sort(),listPath=join(output,'archive-paths.txt')
  writeFileSync(listPath,list.join('\n')+'\n')
  const archive=join(output,'endtoend-messaging-0.2.0-source-closure.tar.gz')
  run('tar',['-czf',archive,'-C',stage,'-T',listPath],stage)
  const archived=run('tar',['-tzf',archive],stage).trim().split(/\r?\n/).sort()
  if(JSON.stringify(archived)!==JSON.stringify(list))throw new Error('Archive entries differ from the closure manifest')
  const extracted=join(output,'verified-extraction');mkdirSync(extracted)
  run('tar',['-xzf',archive,'-C',extracted],output)
  const extractedVerification=verifyClosure(extracted,JSON.parse(readFileSync(join(extracted,'CLOSURE_MANIFEST.json'),'utf8')))
  if(!extractedVerification.passed)throw new Error(JSON.stringify(extractedVerification))
  const result={kind:'endtoend-preferred-source-closure-package',passed:true,files:manifest.files.length,archive:relative(output,archive).replaceAll('\\','/'),archiveBytes:lstatSync(archive).size,archiveSha256:digest(readFileSync(archive)),manifestSha256:digest(readFileSync(join(stage,'CLOSURE_MANIFEST.json'))),extractedVerification,completeRunnableRelease:false,published:false}
  writeFileSync(join(output,'PACKAGE_RECEIPT.json'),JSON.stringify(result,null,2)+'\n')
  return result
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2)
  if(args[0]==='--verify'){const result=verifyClosure(resolve(args[1]),JSON.parse(readFileSync(join(resolve(args[1]),'CLOSURE_MANIFEST.json'),'utf8')));console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1}
  else{if(!args[0])throw new Error('Provide a new output directory');console.log(JSON.stringify(packageClosure(defaultRoot,args[0]),null,2))}
}
