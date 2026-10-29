import { loadAgentConfig } from './runtimeConfig.ts'

export class Api {
  constructor(private token: string | null = null) {}

  setToken(token: string | null) {
    this.token = token
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.token
    if (!path.startsWith('/api/') || path.includes('\\')) throw new Error('Invalid relay API path')
    const config = await loadAgentConfig(init.signal ?? undefined)
    if (config.host) throw new Error('Native relay login is unavailable in host login mode.')
    const headers = new Headers(init.headers)
    if (init.body) headers.set('content-type', 'application/json')
    if (token) headers.set('authorization', `Bearer ${token}`)
    const response = await fetch(new URL(path, config.relayUrl), { ...init, headers, credentials: 'omit', redirect: 'error' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`)
    return body as T
  }
}
