import test from 'node:test'
import assert from 'node:assert/strict'
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {checkMpl} from './release-mpl-check.mjs'

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..')
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'endtoend-mpl-evidence-'))
  mkdirSync(join(directory,'dependencies/preferred-source'),{recursive:true})
  cpSync(join(repository,'dependencies/preferred-source/mpl'),join(directory,'dependencies/preferred-source/mpl'),{recursive:true})
  mkdirSync(join(directory,'docs/release/source-closure'),{recursive:true})
  cpSync(join(repository,'docs/release/source-closure/MPL_ASSESSMENT.json'),join(directory,'docs/release/source-closure/MPL_ASSESSMENT.json'))
  return{directory,close(){assert(resolve(directory).startsWith(join(resolve(tmpdir()),'endtoend-mpl-evidence-')));rmSync(directory,{recursive:true,force:true})}}
}
test('the MPL evidence validates from a relocated source tree without the original checkout or vendor location',()=>{
  const opened=fixture()
  try{const result=checkMpl(opened.directory);assert.equal(result.evidencePassed,true);assert.equal(result.packageFilesVerified,31);assert.equal(result.cargoSourceChecksumsVerified,29);assert.equal(result.legalCertification,false)}finally{opened.close()}
})
test('altering a source file invalidates the exact-version MPL assessment',()=>{
  const opened=fixture()
  try{writeFileSync(join(opened.directory,'dependencies/preferred-source/mpl/hpke-rs-0.7.0/src/lib.rs'),'changed source');assert.throws(()=>checkMpl(opened.directory),/Pinned package contents changed/)}finally{opened.close()}
})
test('consistent new hashes cannot hide a distribution notice that drops the retained MPL choice',()=>{
  const opened=fixture()
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
  try{
    const base=join(opened.directory,'dependencies/preferred-source/mpl'),notice=join(base,'DISTRIBUTION_NOTICE.txt')
    writeFileSync(notice,readFileSync(notice,'utf8').replaceAll('MPL choice','original choice'))
    const provenancePath=join(base,'PROVENANCE.json'),provenance=JSON.parse(readFileSync(provenancePath,'utf8'))
    provenance.supplementalNotice.sha256=digest(readFileSync(notice));writeFileSync(provenancePath,JSON.stringify(provenance,null,2)+'\n')
    const assessmentPath=join(opened.directory,'docs/release/source-closure/MPL_ASSESSMENT.json'),assessment=JSON.parse(readFileSync(assessmentPath,'utf8'))
    assessment.exactEvidence.provenanceSha256=digest(readFileSync(provenancePath));writeFileSync(assessmentPath,JSON.stringify(assessment,null,2)+'\n')
    assert.throws(()=>checkMpl(opened.directory),/Required distribution statement absent: MPL choice/)
  }finally{opened.close()}
})
