import {defineConfig} from 'vite'
import {readFileSync} from 'node:fs'
const license=readFileSync(new URL('../../LICENSE',import.meta.url),'utf8')
export default defineConfig({plugins:[{name:'agent-license',generateBundle(){this.emitFile({type:'asset',fileName:'LICENSE.txt',source:license})},configureServer(server){server.middlewares.use('/LICENSE.txt',(_req,res)=>{res.setHeader('content-type','text/plain');res.end(license)})}}],server:{host:'127.0.0.1',port:0,strictPort:true},optimizeDeps:{exclude:['@e2ee/crypto']},build:{target:'es2022',modulePreload:{polyfill:false}}})
