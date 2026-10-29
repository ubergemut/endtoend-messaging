// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { safeSdkPath, sdkFiles, verifySdk, verifyLockDerivation } from './package-sdk.mjs'
function fixture(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'endtoend-sdk-package-'))
  const write = (name, content = 'source\n') => { const filename = path.join(directory, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content) }
  try { callback(directory, write) } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('endtoend-sdk-package-'))
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
test('independent SDK inventory excludes installed tools and rejects AGPL, user-state and traversal paths', () => fixture((directory, write) => {
  write('packages/client/src/index.ts'); write('packages/protocol/LICENSE'); write('packages/client/node_modules/tool/index.js')
  assert.deepEqual(sdkFiles(directory).map(row => row.path), ['packages/client/src/index.ts', 'packages/protocol/LICENSE'])
  for (const name of ['../packages/client/src/index.ts', 'C:\\local\\file', 'packages/client/.env', 'packages/client/src/.env.local', 'packages/session/src/index.ts', 'apps/web/src/App.tsx', 'packages/client/test/reference.test.ts', 'node_modules/typescript/index.js'])
    assert.throws(() => safeSdkPath(name))
  assert.equal(safeSdkPath('docs/architecture/BROWSER_CONSUMER_V1.md'), 'docs/architecture/BROWSER_CONSUMER_V1.md')
}))
test('SDK exact manifest fails on byte changes, duplicate entries and unmanifested files', () => fixture((directory, write) => {
  write('packages/client/src/index.ts')
  const manifest = { files: sdkFiles(directory) }
  assert.equal(verifySdk(directory, manifest).passed, true)
  assert.throws(() => verifySdk(directory, { files: [...manifest.files, ...manifest.files] }), /Duplicate/)
  write('packages/client/src/index.ts', 'changed source')
  assert.throws(() => verifySdk(directory, manifest), /changed/)
  write('packages/protocol/src/index.ts')
  assert.throws(() => verifySdk(directory, manifest), /membership/)
}))
test('lock pruning retains exact original resolutions and rejects a version or dependency rewrite', () => {
  const original = '# yarn lockfile v1\n\n"a@^1", a@~1.0:\n  version "1.0.1"\n  resolved "https://example.invalid/a.tgz"\n  integrity sha512-fixture\n  dependencies:\n    b "^2"\n\nb@^2:\n  version "2.0.0"\n  resolved "https://example.invalid/b.tgz"\n'
  const selected = 'a@~1.0:\n  version "1.0.1"\n  resolved "https://example.invalid/a.tgz"\n  integrity sha512-fixture\n  dependencies:\n    b "^2"\n'
  assert.equal(verifyLockDerivation(original, selected).lockedRecords, 1)
  assert.throws(() => verifyLockDerivation(original, selected.replace('1.0.1', '1.0.2')), /changed/)
  assert.throws(() => verifyLockDerivation(original, selected.replace('b "^2"', 'b "^3"')), /changed/)
  assert.throws(() => verifyLockDerivation(original, selected.replace('a@~1.0', 'c@^1')), /changed/)
})
test('SDK inventory refuses an empty non-SDK directory and directory junction', () => fixture((directory, write) => {
  fs.mkdirSync(path.join(directory, 'apps'))
  assert.throws(() => sdkFiles(directory), /Unexpected SDK directory/)
  fs.rmdirSync(path.join(directory, 'apps'))
  write('packages/client/src/index.ts')
  fs.symlinkSync(path.join(directory, 'packages/client/src'), path.join(directory, 'packages/client/examples'), 'junction')
  assert.throws(() => sdkFiles(directory), /symlink/)
}))
