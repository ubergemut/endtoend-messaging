import { RelayService } from '@e2ee/client/standalone'
import type { MessagingGrant, Stay } from '@e2ee/protocol/standalone'

export type AgentConfig = { agentUrl: string; relayUrl: string; host?: { audience: string; grantPath: string } }

function secureOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Messaging configuration requires explicit origins.')
  const url = new URL(value)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Messaging configuration requires bare HTTPS origins (HTTP is allowed on loopback).')
  return url.origin
}

export function parseAgentConfig(value: unknown, productOrigin: string): AgentConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The messaging agent has not been configured.')
  const record = value as Record<string, unknown>
  const agentUrl = secureOrigin(record.agentUrl)
  const relayUrl = secureOrigin(record.relayUrl)
  if (agentUrl === new URL(productOrigin).origin) throw new Error('Agent and product require separate secure origins.')
  if (record.nativeAuth !== undefined && typeof record.nativeAuth !== 'boolean') throw new Error('Invalid native authentication setting.')
  const flatHost = record.audience !== undefined || record.grantPath !== undefined
  if (record.host !== undefined && flatHost) throw new Error('Ambiguous host messaging configuration.')
  if (record.host === undefined && !flatHost) {
    if (record.nativeAuth === false) throw new Error('A host grant is required when native authentication is disabled.')
    return { agentUrl, relayUrl }
  }
  if (record.host !== undefined && (!record.host || typeof record.host !== 'object' || Array.isArray(record.host))) throw new Error('Invalid host messaging configuration.')
  const host = flatHost ? record : record.host as Record<string, unknown>
  if (typeof host.audience !== 'string' || !host.audience.trim() || host.audience.length > 256 || /[\u0000-\u001f\u007f]/.test(host.audience)) throw new Error('Invalid host messaging audience.')
  // A host grant is obtained from the current product only. Reject URL normalization, encoded separators,
  // redirects and all query/fragment forms rather than accepting a second credential destination.
  if (typeof host.grantPath !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/?)+$/.test(host.grantPath)
    || new URL(host.grantPath, productOrigin).origin !== new URL(productOrigin).origin) throw new Error('Host grantPath must be a plain same-origin path.')
  return { agentUrl, relayUrl, host: { audience: host.audience, grantPath: host.grantPath } }
}

export async function loadAgentConfig(signal?: AbortSignal): Promise<AgentConfig> {
  const response = await fetch('/agent-config.json', { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal })
  if (!response.ok || response.redirected) throw new Error('The messaging agent has not been configured.')
  return parseAgentConfig(await response.json(), location.origin)
}

/** Only the same-origin host request carries its cookie; RelayService always omits credentials. */
export async function acquireHostGrant(config: AgentConfig, signal?: AbortSignal): Promise<MessagingGrant> {
  if (!config.host) throw new Error('Host login is not configured.')
  const relay = new RelayService(config.relayUrl, { audience: config.host.audience })
  try {
    await relay.metadata({ signal })
    const response = await fetch(config.host.grantPath, { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}', signal })
    if (!response.ok || response.redirected) throw new Error('Sign in to this host before connecting messaging.')
    const grant = await response.json() as MessagingGrant
    relay.attachInput(grant)
    const session = await relay.session(grant.token, { signal })
    if (session.account.id !== grant.account.id) throw new Error('Host messaging account does not match its token.')
    return grant
  } finally { relay.close() }
}

export async function grantAttachInput(config: AgentConfig, grant: MessagingGrant, stay: Stay, signal?: AbortSignal) {
  if (!config.host) throw new Error('Host login is not configured.')
  const relay = new RelayService(config.relayUrl, { audience: config.host.audience })
  try { await relay.metadata({ signal }); return relay.attachInput(grant, stay) }
  finally { relay.close() }
}

export async function revokeHostGrant(config: AgentConfig, grant: MessagingGrant) {
  if (!config.host) return
  const relay = new RelayService(config.relayUrl, { audience: config.host.audience })
  try { await relay.revoke(grant.token) } finally { relay.close() }
}
