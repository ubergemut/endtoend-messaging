import type { HeadlessClient } from './client.ts'
import { HeadlessError } from './types.ts'

export type FieldKind = 'string' | 'int' | 'boolean' | 'stringList'

export type Field = {
  name: string
  kind: FieldKind
  required?: boolean
  description: string
}

export type Operation = {
  name: string
  summary: string
  kind: 'query' | 'mutation'
  http: { method: 'GET' | 'POST'; path: string }
  fields: Field[]
  run(client: HeadlessClient, input: Record<string, unknown>): Promise<unknown>
}

export const operations: Operation[] = [
  {
    name: 'status',
    summary: 'Whether this process is unlocked, which vault it holds, and whether an identity change is blocking sends.',
    kind: 'query',
    http: { method: 'GET', path: '/status' },
    fields: [],
    run: (client) => Promise.resolve(client.status()),
  },
  {
    name: 'unlock',
    summary: 'Log in or create the account and open the local key vault. Refuses to replace an existing key bundle unless replaceKeys is true.',
    kind: 'mutation',
    http: { method: 'POST', path: '/unlock' },
    fields: [
      { name: 'handle', kind: 'string', required: true, description: 'Account handle' },
      { name: 'password', kind: 'string', required: true, description: 'Account password' },
      { name: 'replaceKeys', kind: 'boolean', description: 'Publish a new key bundle and break any other device for this account' },
    ],
    run: (client, input) => client.unlock({ handle: String(input.handle), password: String(input.password), replaceKeys: Boolean(input.replaceKeys) }),
  },
  {
    name: 'sync',
    summary: 'Pull envelopes from the relay, decrypt them into the vault, and return the new plaintext messages.',
    kind: 'mutation',
    http: { method: 'POST', path: '/sync' },
    fields: [],
    run: (client) => client.sync(),
  },
  {
    name: 'friends',
    summary: 'Accepted friends for the unlocked account.',
    kind: 'query',
    http: { method: 'GET', path: '/friends' },
    fields: [],
    run: (client) => client.friendsList(),
  },
  {
    name: 'requests',
    summary: 'Pending friend requests. Incoming notes are decrypted on this device.',
    kind: 'query',
    http: { method: 'GET', path: '/requests' },
    fields: [],
    run: (client) => client.requests(),
  },
  {
    name: 'requestFriend',
    summary: 'Send a friend request. The optional note is sealed to their identity key.',
    kind: 'mutation',
    http: { method: 'POST', path: '/requests' },
    fields: [
      { name: 'handle', kind: 'string', required: true, description: 'Handle to request' },
      { name: 'note', kind: 'string', description: 'Optional note. The relay stores it as ciphertext.' },
    ],
    run: (client, input) => client.requestFriend(String(input.handle), input.note ? String(input.note) : undefined),
  },
  {
    name: 'respondRequest',
    summary: 'Accept, decline, or cancel a friend request.',
    kind: 'mutation',
    http: { method: 'POST', path: '/requests/respond' },
    fields: [
      { name: 'id', kind: 'string', required: true, description: 'Request id' },
      { name: 'action', kind: 'string', required: true, description: 'accept, decline, or cancel' },
    ],
    run: (client, input) => {
      const action = String(input.action)
      if (action !== 'accept' && action !== 'decline' && action !== 'cancel') {
        throw new HeadlessError('action must be accept, decline, or cancel', 'invalid')
      }
      return client.respondRequest(String(input.id), action)
    },
  },
  {
    name: 'block',
    summary: 'Block a handle.',
    kind: 'mutation',
    http: { method: 'POST', path: '/block' },
    fields: [{ name: 'handle', kind: 'string', required: true, description: 'Handle to block' }],
    run: (client, input) => client.block(String(input.handle)),
  },
  {
    name: 'unfriend',
    summary: 'Remove a friend, rotate the access key, and wipe the local session.',
    kind: 'mutation',
    http: { method: 'POST', path: '/unfriend' },
    fields: [{ name: 'handle', kind: 'string', required: true, description: 'Friend handle' }],
    run: (client, input) => client.unfriend(String(input.handle)),
  },
  {
    name: 'chats',
    summary: 'Chat list with unseen counts. Counts include thread replies.',
    kind: 'query',
    http: { method: 'GET', path: '/chats' },
    fields: [],
    run: (client) => client.chats(),
  },
  {
    name: 'messages',
    summary: 'Plaintext messages already in the vault. Filter by handle or groupId. Call sync first.',
    kind: 'query',
    http: { method: 'GET', path: '/messages' },
    fields: [
      { name: 'handle', kind: 'string', description: 'Direct chat handle' },
      { name: 'groupId', kind: 'string', description: 'Group id' },
    ],
    run: (client, input) => client.messages({ handle: optionalString(input.handle), groupId: optionalString(input.groupId) }),
  },
  {
    name: 'focus',
    summary: 'The newest unseen message for a chat. threadId is set when that message is a reply, which means the host should open that thread.',
    kind: 'query',
    http: { method: 'GET', path: '/focus' },
    fields: [
      { name: 'handle', kind: 'string', description: 'Direct chat handle' },
      { name: 'groupId', kind: 'string', description: 'Group id' },
    ],
    run: (client, input) => client.focus({ handle: optionalString(input.handle), groupId: optionalString(input.groupId) }),
  },
  {
    name: 'markSeen',
    summary: 'Mark message ids as seen on this device. Unseen badges drop for those ids.',
    kind: 'mutation',
    http: { method: 'POST', path: '/seen' },
    fields: [{ name: 'ids', kind: 'stringList', required: true, description: 'Message ids' }],
    run: (client, input) => client.markSeen(asList(input.ids)),
  },
  {
    name: 'send',
    summary: 'Encrypt a direct message on this device and hand the ciphertext to the relay. replyTo starts or continues a thread.',
    kind: 'mutation',
    http: { method: 'POST', path: '/messages' },
    fields: [
      { name: 'operationId', kind: 'string', description: 'Stable caller operation ID. Reuse with identical content after a lost response.' },
      { name: 'handle', kind: 'string', required: true, description: 'Friend handle' },
      { name: 'body', kind: 'string', required: true, description: 'Plaintext. It is not sent to the relay.' },
      { name: 'replyTo', kind: 'string', description: 'Parent message id for a thread reply' },
      { name: 'expiresInSeconds', kind: 'int', description: 'Disappearing timer. Omit to keep the message.' },
    ],
    run: (client, input) =>
      client.send({
        handle: String(input.handle),
        body: String(input.body),
        replyTo: optionalString(input.replyTo),
        expiresInSeconds: optionalInt(input.expiresInSeconds),
      }, optionalString(input.operationId)),
  },
  {
    name: 'sendGroup',
    summary: 'Encrypt a group message with the sender key and fan the ciphertext out to members.',
    kind: 'mutation',
    http: { method: 'POST', path: '/groups/messages' },
    fields: [
      { name: 'operationId', kind: 'string', description: 'Stable caller operation ID. Reuse with identical content after a lost response.' },
      { name: 'groupId', kind: 'string', required: true, description: 'Group id' },
      { name: 'body', kind: 'string', required: true, description: 'Plaintext. It is not sent to the relay.' },
      { name: 'replyTo', kind: 'string', description: 'Parent message id' },
      { name: 'expiresInSeconds', kind: 'int', description: 'Disappearing timer' },
    ],
    run: (client, input) =>
      client.sendGroup({
        groupId: String(input.groupId),
        body: String(input.body),
        replyTo: optionalString(input.replyTo),
        expiresInSeconds: optionalInt(input.expiresInSeconds),
      }, optionalString(input.operationId)),
  },
  {
    name: 'sendFile',
    summary: 'Seal a file on this device, upload the ciphertext, and send the key inside the session message.',
    kind: 'mutation',
    http: { method: 'POST', path: '/files' },
    fields: [
      { name: 'operationId', kind: 'string', description: 'Stable caller operation ID. Reuse with identical content after a lost response.' },
      { name: 'handle', kind: 'string', description: 'Friend handle, when this is not a group file' },
      { name: 'groupId', kind: 'string', description: 'Group id, when this is not a direct file' },
      { name: 'name', kind: 'string', required: true, description: 'File name' },
      { name: 'mime', kind: 'string', required: true, description: 'Media type' },
      { name: 'base64', kind: 'string', required: true, description: 'File bytes, standard base64' },
      { name: 'body', kind: 'string', description: 'Optional caption' },
    ],
    run: (client, input) =>
      client.sendFile({
        handle: optionalString(input.handle),
        groupId: optionalString(input.groupId),
        name: String(input.name),
        mime: String(input.mime),
        base64: String(input.base64),
        body: optionalString(input.body),
      }, optionalString(input.operationId)),
  },
  {
    name: 'createGroup',
    summary: 'Create a group with accepted friends and deliver the sender key inside the existing 1:1 sessions.',
    kind: 'mutation',
    http: { method: 'POST', path: '/groups' },
    fields: [
      { name: 'name', kind: 'string', required: true, description: 'Group name' },
      { name: 'handles', kind: 'stringList', required: true, description: 'Friend handles' },
    ],
    run: (client, input) => client.createGroup(String(input.name), asList(input.handles)),
  },
  {
    name: 'groups',
    summary: 'Groups this account belongs to.',
    kind: 'query',
    http: { method: 'GET', path: '/groups' },
    fields: [],
    run: (client) => client.groupsList(),
  },
  {
    name: 'safetyNumber',
    summary: 'Safety number for a friend. Compare it on a channel you already trust.',
    kind: 'query',
    http: { method: 'GET', path: '/safety' },
    fields: [{ name: 'handle', kind: 'string', required: true, description: 'Friend handle' }],
    run: (client, input) => client.safetyNumber(String(input.handle)),
  },
  {
    name: 'trustIdentity',
    summary: 'Trust the pending identity change on this device and unblock sending.',
    kind: 'mutation',
    http: { method: 'POST', path: '/trust' },
    fields: [{ name: 'handle', kind: 'string', description: 'Friend handle, when you want to confirm which change you are trusting' }],
    run: (client, input) => client.trustIdentity(optionalString(input.handle)),
  },
  {
    name: 'markVerified',
    summary: 'Record on this device that the safety number was compared and matched.',
    kind: 'mutation',
    http: { method: 'POST', path: '/verified' },
    fields: [{ name: 'handle', kind: 'string', required: true, description: 'Friend handle' }],
    run: (client, input) => client.markVerified(String(input.handle)),
  },
]

