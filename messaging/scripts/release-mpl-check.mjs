import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs'
import {dirname,isAbsolute,join,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function confined(root,path){
  assert.equal(typeof path,'string','Source path must be text')
  assert(!path.includes('\\')&&!path.split('/').some(part=>!part||part==='.'||part==='..'),'Unsafe portable source path: '+path)
  const file=resolve(root,path),rel=relative(root,file)
  assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Source path escapes its bundle: '+path)
  let cursor=root
  for(const part of path.split('/')){cursor=join(cursor,part);assert(!lstatSync(cursor).isSymbolicLink(),'Source symlink: '+path)}
  return file
}
function files(root,prefix=''){
  return readdirSync(root).sort().flatMap(name=>{
    assert(!/[\r\n\0]/.test(name),'Unsafe source filename')
    const file=join(root,name),path=prefix?prefix+'/'+name:name,stat=lstatSync(file)
    assert(!stat.isSymbolicLink(),'Source symlink: '+path)
    if(stat.isDirectory())return files(file,path)
    assert(stat.isFile(),'Nonregular source file: '+path)
    return[{path,bytes:stat.size,sha256:hash(readFileSync(file))}]
  })
}
function field(source,name){return new RegExp('^'+name+'\\s*=\\s*"([^"\\r\\n]+)"','m').exec(source)?.[1]}
function lockPackages(source){
  return source.split(/^\[\[package\]\]\s*$/m).slice(1).map(text=>({name:field(text,'name'),version:field(text,'version'),checksum:field(text,'checksum'),text}))
}

/** Validate portable evidence. The written assessment supplies the reasoning; hashes do not create it. */
export function checkMpl(root){
  root=resolve(root)
  const assessmentPath='docs/release/source-closure/MPL_ASSESSMENT.json'
  const assessment=JSON.parse(readFileSync(confined(root,assessmentPath),'utf8'))
  const base=confined(root,'dependencies/preferred-source/mpl')
  const evidencePath=confined(root,assessment.exactEvidence.provenancePath)
  const evidenceBytes=readFileSync(evidencePath)
  assert.equal(hash(evidenceBytes),assessment.exactEvidence.provenanceSha256,'Provenance changed; reassess the source')
  const evidence=JSON.parse(evidenceBytes)
  assert.equal(assessment.route.primaryLicense,'MPL-2.0')
  assert.equal(assessment.route.secondaryLicense,'AGPL-3.0-only')
  assert.equal(assessment.route.retainsMplChoice,true)
  assert.equal(assessment.route.requiresExistingSecondaryLicensedCombination,true)
  const inventoryBytes=readFileSync(confined(base,'CARGO_GRAPH.json'))
  assert.equal(hash(inventoryBytes),assessment.exactEvidence.graphInventorySha256,'Graph inventory changed')
  const inventory=JSON.parse(inventoryBytes)
  assert.equal(inventory.cargo.length,202,'Pinned dependency graph changed')
  const expressionCounts={}
  for(const dependency of inventory.cargo){
    assert(Object.hasOwn(assessment.reviewedLicenseExpressions,dependency.license),'Unassessed Cargo license expression: '+dependency.license)
    expressionCounts[dependency.license]=(expressionCounts[dependency.license]??0)+1
  }
  assert.deepEqual(expressionCounts,assessment.reviewedLicenseExpressions,'Cargo license inventory changed')
  assert.deepEqual(inventory.cargo.filter(row=>row.license==='MPL-2.0').map(row=>row.directory).sort(),['hpke-rs-0.7.0','hpke-rs-crypto-0.7.0'])
  const context=[]
  for(const input of evidence.combinationInputs){
    const bytes=readFileSync(confined(base,input.bundledPath))
    assert.equal(hash(bytes),input.sha256,'Changed combination evidence: '+input.bundledPath)
    context.push({path:input.bundledPath,source:bytes.toString('utf8')})
  }
  const rootManifest=context.find(row=>row.path.endsWith('crypto-root-Cargo.toml'))?.source??''
  assert.equal(field(rootManifest,'license'),'AGPL-3.0-only')
  assert(rootManifest.includes('libsignal-protocol'),'No existing libsignal combination')
  for(const name of ['signal-crypto-Cargo.toml','libsignal-protocol-Cargo.toml'])assert.equal(field(context.find(row=>row.path.endsWith(name))?.source??'','license'),'AGPL-3.0-only')
  const lock=lockPackages(context.find(row=>row.path.endsWith('crypto-root-Cargo.lock'))?.source??'')
  assert(lock.find(row=>row.name==='signal-crypto')?.text.includes('"hpke-rs"'),'No actual HPKE/AGPL dependency chain')
  const results=[]
  let upstreamComparisons=0,vendorChecksums=0,sourceFiles=0,rustSources=0
  for(const pkg of evidence.packages){
    const packageRoot=confined(root,pkg.directory),actual=files(packageRoot)
    assert.deepEqual(actual,pkg.files,'Pinned package contents changed: '+pkg.name)
    const manifest=readFileSync(confined(packageRoot,'Cargo.toml'),'utf8'),original=readFileSync(confined(packageRoot,'Cargo.toml.orig'),'utf8')
    assert.equal(field(manifest,'name'),pkg.name);assert.equal(field(manifest,'version'),'0.7.0')
    assert.equal(field(manifest,'license'),'MPL-2.0');assert.equal(field(original,'license'),'MPL-2.0')
    const vcs=JSON.parse(readFileSync(confined(packageRoot,'.cargo_vcs_info.json'),'utf8'))
    assert.equal(vcs.git.sha1,pkg.upstream.commit);assert.equal(vcs.path_in_vcs,pkg.upstream.path)
    const checksumBytes=readFileSync(confined(packageRoot,'.cargo-checksum.json'))
    assert.equal(hash(checksumBytes),pkg.checksumFileSha256)
    const checksums=JSON.parse(checksumBytes)
    assert.equal(checksums.package,pkg.packageChecksum)
    assert.equal(lock.find(row=>row.name===pkg.name&&row.version===pkg.version)?.checksum,pkg.packageChecksum)
    assert.equal(pkg.registry.license,'MPL-2.0');assert.equal(pkg.registry.checksum,pkg.packageChecksum)
    const blockers=[],headers=[]
    for(const item of actual){
      const bytes=readFileSync(confined(packageRoot,item.path))
      if(item.path!=='.cargo-checksum.json'){
        assert.equal(hash(bytes),checksums.files[item.path],'Cargo source checksum mismatch: '+pkg.name+'/'+item.path)
        vendorChecksums+=1
      }
      const text=bytes.toString('utf8')
      if(/Incompatible\s+With\s+Secondary\s+Licenses|MPL-2\.0-no-copyleft-exception|MPL[- ](?:1\.1|1\.0)/i.test(text))blockers.push(item.path)
      if(item.path.endsWith('.rs')&&/This Source Code Form is subject to|SPDX-License-Identifier:\s*MPL/i.test(text))headers.push(item.path)
    }
    assert.deepEqual(blockers,[],'Secondary-license blocker: '+pkg.name)
    for(const compared of pkg.upstreamCompared){
      assert.equal(hash(readFileSync(confined(packageRoot,compared.path))),compared.sha256,'Upstream observation differs')
      assert.equal(compared.matchesVendored,true);upstreamComparisons+=1
    }
    sourceFiles+=actual.length;rustSources+=pkg.sourceFileCount
    results.push({name:pkg.name,version:pkg.version,declaredLicense:field(manifest,'license'),packageChecksum:pkg.packageChecksum,sourceFiles:actual.length,rustSources:pkg.sourceFileCount,perFileMplHeaders:headers.length,incompatibleMarkers:blockers,upstreamByteComparisons:pkg.upstreamCompared.length})
  }
  for(const historical of evidence.history){
    const bytes=readFileSync(confined(base,historical.bundledPath))
    assert.equal(hash(bytes),historical.sha256)
    assert.equal(field(bytes.toString('utf8'),'license'),'MPL-2.0')
  }
  for(const license of evidence.licenseFiles)assert.equal(hash(readFileSync(confined(base,license.path))),license.sha256,'License text changed: '+license.path)
  const mpl=readFileSync(confined(base,'LICENSE-MPL-2.0.txt'),'utf8').replace(/\s+/g,' ')
  assert(mpl.includes('GNU Affero General Public License, Version 3.0'),'MPL secondary definition absent')
  assert(mpl.includes('3.3. Distribution of a Larger Work'),'MPL section 3.3 absent')
  const noticeBytes=readFileSync(confined(base,evidence.supplementalNotice.path)),notice=noticeBytes.toString('utf8')
  assert.equal(hash(noticeBytes),evidence.supplementalNotice.sha256,'Distribution notice changed')
  for(const expected of ['MPL 2.0 section 3.3','AGPL version 3.0','MPL choice','matching version-specific','original'])assert(notice.includes(expected),'Required distribution statement absent: '+expected)
  assert.equal(sourceFiles,assessment.exactEvidence.packageSourceFiles)
  assert.equal(rustSources,assessment.exactEvidence.rustSourceFiles)
  assert.equal(upstreamComparisons,assessment.exactEvidence.upstreamByteComparisons)
  return{kind:'endtoend-mpl-evidence-validation',checkedAt:new Date().toISOString(),root,evidencePassed:true,packages:results,packageFilesVerified:sourceFiles,cargoSourceChecksumsVerified:vendorChecksums,rustSourcesVerified:rustSources,upstreamPinnedByteObservationsVerified:upstreamComparisons,historyManifestsVerified:evidence.history.length,cargoGraphPackages:inventory.cargo.length,reviewedLicenseExpressions:expressionCounts,sourceBundlePortable:true,vendorFilesChanged:false,assessmentConclusion:assessment.conclusion,noAutomaticLegalJudgment:true,legalCertification:false,publicationAuthorized:false}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flag=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1]}
  const root=resolve(flag('--root')??join(dirname(fileURLToPath(import.meta.url)),'..'))
  try{
    const result=checkMpl(root),output=flag('--out')
    if(output){const file=resolve(output);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(result,null,2)+'\n')}
    console.log(JSON.stringify(result,null,2))
  }catch(error){console.error(JSON.stringify({kind:'endtoend-mpl-evidence-validation',evidencePassed:false,error:error.message,legalCertification:false}));process.exitCode=1}
}
