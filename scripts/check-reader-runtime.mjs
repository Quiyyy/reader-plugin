// Local package smoke test, never installs into a real plugin or library.
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { verifyPackage } from '../distribution/installer.mjs';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const build = JSON.parse(await readFile(`artifacts/releases/reader-${version}-runtime.build.json`, 'utf8'));
await verifyPackage(build.stage);
const runtime = join(build.stage, 'runtime');
const license = await readFile('LICENSE', 'utf8');
assert.equal(await readFile(join(build.stage, 'LICENSE'), 'utf8'), license);
assert.equal(await readFile(join(runtime, 'LICENSE'), 'utf8'), license);
assert.equal(JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8')).license, 'MIT');
assert.equal(await access(join(runtime, 'node_modules/@napi-rs/canvas')).then(() => true, () => false), false);
await mkdir('artifacts/runtime-check', { recursive: true });
const directory = await mkdtemp(join(process.cwd(), 'artifacts/runtime-check/library-'));
const report = { passed: false, version, runtime, directory, nativeCanvas: false, checks: ['Project MIT license and package metadata preserved in the runtime'] };
let client;
async function connect() {
  client = new Client({ name: 'reader-package-check', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(runtime, 'dist/server/index.js')], cwd: directory, env: { ...process.env, PATH: '', NODE_PATH: '', NODE_OPTIONS: '', READER_DATA_DIR: directory }, stderr: 'pipe' }));
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result._meta.reader;
}
function originalPdf() {
  const stream = 'BT /F1 18 Tf 50 730 Td (Reader package original fixture) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.7\n'; const offsets = [];
  for (const [i, object] of objects.entries()) { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const start = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(text);
}
try {
  await connect(); assert.equal(client.getServerVersion().version, version);
  const bytes = originalPdf(), { uploadId } = await call('reader_import_begin', { filename: '运行包原创.pdf', size: bytes.length });
  await call('reader_import_chunk', { uploadId, index: 0, data: bytes.toString('base64') });
  const book = await call('reader_import_finish', { uploadId }), id = book.summary.id;
  assert.match((await call('reader_pdf_text', { id, page: 1 })).text, /package original fixture/);
  await call('reader_pdf_save', { id, page: 1, scroll: .25, scale: 1.2, rotation: 90 });
  const source = await call('reader_source_create', { source: { bookId: id, quote: 'Reader package original fixture', anchor: { kind: 'pdf', page: 1, rectangles: [{ x: .08, y: .1, width: .7, height: .04 }], rotation: 0 } } });
  const note = await call('reader_note_create', { title: '运行包笔记', body: '可在重启后读取。', folderId: null, tags: ['验证'], sourceIds: [source.id], imageIds: [] });
  report.checks.push('Packaged PDF worker extracts text without optional native canvas or development loaders');
  await client.close(); await connect();
  assert.equal((await call('reader_note_get', { id: note.value.id })).body, '可在重启后读取。');
  assert.equal((await call('reader_pdf_open', { id })).rotation, 90);
  assert.equal((await call('reader_source_open', { id: source.id, navigate: false })).available, true);
  report.checks.push('Packaged MCP preserves notes, PDF progress and sources across real process restart');
  report.passed = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally { await client?.close(); await writeFile('artifacts/runtime-check/report.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); }
