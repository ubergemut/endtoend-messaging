import { HeadlessError } from './types.ts'

export class Relay {
  token: string | null = null
  private generation = 0
  private controller = new AbortController()

  constructor(readonly baseUrl: string, private readonly unauthorized?: () => void) {}

  revoke() {
    this.generation += 1
    this.controller.abort()
    this.controller = new AbortController()
    this.token = null
  }

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const generation = this.generation
    const headers: Record<string, string> = {}
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (this.token) headers.authorization = `Bearer ${this.token}`
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: this.controller.signal,
        redirect: 'error',
      })
    } catch (reason) {
      throw new HeadlessError(`Relay unreachable at ${this.baseUrl}: ${(reason as Error).message}`, 'relay')
    }
    const body = await response.json().catch(() => ({}))
    if (generation !== this.generation) throw new HeadlessError('Session was locked during the request', 'locked')
    if (!response.ok) {
      // A detected authority failure must also revoke cached decrypted views.
      if (this.token && (response.status === 401 || (response.status === 403 && (path === '/api/bootstrap' || path === '/messaging/v1/session')))) this.unauthorized?.()
      throw new HeadlessError((body as { error?: string }).error || `Relay ${response.status}`, 'relay')
    }
    return body as T
  }
}
