// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {cp,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {checkPgUuidv7Mpl} from './release-mpl-pg-uuidv7-check.mjs'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const base='dependencies/preferred-source/mpl-pg-uuidv7'
const assessmentPath='docs/release/source-closure/PG_UUIDV7_ASSESSMENT.json'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function fixture(action){
  const target=await mkdtemp(join(tmpdir(),'endtoend-pg-uuidv7-mpl-'))
  try{
    const assessment=JSON.parse(await readFile(join(root,assessmentPath),'utf8'))
    const provenance=JSON.parse(await readFile(join(root,assessment.evidence.provenancePath),'utf8'))
    for(const path of [base,provenance.sourceDirectory,provenance.originalArchive.path,assessmentPath]){
      await mkdir(dirname(join(target,path)),{recursive:true})
      await cp(join(root,path),join(target,path),{recursive:true,dereference:false,errorOnExist:true})
    }
    return await action(target,assessment,provenance)
  }finally{
    assert(resolve(target).startsWith(join(resolve(tmpdir()),'endtoend-pg-uuidv7-mpl-')),'Unexpected fixture cleanup path')
    await rm(target,{recursive:true,force:true})
  }
}
test('pg_uuidv7 MPL validation is portable and distinguishes the license template from a designation',()=>fixture(async target=>{
  const result=checkPgUuidv7Mpl(target)
  assert.equal(result.evidencePassed,true)
  assert.equal(result.upstreamGitBlobsVerified,37)
  assert.equal(result.unassignedExhibitBTemplatePreserved,true)
  assert.deepEqual(result.incompatibleDesignations,[])
  assert.equal(result.compiledBinaryReproductionProven,false)
  assert.equal(result.extensionEnabledByExistingApi,false)
}))
test('pg_uuidv7 source corruption invalidates the exact-source assessment',()=>fixture(async(target,assessment,provenance)=>{
  await writeFile(join(target,provenance.sourceDirectory,'pg_uuidv7.c'),'changed source')
  assert.throws(()=>checkPgUuidv7Mpl(target),/Exact pg_uuidv7 source changed/)
}))
test('recomputed notice hashes cannot silently drop the pg_uuidv7 retained MPL choice',()=>fixture(async(target,assessment,provenance)=>{
  const noticePath=join(target,base,provenance.supplementalNotice.path)
  const changed=(await readFile(noticePath,'utf8')).replace('MPL choice','secondary grant only')
  await writeFile(noticePath,changed)
  provenance.supplementalNotice.sha256=hash(Buffer.from(changed))
  const provenanceBytes=Buffer.from(JSON.stringify(provenance,null,2)+'\n')
  await writeFile(join(target,assessment.evidence.provenancePath),provenanceBytes)
  assessment.evidence.provenanceSha256=hash(provenanceBytes)
  await writeFile(join(target,assessmentPath),JSON.stringify(assessment,null,2)+'\n')
  assert.throws(()=>checkPgUuidv7Mpl(target),/Required notice statement missing: MPL choice/)
}))
