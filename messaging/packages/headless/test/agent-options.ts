import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** Tests explicitly launch the independent executable; production adapters never import it. */
export const testAgentOptions = {
  agentExecutable: process.execPath,
  agentArguments: process.env.ENDTOEND_TEST_AGENT_ENTRY
    ? [path.resolve(process.env.ENDTOEND_TEST_AGENT_ENTRY)]
    : ['--import', 'tsx', fileURLToPath(new URL('../../agent/src/bin.ts', import.meta.url))],
}
