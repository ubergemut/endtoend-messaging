import {defineConfig} from 'vite'
import {readFileSync} from 'node:fs'
const license=readFileSync(new URL('../../LICENSE',import.meta.url),'utf8')
const clientLicense=readFileSync(new URL('../../packages/client/LICENSE',import.meta.url),'utf8')
const protocolLicense=readFileSync(new URL('../../packages/protocol/LICENSE',import.meta.url),'utf8')
const notices='EndToEnd public reference browser notices\n\nThe reference application is AGPL-3.0-only; see LICENSE.txt.\nThe bundled first-party @e2ee/client and @e2ee/protocol are independently licensed MIT.\n\n'+[...new Set([clientLicense,protocolLicense])].join('\n\n')
export default defineConfig({
  plugins:[{name:'reference-license',generateBundle(){this.emitFile({type:'asset',fileName:'LICENSE.txt',source:license});this.emitFile({type:'asset',fileName:'THIRD_PARTY_NOTICES.txt',source:notices})},configureServer(server){for(const [url,content] of [['/LICENSE.txt',license],['/THIRD_PARTY_NOTICES.txt',notices]])server.middlewares.use(url,(_req,res)=>{res.setHeader('content-type','text/plain');res.end(content)})}}],
  server:{host:'127.0.0.1',port:0,strictPort:true},
  build:{target:'es2022',modulePreload:{polyfill:false}},
})
