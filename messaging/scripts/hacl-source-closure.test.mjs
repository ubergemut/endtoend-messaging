// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { audit, applyUnifiedPatch, payloadRelative, readTarGz, sha256 } from './hacl-source-closure.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('all supplied source archives and exact HACL-to-shipped-Rust adaptations verify offline', () => {
  const report = audit(root);
  assert.equal(report.passed, true);
  assert.equal(report.rustFilesReconstructed, 25);
  assert.equal(report.macroRuntimeAdaptationReconstructed, true);
  assert.equal(report.archives.find(row => row.id === 'hacl-import').files, 3718);
  assert.equal(report.archives.find(row => row.id === 'hacl-generation').files, 3719);
  assert.equal(report.historicalFstarToRustRegenerationPerformed, false);
});

test('strict adaptation rejects changed source context instead of silently applying a stale patch', () => {
  const patch = 'diff --git a/a.rs b/a.rs\n--- a/a.rs\n+++ b/a.rs\n@@ -1,2 +1,2 @@\n unchanged\n-old\n+new\n';
  assert.equal(applyUnifiedPatch(new Map([['a.rs', Buffer.from('unchanged\nold\n')]]), patch).get('a.rs').toString(), 'unchanged\nnew\n');
  assert.throws(() => applyUnifiedPatch(new Map([['a.rs', Buffer.from('changed\nold\n')]]), patch), /context mismatch/);
});

test('archive parser rejects corrupt supplied archive bytes', () => {
  const bytes = Buffer.from(fs.readFileSync(path.join(root, payloadRelative, 'archives/libcrux-macros-0.0.3.crate')));
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  assert.throws(() => readTarGz(bytes));
});

test('archive parser rejects a traversing member even with a valid tar header checksum', () => {
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(root, payloadRelative, 'archives/libcrux-macros-0.0.3.crate')));
  bytes.fill(0, 0, 100); bytes.write('../outside.rs', 0);
  bytes.fill(32, 148, 156);
  const sum = bytes.subarray(0, 512).reduce((total, byte) => total + byte, 0);
  bytes.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  assert.throws(() => readTarGz(zlib.gzipSync(bytes)), /Unsafe archive path/);
});

test('payload inventory corruption fails before provenance or any source is trusted', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hacl-closure-corrupt-'));
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('hacl-closure-corrupt-'));
  const payload = path.join(temporary, payloadRelative);
  fs.mkdirSync(payload, { recursive: true });
  fs.writeFileSync(path.join(payload, 'source.txt'), 'changed');
  fs.writeFileSync(path.join(payload, 'INVENTORY.json'), JSON.stringify({ files: [{ path: 'source.txt', bytes: 8, sha256: sha256(Buffer.from('original')) }] }));
  try { assert.throws(() => audit(temporary), /Payload hash mismatch/); }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
