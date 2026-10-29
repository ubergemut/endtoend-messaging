// SPDX-License-Identifier: AGPL-3.0-only
// Offline integrity and derivation check for the HACL preferred-source supplement.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const payloadRelative = 'dependencies/preferred-source/hacl-efbf82f-libcrux-hacl-rs-0.0.5';
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blobSha = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const safe = name => {
  assert(name && !name.includes('\\') && !name.startsWith('/') && !/^[A-Za-z]:/.test(name) && !name.split('/').includes('..'), `Unsafe archive path: ${name}`);
  return name.replace(/\/$/, '');
};
const stringAt = (buffer, at, length) => buffer.subarray(at, at + length).toString('utf8').replace(/\0.*$/s, '');

// Read, but never extract or execute, gzip tar members. Preserve symbolic links as
// link text so Git's blob hash can be checked without following a filesystem link.
export function readTarGz(bytes) {
  const tar = zlib.gunzipSync(bytes), files = new Map();
  let pos = 0, local = {}, global = {}, longName;
  while (pos + 512 <= tar.length) {
    const header = tar.subarray(pos, pos + 512);
    if (header.every(byte => byte === 0)) break;
    const expected = parseInt(stringAt(header, 148, 8).trim(), 8);
    const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert(actual === expected, 'Invalid tar header checksum');
    const size = parseInt(stringAt(header, 124, 12).trim() || '0', 8);
    assert(Number.isSafeInteger(size) && size >= 0 && pos + 512 + size <= tar.length, 'Invalid tar member size');
    const type = stringAt(header, 156, 1) || '0';
    const content = tar.subarray(pos + 512, pos + 512 + size);
    pos += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      const attrs = {};
      for (let at = 0; at < content.length;) {
        const space = content.indexOf(32, at), length = Number(content.subarray(at, space).toString());
        assert(space > at && length > space - at && at + length <= content.length, 'Invalid PAX record');
        const record = content.subarray(space + 1, at + length - 1).toString('utf8'), equals = record.indexOf('=');
        attrs[record.slice(0, equals)] = record.slice(equals + 1);
        at += length;
      }
      if (type === 'g') global = { ...global, ...attrs }; else local = attrs;
      continue;
    }
    if (type === 'L') { longName = content.toString('utf8').replace(/\0.*$/s, ''); continue; }
    const attrs = { ...global, ...local };
    const prefix = stringAt(header, 345, 155);
    const name = safe(attrs.path || longName || `${prefix ? prefix + '/' : ''}${stringAt(header, 0, 100)}`);
    local = {}; longName = undefined;
    if (type === '5') continue;
    assert(['0', '2'].includes(type), `Unsupported tar member type ${type}: ${name}`);
    assert(!files.has(name), `Duplicate tar member: ${name}`);
    const data = type === '2' ? Buffer.from(attrs.linkpath || stringAt(header, 157, 100)) : content;
    files.set(name, { data, type: type === '2' ? 'symlink' : 'file' });
  }
  return files;
}

// A strict application of our ordinary unified diff. Every context/deletion line
// must match; no fuzzy patching or external patch program is involved.
export function applyUnifiedPatch(inputs, patch) {
  const outputs = new Map([...inputs].map(([name, data]) => [name, data.toString('utf8')]));
  const lines = patch.split('\n');
  let file, source, result, cursor, previous;
  const finish = () => {
    if (file !== undefined) { result.push(...source.slice(cursor)); outputs.set(file, result.join('\n') + (result.length ? '\n' : '')); }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('+++ b/')) {
      finish(); file = safe(line.slice(6));
      source = (outputs.get(file) || '').split('\n'); if (source.at(-1) === '') source.pop();
      result = []; cursor = 0; previous = 0;
    } else if (line.startsWith('@@ ')) {
      assert(file !== undefined, 'Patch hunk without file');
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      assert(match, 'Invalid patch hunk');
      const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
      const start = Number(match[1]) - (oldCount === 0 ? 0 : 1);
      assert(start >= cursor && start >= previous, `Overlapping patch hunks: ${file}`);
      result.push(...source.slice(cursor, start)); cursor = start;
      let removed = 0, added = 0;
      while (removed < oldCount || added < newCount) {
        const item = lines[++i], kind = item?.[0], value = item?.slice(1);
        assert([' ', '-', '+'].includes(kind), `Malformed patch data: ${file}`);
        if (kind !== '+') { assert(source[cursor] === value, `Patch context mismatch: ${file}:${cursor + 1}`); cursor++; removed++; }
        if (kind !== '-') { result.push(value); added++; }
      }
      assert(removed === oldCount && added === newCount, `Incorrect patch counts: ${file}`);
      previous = cursor;
    }
  }
  finish();
  return new Map([...outputs].map(([name, text]) => [name, Buffer.from(text)]));
}

