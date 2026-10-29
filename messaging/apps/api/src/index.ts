import { startServer } from './server.ts'

// Explicit runner invocation never touches a previous development database implicitly.
const started = await startServer({port:0,dataDir:process.env.ENDTOEND_RELAY_DATA,sourceDisclosure:process.env.ENDTOEND_SOURCE_DISCLOSURE,releaseMode:process.env.ENDTOEND_RELEASE_MODE==='1'})
console.log(`EndToEnd API listening on ${started.baseUrl}`)
const stop = () => void started.close().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
