import { spawn, type ChildProcess } from 'node:child_process'
import { AgentClient, AgentError, HttpAgentTransport, type AgentRequest, type AgentResponse, type AgentTransport } from '@e2ee/client'

export type HeadlessOptions = {
  relay: string
  vaultPath: string
  deviceKey?: string
  /** Explicit independent runner executable. No agent implementation is imported by this adapter. */
  agentExecutable?: string
  agentArguments?: string[]
  agentUrl?: string
  agentCapability?: string
  startupTimeoutMs?: number
}

/** Construct synchronously; start/connect to the independent agent on the first awaited operation. */
export function openHeadless(options: HeadlessOptions) {
  return new AgentClient(new LocalAgentTransport(options))
}
export { AgentClient as HeadlessClient } from '@e2ee/client'

class LocalAgentTransport implements AgentTransport {
  private running: Promise<HttpAgentTransport> | null = null
  private child: ChildProcess | null = null
  private closed = false
  private rejectStartup: ((error: Error) => void) | null = null
  constructor(private readonly options: HeadlessOptions) {}

  async request(request: AgentRequest): Promise<AgentResponse> {
    if (this.closed) throw new AgentError('Headless agent client is closed', 'closed')
    this.running ??= this.start()
    return (await this.running).request(request)
  }

  private async start(): Promise<HttpAgentTransport> {
    const url = this.options.agentUrl ?? (this.options.agentExecutable ? undefined : process.env.ENDTOEND_AGENT_URL)
    const capability = this.options.agentCapability ?? process.env.ENDTOEND_AGENT_CAPABILITY
    if (url) return new HttpAgentTransport(url, capability ?? '')
    const executable = this.options.agentExecutable ?? process.env.ENDTOEND_AGENT_EXECUTABLE
    if (!executable) throw new AgentError('Set ENDTOEND_AGENT_EXECUTABLE to the independent local agent runner, or ENDTOEND_AGENT_URL and ENDTOEND_AGENT_CAPABILITY', 'agent-unavailable')
    const args = this.options.agentArguments ?? parseArguments(process.env.ENDTOEND_AGENT_ARGUMENTS)
    return new Promise((resolve, reject) => {
      let settled = false
      let output = ''
      let diagnostic = ''
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ENDTOEND_RELAY: this.options.relay,
          ENDTOEND_VAULT: this.options.vaultPath,
          ENDTOEND_PARENT_PID: String(process.pid),
          ...(this.options.deviceKey ? { ENDTOEND_DEVICE_KEY: this.options.deviceKey } : {}),
        },
      })
      this.child = child
      const finish = (error?: Error, transport?: HttpAgentTransport) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.rejectStartup = null
        if (error) { child.kill(); reject(error) }
        else resolve(transport!)
      }
      this.rejectStartup = (error) => finish(error)
      const timer = setTimeout(() => finish(new AgentError('Independent agent startup timed out', 'timeout')), this.options.startupTimeoutMs ?? 30_000)
      child.once('error', (error) => finish(new AgentError(`Independent agent could not start: ${error.message}`, 'agent-unavailable')))
      child.once('exit', (code) => finish(new AgentError(`Independent agent exited before readiness (${code ?? 'signal'}): ${diagnostic.trim()}`, 'agent-unavailable')))
      child.stderr?.on('data', (bytes) => { diagnostic = (diagnostic + String(bytes)).slice(-2000) })
      child.stdout?.on('data', (bytes) => {
        if (settled) return
        output += String(bytes)
        if (output.length > 65_536) return finish(new AgentError('Independent agent sent an oversized startup message', 'protocol'))
        const newline = output.indexOf('\n')
        if (newline < 0) return
        try {
          const ready = JSON.parse(output.slice(0, newline))
          if (ready.type !== 'agent-ready' || ready.version !== 1 || typeof ready.url !== 'string' || typeof ready.capability !== 'string') {
            throw new Error('Expected protocol v1 agent-ready record')
          }
          finish(undefined, new HttpAgentTransport(ready.url, ready.capability))
        } catch (error) { finish(new AgentError(`Invalid independent agent startup record: ${(error as Error).message}`, 'protocol')) }
      })
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.rejectStartup?.(new AgentError('Headless agent client is closed', 'closed'))
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.kill('SIGTERM')
    })
  }
}

function parseArguments(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((arg) => typeof arg !== 'string')) throw new Error()
    return parsed
  } catch { throw new AgentError('ENDTOEND_AGENT_ARGUMENTS must be a JSON string array', 'invalid') }
}
