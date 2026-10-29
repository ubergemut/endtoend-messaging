import assert from 'node:assert/strict'
import test from 'node:test'
import { LEGACY_OPERATIONS, OPERATIONS, isAgentEvent, isAgentRequest, PROTOCOL_VERSION, MESSAGING_PATHS } from '../src/index.ts'

test('v1 retains all 21 legacy operations alongside the complete dispatcher contract', () => {
  assert.equal(PROTOCOL_VERSION, 1)
  assert.equal(LEGACY_OPERATIONS.length, 21)
  assert.equal(new Set(OPERATIONS).size, OPERATIONS.length)
  for (const operation of LEGACY_OPERATIONS) assert.ok(OPERATIONS.includes(operation))
  for (const operation of OPERATIONS) assert.ok(isAgentRequest({ version: 1, requestId: operation, operation, input: {} }))
  assert.equal(MESSAGING_PATHS.bootstrap, '/messaging/v1/session')
})

test('events require the supported version, named event and nonnegative integer revision', () => {
  assert.ok(isAgentEvent({ version: 1, event: 'revoked', revision: 0, accountId: null }))
  for (const change of [{ version: 2 }, { event: 'anything' }, { revision: -1 }, { revision: 0.5 }, { reason: {} }])
    assert.equal(isAgentEvent({ version: 1, event: 'views', revision: 4, ...change }), false)
})