export function readInput(operation: Operation, raw: Record<string, unknown>) {
  const input: Record<string, unknown> = {}
  for (const field of operation.fields) {
    const value = raw[field.name]
    if (value == null || value === '') {
      if (field.required) throw new HeadlessError(`${field.name} is required`, 'invalid')
      continue
    }
    if (field.kind === 'int') {
      const parsed = Number(value)
      if (!Number.isSafeInteger(parsed)) throw new HeadlessError(`${field.name} must be an integer`, 'invalid')
      input[field.name] = parsed
    }
    else if (field.kind === 'boolean') {
      if (![true, false, 'true', 'false', '1', '0'].includes(value as never)) throw new HeadlessError(`${field.name} must be a boolean`, 'invalid')
      input[field.name] = value === true || value === 'true' || value === '1'
    }
    else if (field.kind === 'stringList') input[field.name] = asList(value)
    else input[field.name] = String(value)
  }
  return input
}

export function findOperation(name: string) {
  const operation = operations.find((item) => item.name === name)
  if (!operation) throw new HeadlessError(`Unknown operation ${name}`, 'invalid')
  return operation
}

function optionalString(value: unknown) {
  if (value == null || value === '') return undefined
  return String(value)
}

function optionalInt(value: unknown) {
  if (value == null || value === '') return undefined
  return Number(value)
}

function asList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item))
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
