import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { randomUUID } from 'node:crypto'

const require = createRequire(import.meta.url)
const signal = require('../pkg-node/e2ee_crypto.js')

function account(id) {
  const generated = JSON.parse(signal.generate_account(id))
  return { id, store: JSON.stringify(generated.store), bundle: generated.bundle }
}

function encrypt(store, from, to, text) {
  const result = JSON.parse(signal.encrypt_message(store, from, to, text))
  return { store: JSON.stringify(result.store), ciphertext: result.ciphertext }
}

function decrypt(store, local, remote, ciphertext) {
  const result = JSON.parse(signal.decrypt_message(store, local, remote, ciphertext))
  return { store: JSON.stringify(result.store), plaintext: result.plaintext }
}

test('PQXDH session round trip hides plaintext from a third account', () => {
  const alice = account('alice')
  const bob = account('bob')
  const eve = account('eve')
  assert.equal(JSON.stringify(alice.bundle).includes(JSON.parse(alice.store).identity_key_pair), false)

  let aliceStore = signal.establish_session(alice.store, alice.id, bob.id, JSON.stringify(bob.bundle))
  const secret = 'swordfish secret phrase'
  const sent = encrypt(aliceStore, alice.id, bob.id, secret)
  aliceStore = sent.store
  const opened = decrypt(bob.store, bob.id, alice.id, sent.ciphertext)
  assert.equal(opened.plaintext, secret)
  assert.throws(() => decrypt(eve.store, eve.id, alice.id, sent.ciphertext))
  assert.equal(sent.ciphertext.includes(secret), false)
})

test('advancing the ratchet retires the previous message key', () => {
  const alice = account('alice-ratchet')
  const bob = account('bob-ratchet')
  let aliceStore = signal.establish_session(alice.store, alice.id, bob.id, JSON.stringify(bob.bundle))
  const first = encrypt(aliceStore, alice.id, bob.id, 'one')
  const second = encrypt(first.store, alice.id, bob.id, 'two')
  const third = encrypt(second.store, alice.id, bob.id, 'three')
  const afterOne = decrypt(bob.store, bob.id, alice.id, first.ciphertext)
  assert.equal(afterOne.plaintext, 'one')
  assert.throws(() => decrypt(afterOne.store, bob.id, alice.id, first.ciphertext))
  const afterTwo = decrypt(afterOne.store, bob.id, alice.id, second.ciphertext)
  assert.equal(afterTwo.plaintext, 'two')
  assert.throws(() => decrypt(afterTwo.store, bob.id, alice.id, first.ciphertext))
  assert.throws(() => decrypt(afterTwo.store, bob.id, alice.id, second.ciphertext))
  const afterThree = decrypt(afterTwo.store, bob.id, alice.id, third.ciphertext)
  assert.equal(afterThree.plaintext, 'three')
  assert.throws(() => decrypt(afterThree.store, bob.id, alice.id, third.ciphertext))
})

test('identity replacement changes the safety number and blocks a new session until trusted', () => {
  const alice = account('alice-safety')
  const bob = account('bob-safety')
  const aliceStore = signal.establish_session(alice.store, alice.id, bob.id, JSON.stringify(bob.bundle))
  const firstNumber = signal.safety_number(aliceStore, alice.id, bob.id, bob.bundle.identityKey)
  const bobAgain = account('bob-safety')
  assert.notEqual(signal.safety_number(aliceStore, alice.id, bob.id, bobAgain.bundle.identityKey), firstNumber)
  assert.throws(() =>
    signal.establish_session(aliceStore, alice.id, bob.id, JSON.stringify(bobAgain.bundle))
  )
  const trusted = signal.trust_identity(aliceStore, bob.id, bobAgain.bundle.identityKey)
  const resumed = signal.establish_session(trusted, alice.id, bob.id, JSON.stringify(bobAgain.bundle))
  const sent = encrypt(resumed, alice.id, bob.id, 'after trust')
  assert.equal(decrypt(bobAgain.store, bob.id, alice.id, sent.ciphertext).plaintext, 'after trust')
})

test('removed group member cannot decrypt the next sender-key message', () => {
  const alice = account('alice-group')
  const bob = account('bob-group')
  const carol = account('carol-group')
  const distributionId = randomUUID()
  const created = JSON.parse(signal.create_sender_key(alice.store, alice.id, distributionId))
  let bobStore = signal.process_sender_key(bob.store, alice.id, created.distribution)
  const carolStore = signal.process_sender_key(carol.store, alice.id, created.distribution)
  const first = JSON.parse(signal.group_encrypt_message(JSON.stringify(created.store), alice.id, distributionId, 'group secret'))
  assert.equal(JSON.parse(signal.group_decrypt_message(bobStore, alice.id, first.ciphertext)).plaintext, 'group secret')
  assert.equal(JSON.parse(signal.group_decrypt_message(carolStore, alice.id, first.ciphertext)).plaintext, 'group secret')

  const nextId = randomUUID()
  const rotated = JSON.parse(signal.create_sender_key(JSON.stringify(first.store), alice.id, nextId))
  bobStore = signal.process_sender_key(bobStore, alice.id, rotated.distribution)
  const second = JSON.parse(signal.group_encrypt_message(JSON.stringify(rotated.store), alice.id, nextId, 'after remove'))
  assert.throws(() => signal.group_decrypt_message(carolStore, alice.id, second.ciphertext))
  assert.equal(JSON.parse(signal.group_decrypt_message(bobStore, alice.id, second.ciphertext)).plaintext, 'after remove')
})

test('friend-request note is sealed to the recipient identity key', () => {
  const alice = account('alice-note')
  const bob = account('bob-note')
  const eve = account('eve-note')
  const note = 'meet me by the oak tree'
  const sealed = signal.seal_note(bob.bundle.identityKey, note)
  assert.equal(sealed.includes(note), false)
  assert.equal(signal.open_note(bob.store, sealed), note)
  assert.throws(() => signal.open_note(eve.store, sealed))
  assert.throws(() => signal.open_note(alice.store, sealed))
})
