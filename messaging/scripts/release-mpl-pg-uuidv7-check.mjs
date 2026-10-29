// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {dirname,isAbsolute,join,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const gitBlob=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
const extensionCommit='c707aae2411181be4802f5fa565b44d9c0bcbc29'
function confined(root,path){
  assert.equal(typeof path,'string','Source path must be text')
  assert(!isAbsolute(path)&&!path.includes('\\')&&!path.split('/').some(part=>!part||part==='.'||part==='..'),'Unsafe source path: '+path)
  const absolute=resolve(root,path),rel=relative(root,absolute)
  assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Source path escapes root: '+path)
  let current=root
  for(const part of path.split('/')){current=join(current,part);assert(!lstatSync(current).isSymbolicLink(),'Source symlink: '+path)}
  return absolute
}
function files(root,prefix=''){
  return readdirSync(join(root,prefix)).sort().flatMap(name=>{
    assert(!/[\r\n\0]/.test(name),'Unsafe source filename')
    const path=prefix?`${prefix}/${name}`:name,file=join(root,path),stat=lstatSync(file)
    assert(!stat.isSymbolicLink(),'Source symlink: '+path)
    if(stat.isDirectory())return files(root,path)
    assert(stat.isFile(),'Nonregular source: '+path)
    const bytes=readFileSync(file)
    return[{path,bytes:bytes.length,sha256:digest(bytes),gitBlob:gitBlob(bytes)}]
  })
}
export function checkPgUuidv7Mpl(root){
  root=resolve(root)
  const assessment=JSON.parse(readFileSync(confined(root,'docs/release/source-closure/PG_UUIDV7_ASSESSMENT.json'),'utf8'))
  const evidenceBytes=readFileSync(confined(root,assessment.evidence.provenancePath))
  assert.equal(digest(evidenceBytes),assessment.evidence.provenanceSha256,'pg_uuidv7 provenance changed; reassess')
  const evidence=JSON.parse(evidenceBytes),base=confined(root,'dependencies/preferred-source/mpl-pg-uuidv7')
  assert.equal(evidence.commit,extensionCommit);assert.equal(evidence.extensionVersion,'1.7.0')
  assert.equal(assessment.route.primaryLicense,'MPL-2.0')
  assert.equal(assessment.route.secondaryLicense,'AGPL-3.0-only')
  assert.equal(assessment.route.retainsMplChoice,true)
  assert.equal(assessment.route.secondaryRouteRequiresQualifyingCombination,true)
  assert.equal(assessment.existingRuntime.extensionEnabled,false)
  const source=confined(root,evidence.sourceDirectory),actual=files(source)
  assert.deepEqual(actual,evidence.sourceFiles,'Exact pg_uuidv7 source changed')
  const treeBytes=readFileSync(confined(base,evidence.upstream.treePath))
  assert.equal(digest(treeBytes),evidence.upstream.treeSha256,'Upstream tree observation changed')
  const tree=JSON.parse(treeBytes)
  assert.equal(tree.truncated,false)
  const blobs=tree.tree.filter(row=>row.type==='blob'),unexpected=tree.tree.filter(row=>row.type!=='blob'&&row.type!=='tree')
  assert.deepEqual(unexpected,[],'Unassessed upstream submodule or link')
  for(const blob of blobs){
    assert(['100644','100755'].includes(blob.mode),'Unassessed upstream file type: '+blob.path)
    const observed=actual.find(file=>file.path===blob.path)
    assert(observed&&observed.gitBlob===blob.sha&&observed.bytes===blob.size,'Upstream Git blob mismatch: '+blob.path)
  }
  assert.equal(blobs.length,37);assert.equal(actual.length,38)
  assert.deepEqual(actual.filter(row=>!blobs.some(blob=>blob.path===row.path)).map(row=>row.path),['EXTRACTION_LINKS.json'])
  assert.deepEqual(JSON.parse(readFileSync(confined(source,'EXTRACTION_LINKS.json'),'utf8')).links,[])
  for(const required of ['pg_uuidv7.c','sql/pg_uuidv7--1.7.sql','pg_uuidv7.control','Makefile','LICENSE','README.md','CONTRIBUTING.md'])assert(actual.some(row=>row.path===required),'Missing source/build/license input: '+required)
  assert.equal(JSON.parse(readFileSync(confined(source,'META.json'),'utf8')).version,'1.7.0')
  assert(readFileSync(confined(source,'pg_uuidv7.control'),'utf8').includes("default_version = '1.7'"))
  const archive=readFileSync(confined(root,evidence.originalArchive.path))
  assert.equal(digest(archive),evidence.originalArchive.sha256,'Original extension source archive changed')
  assert.equal(archive.length,evidence.originalArchive.bytes)
  assert.equal(evidence.originalArchive.sha256,'422b882887ace16a1358150eb8bcfcf41a74ae60db89818929ba4f59ba360251')
  const historyBytes=readFileSync(confined(base,evidence.licenseHistory.path))
  assert.equal(digest(historyBytes),evidence.licenseHistory.sha256)
  const history=JSON.parse(historyBytes)
  assert.equal(history.licenseCommits.length,1);assert.equal(history.firstLicenseFile.status,'added')
  assert.equal(history.licenseCommits[0].sha,'44d79cb8d67e0796f138bcf3359b468bb323b5ce')
  const originalLicense=readFileSync(confined(base,evidence.licenseHistory.firstLicensePath))
  assert.equal(digest(originalLicense),evidence.licenseHistory.firstLicenseSha256)
  assert.deepEqual(originalLicense,readFileSync(confined(source,'LICENSE')),'Current license differs from first observed MPL2 license')
  const blockers=[],perFileHeaders=[]
  for(const file of actual){
    // The complete license contains the definition and unassigned Exhibit B template.
    // It is preserved exactly above; scan the other files for an actual designation.
    if(file.path==='LICENSE')continue
    const text=readFileSync(confined(source,file.path),'utf8')
    if(/Incompatible\s+With\s+Secondary\s+Licenses|MPL-2\.0-no-copyleft-exception|MPL[- ](?:1\.1|1\.0)/i.test(text))blockers.push(file.path)
    if(/\.(?:c|sql)$/.test(file.path)&&/This Source Code Form is subject to|SPDX-License-Identifier:\s*MPL/i.test(text))perFileHeaders.push(file.path)
  }
  assert.deepEqual(blockers,[],'Unassessed secondary-license blocker')
  for(const license of evidence.licenseFiles)assert.equal(digest(readFileSync(confined(base,license.path))),license.sha256,'License text changed: '+license.path)
  assert.deepEqual(readFileSync(confined(base,'LICENSE-MPL-2.0.txt')),originalLicense)
  const mpl=originalLicense.toString('utf8').replace(/\s+/g,' ')
  for(const phrase of ['Mozilla Public License Version 2.0','GNU Affero General Public License, Version 3.0','3.3. Distribution of a Larger Work'])assert(mpl.includes(phrase),'Missing full MPL provision: '+phrase)
  const context=[]
  for(const input of evidence.combinationInputs){
    const bytes=readFileSync(confined(base,input.bundledPath))
    assert.equal(digest(bytes),input.sha256,'Combination context changed: '+input.bundledPath)
    assert.equal(bytes.length,input.bytes)
    context.push({path:input.bundledPath,text:bytes.toString('utf8')})
  }
  const text=name=>context.find(row=>row.path.endsWith('/'+name))?.text??''
  const api=JSON.parse(text('apps-api-package.json')),pglite=JSON.parse(text('pglite-package.json'))
  assert.equal(api.license,'AGPL-3.0-only');assert(api.dependencies['@electric-sql/pglite'])
  assert.equal(pglite.name,'@electric-sql/pglite');assert.equal(pglite.version,'0.3.16')
  assert(/"@electric-sql\/pglite@[^\r\n]+:\r?\n\s+version "0\.3\.16"/.test(text('yarn.lock')),'Locked PGlite version changed')
  assert(text('apps-api-db.ts').includes("from '@electric-sql/pglite'"),'No actual API/PGlite import')
  assert(!/pg_uuidv7|uuid_generate_v7/.test(text('apps-api-db.ts')),'Runtime extension activation changed; reassess')
  const postgres=JSON.parse(text('POSTGRES_PROVENANCE.json'))
  assert.equal(postgres.gitlinks.find(row=>row.path==='pglite/pg_uuidv7')?.sha,extensionCommit)
  assert(text('pg_uuidv7.sh').includes('PG_CONFIG=${PGROOT}/bin/pg_config emmake make'),'Upstream extension build context missing')
  const observationBytes=readFileSync(confined(base,evidence.payloadObservations.path))
  assert.equal(digest(observationBytes),evidence.payloadObservations.sha256,'Payload text observation changed')
  const observation=JSON.parse(observationBytes)
  assert.equal(observation.compiledBinaryReproductionProven,false)
  assert.equal(observation.members.length,2)
  for(const member of observation.members){
    const bytes=readFileSync(confined(source,member.sourcePath))
    assert.equal(digest(bytes),member.sha256,'Source no longer matches recorded payload text: '+member.sourcePath)
    assert.equal(bytes.length,member.bytes);assert.equal(member.matchesSource,true)
  }
  const noticeBytes=readFileSync(confined(base,evidence.supplementalNotice.path))
  assert.equal(digest(noticeBytes),evidence.supplementalNotice.sha256,'Distribution notice changed')
  const notice=noticeBytes.toString('utf8')
  for(const phrase of ['MPL 2.0 section 3.3','AGPL version 3.0','MPL choice','matching version-specific source','does not currently enable pg_uuidv7'])assert(notice.includes(phrase),'Required notice statement missing: '+phrase)
  return{kind:'endtoend-pg-uuidv7-mpl-evidence-validation',checkedAt:new Date().toISOString(),evidencePassed:true,root,extensionVersion:evidence.extensionVersion,commit:evidence.commit,sourceFilesVerified:actual.length,upstreamGitBlobsVerified:blobs.length,originalArchiveVerified:true,licenseHistoryVerified:true,payloadTextObservationsVerified:observation.members.length,incompatibleDesignations:blockers,perFileMplHeaders:perFileHeaders.length,unassignedExhibitBTemplatePreserved:true,retainsMplChoice:true,extensionEnabledByExistingApi:false,sourceBundlePortable:true,compiledBinaryReproductionProven:false,assessmentConclusion:assessment.conclusion,legalCertification:false,publicationAuthorized:false}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flag=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1]}
  const root=resolve(flag('--root')??join(dirname(fileURLToPath(import.meta.url)),'..'))
  try{
    const result=checkPgUuidv7Mpl(root),output=flag('--out')
    if(output){const file=resolve(output);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(result,null,2)+'\n')}
    console.log(JSON.stringify(result,null,2))
  }catch(error){console.error(JSON.stringify({kind:'endtoend-pg-uuidv7-mpl-evidence-validation',evidencePassed:false,error:error.message,legalCertification:false}));process.exitCode=1}
}
