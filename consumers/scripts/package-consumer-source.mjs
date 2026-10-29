// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const digest=file=>hash(fs.readFileSync(file))
const write=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes)}
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'))

export function safeConsumerSourcePath(name) {
  assert(typeof name==='string'&&name&&!path.isAbsolute(name)&&!name.includes('\\')&&!/[\r\n\0<>:"|?*]/.test(name),'Unsafe consumer source path')
  assert(!name.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||/^\.env(?:\.|$)/.test(part)||['node_modules','.git','data','vaults','.build'].includes(part)),'Unsafe consumer source member')
  assert(!/^(?:packages\/(?!client\/|protocol\/)|apps\/(?!web\/|desk-client\/))/.test(name),'Protected implementation cannot enter consumer source')
  assert(!/^apps\/web\/dist\//.test(name),'Compiled frontend cannot enter its source archive')
  assert(/^(?:package\.json|yarn\.lock|LICENSE|README\.md|MODIFICATIONS\.md|CONSUMER_(?:PROVENANCE|SOURCE_MANIFEST)\.json|apps\/(?:web|desk-client)\/.+|packages\/(?:client|protocol)\/.+|dependencies\/.+|docs\/(?:PROTOCOL\.md|architecture\/(?:SDK_CONTRACT_V1|BROWSER_CONSUMER_V1)\.md)|provenance\/sdk\/(?:SDK_(?:MANIFEST|PROVENANCE)\.json|PACKAGE_RECEIPT\.json|README\.md)|scripts\/(?:package-sdk(?:\.test)?|build-sdk-consumers|package-consumer-source(?:\.test)?|rebuild-sdk-consumers|run-sdk-consumer|serve-sdk-consumer|source-disclosure)\.mjs)$/.test(name),'Unexpected consumer source path')
  return name
}

export function consumerSourceFiles(root,prefix='') {
  return fs.readdirSync(path.join(root,prefix)).sort().flatMap(name=>{
    // Yarn may place development-tool installations under individual workspaces too.
    if(name==='node_modules'||(prefix==='apps/web'&&name==='dist'))return []
    const relative=prefix?prefix+'/'+name:name,filename=path.join(root,relative),info=fs.lstatSync(filename)
    assert(!info.isSymbolicLink(),'Consumer source symlink refused')
    if(info.isDirectory())return consumerSourceFiles(root,relative)
    safeConsumerSourcePath(relative);assert(info.isFile(),'Consumer source must be a regular file')
    return [{path:relative,bytes:info.size,sha256:digest(filename)}]
  })
}

export function verifyConsumerSource(root,manifest) {
  assert.equal(manifest.kind,'endtoend-sdk-consumer-corresponding-source')
  assert(Array.isArray(manifest.files)&&manifest.files.length>0,'Empty consumer source manifest')
  const seen=new Set();for(const item of manifest.files){safeConsumerSourcePath(item.path);assert(!seen.has(item.path),'Duplicate consumer source member');seen.add(item.path)}
  const actual=consumerSourceFiles(root).filter(item=>item.path!=='CONSUMER_SOURCE_MANIFEST.json')
  assert.equal(actual.length,manifest.files.length,'Consumer source membership differs')
  for(const item of actual)assert.deepEqual(item,manifest.files.find(record=>record.path===item.path),`Consumer source changed: ${item.path}`)
  return {passed:true,filesChecked:actual.length}
}

function tar(args,cwd) {
  const result=spawnSync('tar',args,{cwd,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024})
  assert(!result.error&&result.status===0,`Consumer archive operation failed: ${result.error?.message??result.stderr}`)
  return result.stdout
}

export function writeConsumerArchive({root,output,filename,files}) {
  assert(!fs.existsSync(path.join(output,filename)),'Consumer artifact already exists')
  const members=files.map(item=>item.path).sort(),list=path.join(output,filename+'.members.txt')
  write(list,members.join('\n')+'\n')
  const archive=path.join(output,filename)
  tar(['-czf',archive,'-C',root,'-T',list],output)
  const actual=tar(['-tzf',archive],output).trim().split(/\r?\n/).map(name=>name.replace(/^\.\//,'')).sort()
  assert.deepEqual(actual,members,'Consumer archive membership differs')
  return {filename,sha256:digest(archive),bytes:fs.statSync(archive).size,files:files.length}
}

/** Freeze source before compiling the application; preferred third-party forms are immutable closure inputs. */
export function prepareConsumerSource({workspace,output,closureSource,version='0.2.0',sdkIdentity}) {
  assert(closureSource,'Consumer source delivery requires the verified preferred-source closure')
  assert(!fs.existsSync(path.join(workspace,'apps/web/dist')),'Freeze consumer source before compiling the frontend')
  const closure=json(path.join(closureSource,'CLOSURE_MANIFEST.json'))
  const copyPreferred=relative=>{
    const expected=closure.files.find(item=>item.path===relative);assert(expected,'Preferred source is outside the closure manifest')
    const source=path.join(closureSource,relative),bytes=fs.readFileSync(source)
    assert.equal(bytes.length,expected.bytes);assert.equal(hash(bytes),expected.sha256,'Frozen preferred source hash mismatch')
    write(path.join(workspace,relative),bytes);return expected
  }
  const dependencies=[]
  for(const [name,selectedVersion] of [['react','19.3.0'],['react-dom','19.3.0'],['scheduler','0.28.0'],['vite','7.3.6']]){
    const installed=json(path.join(workspace,'node_modules',name,'package.json'));assert.equal(installed.version,selectedVersion,'Consumer dependency changed from the reviewed preferred source')
    for(const extension of ['json','tgz'])dependencies.push(copyPreferred(`dependencies/preferred-source/npm/${name}@${selectedVersion}.${extension}`))
    const license=fs.readFileSync(path.join(workspace,'node_modules',name,name==='vite'?'LICENSE.md':'LICENSE'))
    write(path.join(workspace,'dependencies/licenses',name+'.txt'),license)
  }
  const upstream=json(path.join(closureSource,'dependencies/preferred-source/npm-upstream/PROVENANCE.json')).records.filter(item=>['react','vite'].includes(item.name))
  assert.equal(upstream.length,2)
  for(const record of upstream)dependencies.push(copyPreferred(record.archive))
  write(path.join(workspace,'dependencies/PREFERRED_SOURCE.json'),JSON.stringify({kind:'consumer-runtime-preferred-sources',unmodified:true,archives:dependencies,upstream,
    mapping:{react:['react','react-dom','scheduler'],vite:['generated browser modulepreload helper']},
    rebuild:'The exact npm packages are the build inputs. Upstream archives contain the editable forms and their build scripts. No claim of independently regenerating upstream npm releases is made.'},null,2)+'\n')
  write(path.join(workspace,'MODIFICATIONS.md'),'# Modifications and license notices\n\n2026-10-28: The retained EndToEnd full frontend was adapted to the separate public SDK and trusted browser agent; durable-send controls, host-account integration and preservation fixes are included. This candidate adds version-specific source, manifest, license and attribution links on every page, including before login, plus visible copyright, warranty and AGPL modification/redistribution notices in the full frontend. Full frontend code retains AGPL-3.0-only and earlier grants remain valid.\n\nThe independent desk presentation/controller was authored separately against the public SDK and retains MIT. Its later source-disclosure footer is first-party interface code and retains MIT. SDK 0.2.1 includes the explicit native-fetch receiver correction. Third-party React, React DOM, Scheduler and Vite inputs are unmodified and retain their supplied licenses. The packager and standalone build script are AGPL-3.0-only; the static SDK consumer host and source disclosure helper are MIT.\n')
  write(path.join(workspace,'README.md'),`# EndToEnd browser consumers ${version}\n\nThis is exact corresponding source for the retained AGPL-3.0-only full frontend, plus independently authored MIT desk source and the MIT SDK ${sdkIdentity.version??'0.2.1'} it consumes. It contains editable application and SDK source, configuration, embedded guides/media, interfaces, tests, license notices and the actual build/run scripts. The separately running AGPL messaging service/agent is a separate source component; its offer must remain visible through the trusted agent and host integration.\n\nUse Node 22.13.0 and Yarn 1.22.22. From this directory run \`yarn install --frozen-lockfile --production=false --ignore-scripts --non-interactive\`, then \`node scripts/rebuild-sdk-consumers.mjs\`. This rebuilds the MIT SDK from its included source, checks full-frontend types and tests, checks the desk JavaScript, compiles the full frontend, and installs notices. No original checkout or prebuilt frontend is used. Runtime static roots are \`apps/web/dist\` and \`apps/desk-client\`; the desk's import map loads only the included compiled MIT SDK. \`scripts/serve-sdk-consumer.mjs\` is the independent static host API. Supply a matching source-disclosure descriptor and its exact files when using release mode; configure the host with a distinct trusted-agent origin before navigation. The messaging service supplies its own accounts or host grants.\n\nNo source download requires login, payment, NDA or terms that reduce covered license rights. The release source archive is served alongside each exact downloadable browser component. Verify SHA-256 against the release disclosure and verify all files with CONSUMER_SOURCE_MANIFEST.json.\n\nPreferred third-party forms: \`dependencies/PREFERRED_SOURCE.json\` maps exact npm archives and upstream editable React/Vite source to the bundled React/DOM/Scheduler code and generated Vite preload helper. Their notices are retained under dependencies/licenses and in the compiled frontend. General-purpose Node, Yarn, TypeScript, tsx, Vite/Rollup/esbuild/Babel tooling and Playwright browser installations are not installed tools inside this artifact; obtain those versions using the included exact lockfile. Node/Yarn and OS/system libraries are standard external tools. The Vite source is nevertheless included because its browser preload helper is emitted. This candidate has no vendor-locked User Product, firmware, signing keys or owner authorization needed to install a modified program. It has no schema, database, secret, vault or native encryption implementation; those belong to the separate messaging component.\n\nThe original SDK archive identity and original SDK manifest/provenance are retained under provenance/sdk for attribution and chain of custody; that earlier manifest describes the original MIT SDK artifact, not this combined consumer workspace. SDK package licenses retain MIT. MODIFICATIONS.md records first-party changes. No production deployment or publication is performed by these scripts.\n`)
  write(path.join(workspace,'CONSUMER_PROVENANCE.json'),JSON.stringify({kind:'consumer-source-preparation',version,sdk:sdkIdentity,compiledFrontendIncluded:false,protectedMessagingImplementationIncluded:false,dependencies,preparedBeforeFrontendBuild:true},null,2)+'\n')
  const files=consumerSourceFiles(workspace)
  const manifest={kind:'endtoend-sdk-consumer-corresponding-source',version,components:[{id:'endtoend-web',license:'AGPL-3.0-only'},{id:'desk-client',license:'MIT'},{id:'mit-sdk',license:'MIT',version:'0.2.1'}],files}
  write(path.join(workspace,'CONSUMER_SOURCE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n')
  const archive=writeConsumerArchive({root:workspace,output,filename:`endtoend-browser-consumers-${version}-source.tar.gz`,files:[...files,{path:'CONSUMER_SOURCE_MANIFEST.json'}]})
  archive.manifestFilename='CONSUMER_SOURCE_MANIFEST.json';archive.manifestSha256=digest(path.join(workspace,'CONSUMER_SOURCE_MANIFEST.json'))
  write(path.join(output,archive.manifestFilename),fs.readFileSync(path.join(workspace,archive.manifestFilename)))
  const extraction=path.join(output,'fresh-source-extraction');fs.mkdirSync(extraction)
  tar(['-xzf',path.join(output,archive.filename),'-C',extraction],output)
  assert.equal(digest(path.join(extraction,archive.manifestFilename)),archive.manifestSha256)
  const verification=verifyConsumerSource(extraction,manifest)
  assert(!fs.existsSync(path.join(extraction,'node_modules'))&&!fs.existsSync(path.join(extraction,'apps/web/dist')),'Fresh source extraction contains installed tools or prebuilt frontend')
  return {archive,extraction,manifest,verification,dependencies}
}
