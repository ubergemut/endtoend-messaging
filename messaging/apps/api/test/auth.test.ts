import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { call, listen, password, register, type Started } from './helpers.ts'

describe('accounts', { concurrency: 1 }, () => {
  let server: Started

  before(async () => {
    server = await listen()
  })

  after(async () => {
    await server.close()
  })

  test('register and login create a session', async () => {
    const created = await register(server.baseUrl, 'ada')
    assert.equal(created.account.handle, 'ada')
    const login = await call(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { handle: 'Ada', password },
    })
    assert.equal(login.status, 200)
    assert.equal(login.body.account.id, created.account.id)
    assert.equal(typeof login.body.token, 'string')
  })

  test('duplicate handle is rejected', async () => {
    const again = await call(server.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { handle: 'ada', password, displayName: 'ada' },
    })
    assert.equal(again.status, 409)
  })

  test('a short handle or password is rejected', async () => {
    const handle = await call(server.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { handle: 'ab', password, displayName: 'ab' },
    })
    assert.equal(handle.status, 400)
    const short = await call(server.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { handle: 'validname', password: 'tiny', displayName: 'validname' },
    })
    assert.equal(short.status, 400)
  })

  test('handle lookup reports whether an account exists', async () => {
    const found = await call(server.baseUrl, '/api/auth/handle?handle=Ada')
    assert.equal(found.status, 200)
    assert.equal(found.body.exists, true)
    const missing = await call(server.baseUrl, '/api/auth/handle?handle=ida_missing')
    assert.equal(missing.status, 200)
    assert.equal(missing.body.exists, false)
    const bad = await call(server.baseUrl, '/api/auth/handle?handle=ab')
    assert.equal(bad.status, 400)
  })

  test('the wrong password and a missing token are rejected', async () => {
    const wrong = await call(server.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { handle: 'ada', password: 'not-the-password' },
    })
    assert.equal(wrong.status, 401)
    const missing = await call(server.baseUrl, '/api/friends')
    assert.equal(missing.status, 401)
  })
})