const walk = (root, prefix = '') => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const name = prefix + entry.name;
  assert(!entry.isSymbolicLink(), `Unexpected local symbolic link: ${name}`);
  return entry.isDirectory() ? walk(path.join(root, entry.name), name + '/') : [name];
}).sort();
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function audit(root, { cargoDir, reconstruct } = {}) {
  const payload = path.join(root, payloadRelative);
  const inventoryBytes = fs.readFileSync(path.join(payload, 'INVENTORY.json'));
  const inventory = JSON.parse(inventoryBytes);
  const names = walk(payload).filter(name => name !== 'INVENTORY.json');
  assert(JSON.stringify(names) === JSON.stringify(inventory.files.map(row => row.path).sort()), 'Payload file inventory differs');
  for (const row of inventory.files) {
    const data = fs.readFileSync(path.join(payload, safe(row.path)));
    assert(data.length === row.bytes && sha256(data) === row.sha256, `Payload hash mismatch: ${row.path}`);
  }
  const provenance = json(path.join(payload, 'PROVENANCE.json'));
  const contents = new Map(), archives = [];
  for (const origin of provenance.archives) {
    const data = fs.readFileSync(path.join(payload, origin.path));
    assert(sha256(data) === origin.sha256, `Pinned archive hash mismatch: ${origin.id}`);
    const tar = readTarGz(data), members = new Map();
    for (const [name, entry] of tar) {
      assert(name.startsWith(origin.prefix + '/'), `Unexpected archive root: ${name}`);
      members.set(name.slice(origin.prefix.length + 1), entry);
    }
    if (origin.treePath) {
      const tree = json(path.join(payload, origin.treePath));
      assert(tree.sha === origin.commit && tree.truncated === false, `Unpinned or truncated Git tree: ${origin.id}`);
      const expected = tree.tree.filter(row => row.type === 'blob');
      assert(expected.length === members.size, `Archive/Git file count differs: ${origin.id}`);
      for (const row of expected) {
        const entry = members.get(row.path);
        assert(entry && blobSha(entry.data) === row.sha && (row.mode === '120000') === (entry.type === 'symlink'), `Git blob mismatch: ${origin.id}/${row.path}`);
      }
    }
    contents.set(origin.id, members);
    archives.push({ id: origin.id, sha256: origin.sha256, files: members.size, gitBlobsVerified: Boolean(origin.treePath) });
  }
  const mappings = json(path.join(payload, 'RUST_MAPPING.json'));
  const imported = contents.get('hacl-import'), generated = contents.get('hacl-generation'), crate = contents.get('crate');
  const libcruxTree = json(path.join(payload, 'origins/libcrux-tree.json'));
  assert(libcruxTree.sha === provenance.libcruxCommit && !libcruxTree.truncated, 'Wrong libcrux source revision');
  const tree = new Map(libcruxTree.tree.map(row => [row.path, row]));
  const inputs = new Map();
  for (const row of mappings) {
    const target = crate.get('src/' + row.target)?.data;
    assert(target && sha256(target) === row.targetSha256, `Crate source mismatch: ${row.target}`);
    assert(blobSha(target) === tree.get('crates/utils/hacl-rs/src/' + row.target)?.sha, `Libcrux Git source mismatch: ${row.target}`);
    const input = row.source ? imported.get(row.source)?.data : Buffer.alloc(0);
    assert(input && sha256(input) === row.sourceSha256, `HACL source mismatch: ${row.target}`);
    if (row.source) assert(input.equals(generated.get(row.source)?.data), `Rust generation/import snapshots differ: ${row.source}`);
    for (const preferred of row.preferredInputs || []) assert(imported.has(preferred) && generated.has(preferred), `Preferred input missing: ${preferred}`);
    inputs.set(row.target, input);
  }
  const allRust = [...crate.keys()].filter(name => name.startsWith('src/') && name.endsWith('.rs')).sort();
  assert(JSON.stringify(allRust) === JSON.stringify(mappings.map(row => 'src/' + row.target).sort()), 'Unmapped Rust source in exact crate');
  const restored = applyUnifiedPatch(inputs, fs.readFileSync(path.join(payload, 'hacl-to-libcrux.patch'), 'utf8'));
  for (const [name, bytes] of restored) assert(bytes.equals(crate.get('src/' + name).data), `Reconstruction differs from shipped Rust: ${name}`);
  const macros = contents.get('macros');
  const macroVcs = JSON.parse(macros.get('.cargo_vcs_info.json').data);
  assert(macroVcs.git.sha1 === provenance.macroCommit && macroVcs.path_in_vcs === 'macros', 'Macro crate Git provenance mismatch');
  const macroTree = json(path.join(payload, 'origins/macros-tree.json'));
  assert(macroTree.sha === provenance.macroCommit && !macroTree.truncated, 'Wrong macro source revision');
  const macroSource = macros.get('src/lib.rs').data;
  assert(blobSha(macroSource) === macroTree.tree.find(row => row.path === 'macros/src/lib.rs')?.sha, 'Macro Git source mismatch');
  const macroRestored = applyUnifiedPatch(new Map([['lib.rs', imported.get('dist/rs/krml/src/lib.rs').data]]), fs.readFileSync(path.join(payload, 'hacl-krml-to-libcrux-macros.patch'), 'utf8'));
  assert(macroRestored.get('lib.rs').equals(macroSource), 'HACL unrolling macro adaptation differs from published macro crate');
  const required = [
    'Makefile', 'Makefile.common', 'Makefile.include', 'Makefile.local',
    'dist/LICENSE.txt', 'LICENSE', 'lib/Lib.IntTypes.fst',
    'code/curve25519/Hacl.Impl.Curve25519.Field51.fst',
  ];
  for (const name of required) assert(imported.has(name) && generated.has(name), `Generation input missing: ${name}`);
  for (const id of ['fstar-reference', 'fstar-latest-reference']) {
    for (const name of ['ulib/LowStar.Endianness.fst', 'ulib/FStar.UInt128.fst', 'ulib/FStar.UInt128.fsti', 'ulib/FStar.UInt64.fst']) assert(contents.get(id).has(name), `Standard-library preferred input missing: ${id}/${name}`);
  }
  for (const id of ['karamel-recorded', 'karamel-latest-reference', 'karamel-contemporary']) {
    for (const name of ['lib/AstToMiniRust.ml', 'lib/OutputRust.ml', 'lib/PrintMiniRust.ml', 'lib/OptimizeMiniRust.ml']) assert(contents.get(id).has(name), `Rust generator source missing: ${id}/${name}`);
  }
  const vcs = JSON.parse(crate.get('.cargo_vcs_info.json').data);
  assert(vcs.git.sha1 === provenance.libcruxCommit && vcs.path_in_vcs === 'crates/utils/hacl-rs', 'Crate Git provenance mismatch');
  const lockPath = path.join(root, 'packages/crypto/Cargo.lock');
  if (fs.existsSync(lockPath)) {
    const lock = fs.readFileSync(lockPath, 'utf8');
    for (const [name, version, id] of [['libcrux-hacl-rs', '0.0.5', 'crate'], ['libcrux-macros', '0.0.3', 'macros']]) {
      const paragraph = lock.split('[[package]]').find(text => text.includes(`name = "${name}"\n`) && text.includes(`version = "${version}"\n`));
      assert(paragraph?.includes(`checksum = "${provenance.archives.find(row => row.id === id).sha256}"`), `Cargo.lock checksum differs: ${name}`);
    }
  }
  if (cargoDir) {
    for (const [name, bytes] of restored) assert(fs.readFileSync(path.join(cargoDir, 'libcrux-hacl-rs-0.0.5/src', name)).equals(bytes), `Vendored source differs: ${name}`);
    for (const [name, entry] of contents.get('macros')) if (name.startsWith('src/')) assert(fs.readFileSync(path.join(cargoDir, 'libcrux-macros-0.0.3', name)).equals(entry.data), `Vendored macro source differs: ${name}`);
  }
  if (reconstruct) {
    assert(!fs.existsSync(reconstruct), 'Reconstruction destination must not exist');
    for (const [name, entry] of crate) {
      assert(entry.type === 'file', 'Crate source contains unexpected symbolic link');
      const destination = path.join(reconstruct, safe(name));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, name.startsWith('src/') ? restored.get(name.slice(4)) : entry.data);
    }
  }
  return {
    schema: 1, passed: true, checkedAt: new Date().toISOString(),
    payload: payloadRelative, inventorySha256: sha256(inventoryBytes), archives,
    crate: 'libcrux-hacl-rs@0.0.5', rustFilesReconstructed: restored.size,
    macroRuntimeAdaptationReconstructed: true,
    exactImportedAndGeneratedRustMatch: true, exactPublishedCrateMatch: true,
    vendoredSourceCompared: Boolean(cargoDir), sourcePayloadFilesVerified: inventory.files.length,
    historicalFstarToRustRegenerationPerformed: false,
    limitations: ['The original Rust generation did not record exact F*/KaRaMeL executable revisions. Included C-generation pins and contemporaneous compiler source are explicitly distinguished in PROVENANCE.json.', 'This check proves source availability, immutable provenance and exact HACL-output-to-published-Rust reconstruction; it does not claim a rerun of F* proofs or Low*/F*-to-Rust extraction.'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const root = path.resolve(value('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  try {
    const report = audit(root, { cargoDir: value('--cargo-dir'), reconstruct: value('--reconstruct') });
    if (value('--report')) fs.writeFileSync(path.resolve(value('--report')), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const report = { schema: 1, passed: false, checkedAt: new Date().toISOString(), error: error.message };
    if (value('--report')) fs.writeFileSync(path.resolve(value('--report')), JSON.stringify(report, null, 2) + '\n');
    console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
  }
}
