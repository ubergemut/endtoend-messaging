import {createHash} from 'node:crypto'
import {lstatSync,readdirSync,readFileSync} from 'node:fs'
import {join} from 'node:path'

/** Generated workspace files are excluded at every dependency nesting level. */
export function isGeneratedSourcePath(relative){
  const parts=relative.split('/')
  return parts.some(part=>part==='node_modules'||part==='.git')
    || /^(?:\.build|work|artifacts|coverage|test-results)(?:\/|$)/.test(relative)
    || /^packages\/crypto\/(?:pkg-node|pkg-web|target)(?:\/|$)/.test(relative)
    || /^apps\/agent-browser\/dist(?:\/|$)/.test(relative)
}

export function sourceFiles(directory,prefix=''){
  return readdirSync(directory).sort().flatMap(name=>{
    if(/[\r\n\0]/.test(name))throw new Error('Unsafe archive filename')
    const file=join(directory,name),relative=prefix?`${prefix}/${name}`:name
    if(isGeneratedSourcePath(relative))return[]
    const stat=lstatSync(file)
    if(stat.isSymbolicLink())throw new Error(`Unexpected source symlink: ${relative}`)
    if(stat.isDirectory())return sourceFiles(file,relative)
    if(!stat.isFile())throw new Error(`Unexpected source file type: ${relative}`)
    return[{path:relative,bytes:stat.size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}]
  })
}
