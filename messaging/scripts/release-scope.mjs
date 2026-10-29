// SPDX-License-Identifier: AGPL-3.0-only
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs'
import {dirname,isAbsolute,join,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const defaultRoot=dirname(dirname(fileURLToPath(import.meta.url)))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const moduleRoles={
  '@e2ee/crypto':{role:'public-messaging',license:'AGPL-3.0-only'},
  '@e2ee/session':{role:'public-messaging',license:'AGPL-3.0-only'},
  '@e2ee/agent':{role:'public-messaging',license:'AGPL-3.0-only'},
  '@e2ee/agent-browser':{role:'public-messaging',license:'AGPL-3.0-only'},
  '@e2ee/api':{role:'public-messaging',license:'AGPL-3.0-only'},
  '@e2ee/contract':{role:'public-messaging',license:'AGPL-3.0-only'},
  '@e2ee/headless':{role:'public-messaging',license:'AGPL-3.0-only'},
  '@e2ee/protocol':{role:'public-interface',license:'MIT'},
  '@e2ee/client':{role:'public-interface',license:'MIT'},
  '@e2ee/web':{role:'project-consumer-pending-concrete-grant',license:'AGPL-3.0-only'},
}
const excludedPart=/^(?:node_modules|\.git|dist|target|pkg-node|pkg-web|\.build|coverage|test-results|data|vaults?|artifacts)$/i
const privateName=/^(?:\.env.*|env\.example|\.local-ports\.json|.*\.(?:db|sqlite|sqlite3|pem|key)|.*(?:credentials|device-secret).*)$/i
function entries(root,area){
  const folder=join(root,area)
  if(!existsSync(folder))throw new Error(`Missing scope input: ${area}`)
  return readdirSync(folder).sort().flatMap(name=>{
    if(excludedPart.test(name)||privateName.test(name))return[]
    const path=`${area}/${name}`,absolute=join(root,path),stat=lstatSync(absolute)
    if(stat.isSymbolicLink())throw new Error(`Scope input symlink refused: ${path}`)
    if(stat.isDirectory())return entries(root,path)
    if(!stat.isFile())throw new Error(`Unsupported scope input: ${path}`)
    return[{path,bytes:stat.size,sha256:hash(readFileSync(absolute))}]
  })
}
function fileEntry(root,path){
  const stat=lstatSync(join(root,path))
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`Expected regular scope file: ${path}`)
  return{path,bytes:stat.size,sha256:hash(readFileSync(join(root,path)))}
}
export function workspaceInputs(root){
  const source=['apps','packages'].flatMap(area=>entries(root,area))
  const rootFiles=['LICENSE','LICENSING.md','README.md','package.json','yarn.lock','docs/PROTOCOL.md','docs/THREAT-MODEL.md','docs/release/FEATURE_MATRIX.md','docs/release/BASELINE.json','docs/release/AGPL_MVP_TEN_STEP_PLAN.md'].map(path=>fileEntry(root,path))
  const runtimeScripts=['dev.mjs','local-ports.mjs','serve-endtoend.mjs','build-crypto.ps1'].map(name=>fileEntry(root,`scripts/${name}`))
  return[...source,...rootFiles,...runtimeScripts].sort((a,b)=>a.path.localeCompare(b.path))
}
export function moduleGraph(root){
  const workspaces=['apps','packages'].flatMap(area=>readdirSync(join(root,area)).sort().flatMap(name=>{
    const path=`${area}/${name}/package.json`
    if(!existsSync(join(root,path)))return[]
    const value=JSON.parse(readFileSync(join(root,path),'utf8')),scope=moduleRoles[value.name]
    if(!scope)throw new Error(`Workspace lacks a release scope decision: ${path}`)
    if(value.license!==scope.license)throw new Error(`Workspace license changed without scope assessment: ${path}`)
    return[{name:value.name,path:`${area}/${name}`,version:value.version,declaredLicense:value.license,...scope,runtimeDependencies:Object.keys(value.dependencies??{}).sort(),buildTestDependencies:Object.keys(value.devDependencies??{}).sort()}]
  }))
  const names=new Set(workspaces.map(value=>value.name))
  for(const name of Object.keys(moduleRoles))if(!names.has(name))throw new Error(`Scoped workspace missing: ${name}`)
  const edges=workspaces.flatMap(value=>[['runtime',value.runtimeDependencies],['build-test',value.buildTestDependencies]].flatMap(([kind,deps])=>deps.filter(name=>names.has(name)).map(name=>({from:value.name,to:name,kind}))))
  for(const edge of edges){
    const source=workspaces.find(value=>value.name===edge.from),target=workspaces.find(value=>value.name===edge.to)
    if(source.role.startsWith('public-')&&target.role==='project-consumer-pending-concrete-grant')throw new Error(`Public workspace requires private consumer: ${edge.from} -> ${edge.to}`)
    if(source.role==='public-interface'&&target.role==='public-messaging')throw new Error(`MIT interface imports implementation: ${edge.from} -> ${edge.to}`)
  }
  return{workspaces,edges}
}
export function featureMap(root){
  const source=readFileSync(join(root,'docs/release/FEATURE_MATRIX.md'),'utf8')
  const section=(start,end)=>source.slice(source.indexOf(start),end?source.indexOf(end):undefined).split(/\r?\n/).filter(line=>line.startsWith('| ')&&!/^\| (?:Operation|Area|---)/.test(line)).map(line=>line.split('|').slice(1,-1).map(value=>value.trim()))
  const operations=section('## The 21 existing headless operations','## Existing browser product behavior').map(([name,behavior])=>({name,behavior,owners:['packages/agent','packages/session','apps/api'],interfaces:['packages/protocol','packages/client','packages/headless'],verification:'Existing feature tests plus expanded release acceptance in step 7; this map is not a test result'}))
  if(operations.length!==21||new Set(operations.map(value=>value.name)).size!==21)throw new Error('Preservation scope must include all 21 unique existing operations')
  const browser=section('## Existing browser product behavior','## Security and release gates').map(([name,behavior])=>({name,behavior,presentationOwner:'apps/web (current consumer)',implementationOwners:name==='Guides/site'?['apps/web']:['packages/agent','packages/session','apps/api'],publicReferenceRequirement:name==='Guides/site'?'Product-specific content may remain with its existing consumer grant':'Expose applicable messaging behavior in the standalone public reference application in step 4'}))
  if(browser.length<15)throw new Error('Browser preservation rows unexpectedly missing')
  return{source:'docs/release/FEATURE_MATRIX.md',sourceSha256:hash(Buffer.from(source)),operations,browser,securityRequirements:source.slice(source.indexOf('## Security and release gates')),noFeatureRemovalAuthorized:true}
}
function protectedEntries(evidenceRoot){
  const original=['endtoend-agent-0.1.0.tar.gz','endtoend-agent-runtime-0.1.0.tar.gz','endtoend-client-0.1.0.tar.gz','RELEASE_INDEX.json','SOURCE_MANIFEST.json','RUNTIME_MANIFEST.json','CLIENT_MANIFEST.json']
  const corrected=readdirSync(join(evidenceRoot,'agent-0.1.0-candidate-2')).filter(name=>lstatSync(join(evidenceRoot,'agent-0.1.0-candidate-2',name)).isFile()).sort().map(name=>`agent-0.1.0-candidate-2/${name}`)
  return[...original,...corrected].map(path=>fileEntry(evidenceRoot,path))
}
export function verifyEntries(root,files){
  const issues=[]
  for(const item of files){
    const absolute=resolve(root,item.path),rel=relative(root,absolute)
    if(!rel||isAbsolute(rel)||rel.startsWith('..')||item.path.includes('\\')||item.path.split('/').some(part=>!part||part==='.'||part==='..')){issues.push(`Unsafe frozen path: ${item.path}`);continue}
    try{
      let current=root
      for(const part of item.path.split('/')){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw new Error('Symlinked frozen input')}
      const actual=fileEntry(root,item.path)
      if(actual.sha256!==item.sha256||actual.bytes!==item.bytes)issues.push(`Frozen input changed: ${item.path}`)
    }catch{issues.push(`Frozen input missing or unsafe: ${item.path}`)}
  }
  return issues
}
export function freezeScope(root,evidenceRoot){
  root=resolve(root);evidenceRoot=resolve(evidenceRoot)
  const directory=join(root,'docs/release/scope')
  if(existsSync(join(directory,'WORKSPACE_BASELINE.json')))throw new Error('Scope already frozen; never overwrite the baseline. Record a new assessed checkpoint explicitly.')
  const graph=moduleGraph(root),features=featureMap(root),files=workspaceInputs(root),protectedFiles=protectedEntries(evidenceRoot)
  const original=JSON.parse(readFileSync(join(root,'docs/release/BASELINE.json'),'utf8'))
  const rights=JSON.parse(readFileSync(join(root,'docs/release/REVIEW_DECISIONS.json'),'utf8')).firstPartyConfirmation
  if(rights?.statement!=='Yes, I control the first-party rights')throw new Error('Accepted first-party authority record missing')
  mkdirSync(directory,{recursive:true})
  const put=(name,value)=>writeFileSync(join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'})
  put('RELEASE_SCOPE.json',{kind:'endtoend-expanded-messaging-scope',plannedReleaseVersion:'0.2.0',artifactStatus:'scope-and-source-preparation; no 0.2.0 runnable release built',scopeAuthorization:'Owner instructed implementation of steps 1–3 of the October 25 ten-step plan',originalCommit:original.originalCommit,firstPartyConfirmation:rights,publicSourceStrategy:'Versioned complete corresponding-source snapshot with preserved notices; private Git history is not required',sourcePolicy:'Generic messaging implementation is public AGPL; independent protocol/client MIT; specific consumer grants assessed in step 6',...graph,publicOperationalInputs:['scripts/dev.mjs','scripts/local-ports.mjs','scripts/serve-endtoend.mjs','scripts/build-crypto.ps1','locked dependencies','database schema/migrations','safe configuration templates','build/install/source-offer scripts'],plannedNewReferenceApplication:{role:'public-messaging',license:'AGPL-3.0-only',implementationStep:4,reason:'Usable standalone browser messaging reference; does not require publishing unrelated host business code'},supportedBaseline:{host:'Windows x64 local development/build; Node 22.13.0 and Yarn 1.22.22 recorded',browser:'ES2022 browser agent; Chromium acceptance previously recorded; expanded acceptance remains step 7',otherDeployments:'Not certified by this scope freeze; document and validate each supported environment in steps 4 and 7'},reuseModel:'Separate project deployments; one device/account and one active vault writer',notImplied:['federation','shared cross-project inbox','simultaneous same-account multi-application broker','Choice migration','new multi-device/history recovery'],excluded:['credentials and .env files','user databases/vaults/messages/keys','repository history','unrelated host project source','installed dependencies and generated product output as preferred source'],publicationAuthorized:false,existingGrantsUnchanged:true})
  put('FEATURE_SCOPE.json',{kind:'endtoend-expanded-feature-allocation',...features})
  put('WORKSPACE_BASELINE.json',{kind:'endtoend-expanded-source-scope-baseline',originalCommit:original.originalCommit,files,exclusions:'Installed/generated files and private operational data are skipped before reading; release-generated evidence/source supplements are inventoried separately',pointInTimeOnly:true})
  put('PROTECTED_ARTIFACTS.json',{kind:'endtoend-protected-prior-release-artifacts',files:protectedFiles,policy:'Original rejected candidate and corrected candidate 2 are immutable historical evidence'})
  return{passed:true,workspaces:graph.workspaces.length,edges:graph.edges.length,operations:features.operations.length,browserAreas:features.browser.length,frozenSourceFiles:files.length,protectedArtifacts:protectedFiles.length,plannedReleaseVersion:'0.2.0'}
}
export function checkScope(root,evidenceRoot){
  const directory=join(root,'docs/release/scope'),scope=JSON.parse(readFileSync(join(directory,'RELEASE_SCOPE.json'),'utf8')),baseline=JSON.parse(readFileSync(join(directory,'WORKSPACE_BASELINE.json'),'utf8')),protectedFiles=JSON.parse(readFileSync(join(directory,'PROTECTED_ARTIFACTS.json'),'utf8'))
  const issues=[...verifyEntries(root,baseline.files),...verifyEntries(evidenceRoot,protectedFiles.files)]
  const frozenPaths=new Set(baseline.files.map(file=>file.path))
  for(const file of workspaceInputs(root))if(!frozenPaths.has(file.path))issues.push(`Source added after scope freeze: ${file.path}`)
  const graph=moduleGraph(root),features=featureMap(root)
  if(JSON.stringify(graph.workspaces)!==JSON.stringify(scope.workspaces)||JSON.stringify(graph.edges)!==JSON.stringify(scope.edges))issues.push('Module graph changed after scope freeze')
  const frozenFeatures=JSON.parse(readFileSync(join(directory,'FEATURE_SCOPE.json'),'utf8'))
  if(JSON.stringify(features.operations)!==JSON.stringify(frozenFeatures.operations)||JSON.stringify(features.browser)!==JSON.stringify(frozenFeatures.browser))issues.push('Feature map changed after freeze')
  if(scope.publicationAuthorized!==false)issues.push('Scope freeze cannot authorize publication')
  return{kind:'endtoend-expanded-scope-check',passed:issues.length===0,issues,workspaces:graph.workspaces.length,operations:features.operations.length,browserAreas:features.browser.length,frozenSourceFiles:baseline.files.length,protectedArtifacts:protectedFiles.files.length}
}
export function writeRightsLedger(root){
  const directory=join(root,'docs/release/scope'),scope=JSON.parse(readFileSync(join(directory,'RELEASE_SCOPE.json'),'utf8')),baseline=JSON.parse(readFileSync(join(directory,'WORKSPACE_BASELINE.json'),'utf8')),original=JSON.parse(readFileSync(join(root,'docs/release/BASELINE.json'),'utf8'))
  const originals=new Map(original.originalTrackedFiles.map(file=>[file.path,file]))
  const files=baseline.files.map(file=>{
    const workspace=scope.workspaces.find(value=>file.path.startsWith(`${value.path}/`))
    const legal=/(?:^|\/)(?:LICENSE(?:[.\-_]|$)|COPYING(?:[.\-_]|$)|THIRD_PARTY_NOTICES(?:[.\-_]|$))/.test(file.path)
    const asset=/\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf|mp[34]|webm|ogg)$/i.test(file.path)
    const generated=file.path==='yarn.lock'||file.path==='docs/release/BASELINE.json'
    const kind=legal?'third-party-license-or-notice-text':asset?'asset-provenance-in-expanded-inventory':generated?'generated-dependency-or-provenance-metadata':'first-party-application-or-release-input'
    const prior=originals.get(file.path)
    return{...file,kind,firstPartyOwnershipAsserted:kind==='first-party-application-or-release-input',ownershipBasis:kind==='first-party-application-or-release-input'?scope.firstPartyConfirmation:null,provenance:prior?(prior.sha256===file.sha256?'original-baseline-unchanged':'modified-from-original-baseline'):'added-during-extraction',originalBaselineSha256:prior?.sha256??null,currentDeclaredLicense:legal?'Preserved original legal text; no first-party grant asserted':asset?'See docs/release/inventory asset provenance and notices':generated?'Dependency grants remain separate from generated metadata':workspace?.declaredLicense??'AGPL-3.0-only first-party release input',plannedRole:workspace?.role??'build-or-release-input',consumerGrantChanged:false}
  })
  const result={kind:'endtoend-expanded-source-rights-ledger',firstPartyAuthorityAccepted:true,firstPartyConfirmation:scope.firstPartyConfirmation,baselineSha256:hash(readFileSync(join(directory,'WORKSPACE_BASELINE.json'))),files,legalCertification:false,thirdPartyOwnershipClaimed:false,publicationAuthorized:false}
  writeFileSync(join(directory,'FIRST_PARTY_RIGHTS.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'})
  return{passed:true,files:files.length,firstPartyInputs:files.filter(file=>file.firstPartyOwnershipAsserted).length,excludedFromFirstPartyAssertion:files.filter(file=>!file.firstPartyOwnershipAsserted).length}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1]
  if(!args.includes('--evidence-root'))throw new Error('Provide --evidence-root for the immutable prior release artifacts')
  const root=args.includes('--root')?resolve(value('--root')):defaultRoot,evidenceRoot=resolve(value('--evidence-root'))
  const result=args.includes('--freeze')?freezeScope(root,evidenceRoot):args.includes('--write-rights')?writeRightsLedger(root):checkScope(root,evidenceRoot)
  console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1
}
