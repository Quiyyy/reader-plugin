import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { filesUnder, supportedNode } from '../../distribution/installer.mjs';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const version = JSON.parse(await fs.readFile(join(repo, 'package.json'), 'utf8')).version;
const archive = resolve(process.env.READER_RUNTIME_ARCHIVE ?? join(repo, 'artifacts/releases', `reader-${version}-runtime.zip`));
const legacyArchive = resolve(process.env.READER_LEGACY_ARCHIVE ?? join(repo, 'artifacts/releases/reader-0.1.2-test-fixture.zip'));
const environment = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
// The package processes get no PATH, npm, NODE_PATH or injected Node loader.
const runtimeEnvironment = { ...environment, PATH: '', NODE_PATH: '', NODE_OPTIONS: '' };
const catalogPath = root => join(root, '.agents', 'plugins', 'marketplace.json');
let base, unpacked, oldUnpacked;

async function extract(input, destination) {
  const checksum = (await fs.readFile(`${input}.sha256`, 'utf8')).trim().split(/\s+/)[0];
  assert.equal(createHash('sha256').update(await fs.readFile(input)).digest('hex'), checksum);
  await fs.mkdir(destination);
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:READER_TEST_ARCHIVE, $env:READER_TEST_EXTRACT)'],
    { env: { ...environment, READER_TEST_ARCHIVE: input, READER_TEST_EXTRACT: destination }, timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  } else {
    await run('unzip', ['-q', input, '-d', destination], { timeout: 180000 });
  }
  const names = await fs.readdir(destination);
  assert.equal(names.length, 1);
  return join(destination, names[0]);
}
before(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'Reader 免编译 验收 '));
  unpacked = await extract(archive, join(base, '当前 下载 中文'));
  oldUnpacked = await extract(legacyArchive, join(base, '旧版 下载 中文'));
  const legacy = JSON.parse(await fs.readFile(join(oldUnpacked, 'package-manifest.json'), 'utf8'));
  assert.equal(legacy.version, '0.1.2'); assert.equal(legacy.source.commit, 'f398d0ddffc158e6f5282e77abac9cb11f1bb37a');
  assert.equal(legacy.source.dirty, false); assert.equal(legacy.testFixture, true);
  const current = JSON.parse(await fs.readFile(join(unpacked, 'package-manifest.json'), 'utf8'));
  assert.equal(current.testFixture, false);
  if (process.env.CI) {
    assert.equal(current.source.dirty, false);
    assert.equal(current.source.commit, process.env.GITHUB_SHA);
  }
});
after(async () => { if (base) await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

async function setup(root, args = []) {
  const result = await run(process.execPath, [join(root, 'setup.mjs'), ...args], { cwd: base, env: runtimeEnvironment, timeout: 180000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout);
}
async function configuration(install) {
  const catalog = JSON.parse(await fs.readFile(catalogPath(install), 'utf8'));
  assert.equal(catalog.name, 'reader-local'); assert.equal(catalog.plugins.length, 1);
  const plugin = join(install, catalog.plugins[0].source.path);
  return JSON.parse(await fs.readFile(join(plugin, '.mcp.json'), 'utf8')).mcpServers.reader;
}
async function clientFor(config) {
  assert.equal(config.command, process.execPath);
  assert.equal(config.args.length, 1);
  const transport = new StdioClientTransport({ ...config, cwd: base, env: { ...runtimeEnvironment, ...config.env }, stderr: 'pipe' });
  const client = new Client({ name: 'reader-runtime-acceptance', version: '1.0.0' });
  try { await client.connect(transport); } catch (error) { await transport.close(); throw error; }
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result._meta.reader;
}
function epub() {
  return Buffer.from(zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    'book.opf': strToU8('<package><metadata><title>发行验收原创书页</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>'),
    'one.xhtml': strToU8('<html><body><h1>第一章</h1><p>这是原创发行验收段落。</p><p>旧位置不会因升级而消失。</p></body></html>'),
  }));
}
async function fillLibrary(client) {
  const books = [];
  for (const [filename, bytes] of [['中文 空格.TXT', Buffer.from('第一章\r\n\r\n一段原创测试。\r\n\r\n读到这里再继续。')], ['原生 小说.EPUB', epub()]]) {
    const { uploadId } = await call(client, 'reader_import_begin', { filename, size: bytes.length });
    await call(client, 'reader_import_chunk', { uploadId, index: 0, data: bytes.toString('base64') });
    const book = await call(client, 'reader_import_finish', { uploadId });
    const id = book.summary.id, locator = { chapter: 0, paragraph: 2 };
    const summary = await call(client, 'reader_progress', { id, locator });
    await call(client, 'reader_bookmark_add', { id, locator, label: '保留这个书签' });
    books.push({ id, locator, progress: summary.progress, bytes, format: book.summary.format });
  }
  const settings = { ...(await call(client, 'reader_list')).settings, theme: 'sepia', fontSize: 24 };
  await call(client, 'reader_settings', { settings });
  return { books, settings };
}
async function verifyReading(client, saved, expectedVersion, dataDir) {
  const tools = (await client.listTools()).tools;
  const uri = tools.find(tool => tool.name === 'reader_open')._meta.ui.resourceUri;
  assert.equal(uri, `ui://reader/v${expectedVersion}/bookshelf.html`);
  assert.ok((await client.readResource({ uri })).contents[0].text.includes('<html'));
  const state = await call(client, 'reader_list');
  assert.equal(state.books.length, 2); assert.deepEqual(state.settings, saved.settings);
  for (const expected of saved.books) {
    const book = await call(client, 'reader_get', { id: expected.id });
    assert.deepEqual(book.summary.locator, expected.locator); assert.equal(book.summary.progress, expected.progress);
    assert.equal(book.bookmarks[0].label, '保留这个书签'); assert.deepEqual(book.bookmarks[0].locator, expected.locator);
    assert.deepEqual(await fs.readFile(join(dataDir, 'books', expected.id, `source.${expected.format}`)), expected.bytes);
  }
}
async function snapshot(root) {
  const output = {};
  for (const name of await filesUnder(root)) output[name] = createHash('sha256').update(await fs.readFile(join(root, name))).digest('hex');
  return output;
}

test('Node compatibility matches the documented supported major versions', () => {
  for (const number of ['22.12.0', '22.23.3', '24.0.0', '26.0.0']) assert.equal(supportedNode(number), true);
  for (const number of ['18.20.0', '20.19.0', '22.11.0', '23.0.0', '25.8.0']) assert.equal(supportedNode(number), false);
});

test('clean extracted runtime installs with no npm/PATH, survives removal of the download, and repeat setup preserves data', { timeout: 300000 }, async () => {
  const install = join(base, '程序 安装'), data = join(base, '书库 数据');
  const args = ['--install-dir', install, '--data-dir', data];
  const result = await setup(unpacked, args); assert.equal(result.status, 'installed');
  let client = await clientFor(await configuration(install)); let saved;
  try { saved = await fillLibrary(client); await verifyReading(client, saved, version, data); } finally { await client.close(); }
  const before = await snapshot(data), catalogBefore = await fs.readFile(catalogPath(install));
  assert.equal((await setup(unpacked, args)).status, 'unchanged');
  assert.deepEqual(await snapshot(data), before); assert.deepEqual(await fs.readFile(catalogPath(install)), catalogBefore);
  const detached = `${unpacked}-removed`;
  await fs.rename(unpacked, detached);
  try {
    client = await clientFor(await configuration(install));
    try { await verifyReading(client, saved, version, data); } finally { await client.close(); }
  } finally { await fs.rename(detached, unpacked); }

  // A crash lock is archived only after the exact originating process has exited.
  const exitedPid = Number((await run(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])).stdout);
  await fs.writeFile(join(install, '.setup-lock'), JSON.stringify({ pid: exitedPid, token: 'fixture' }));
  await assert.rejects(setup(unpacked, args), /already locked/);
  assert.equal((await setup(unpacked, [...args, '--recover-lock'])).status, 'unchanged');
  assert.ok((await fs.readdir(join(install, 'backups'))).some(name => name.startsWith('stale-lock-')));

  // Preserve unknown directories, changed catalogs and altered plugin settings.
  const unknown = join(base, '已有目录'); await fs.mkdir(unknown); await fs.writeFile(join(unknown, 'keep.json'), '{"keep":true}');
  await assert.rejects(setup(unpacked, ['--install-dir', unknown, '--data-dir', data]), /without a Reader ownership record/);
  assert.equal(await fs.readFile(join(unknown, 'keep.json'), 'utf8'), '{"keep":true}');
  await fs.writeFile(catalogPath(install), '{"name":"someone-else","plugins":[]}');
  await assert.rejects(setup(unpacked, args), /modified or contains unknown/);
  assert.equal(await fs.readFile(catalogPath(install), 'utf8'), '{"name":"someone-else","plugins":[]}');
  await fs.writeFile(catalogPath(install), catalogBefore);
  const configPath = join(install, 'versions', version, 'plugin', '.mcp.json');
  const originalConfig = await fs.readFile(configPath);
  await fs.writeFile(configPath, '{"unknown":true}');
  await assert.rejects(setup(unpacked, args), /configuration was modified/);
  assert.equal(await fs.readFile(configPath, 'utf8'), '{"unknown":true}');
  await fs.writeFile(configPath, originalConfig);
  await assert.rejects(setup(unpacked, ['--install-dir', install, '--data-dir', join(base, 'other data')]), /different library/);
  const serverPath = join(unpacked, 'runtime', 'dist', 'server', 'index.js'), originalServer = await fs.readFile(serverPath);
  await fs.appendFile(serverPath, '\n// corrupted download\n');
  try { await assert.rejects(setup(unpacked, args), /checksum mismatch/); }
  finally { await fs.writeFile(serverPath, originalServer); }
});

test('real 0.1.2 library upgrades and rolls back without rewriting progress, bookmarks, originals or old configuration', { timeout: 300000 }, async () => {
  const install = join(base, '升级 稳定目录'), data = join(base, '升级 书库');
  const args = ['--install-dir', install, '--data-dir', data];
  await setup(oldUnpacked, args); // Historical server + current installer test fixture; never a released 0.1.2 runtime.
  const oldConfig = await configuration(install);
  const legacyConfig = join(base, 'old-0.1.2-mcp.json'); await fs.writeFile(legacyConfig, JSON.stringify(oldConfig));
  let client = await clientFor(oldConfig), saved;
  try { saved = await fillLibrary(client); await verifyReading(client, saved, '0.1.2', data); } finally { await client.close(); }
  const before = await snapshot(data), oldWrapper = await fs.readFile(legacyConfig);
  const upgraded = await setup(unpacked, ['--install-dir', install]);
  assert.equal(upgraded.previousVersion, '0.1.2'); assert.equal(upgraded.version, version);
  assert.deepEqual(upgraded.retainedVersions.sort(), ['0.1.2', version].sort());
  assert.ok(upgraded.backup); assert.ok((await fs.readFile(upgraded.backup, 'utf8')).includes('versions/0.1.2/plugin'));
  assert.deepEqual(await snapshot(data), before); assert.deepEqual(await fs.readFile(legacyConfig), oldWrapper);
  client = await clientFor(await configuration(install));
  try { await verifyReading(client, saved, version, data); } finally { await client.close(); }
  const beforeRollback = await snapshot(data);
  const rollback = await setup(unpacked, ['--install-dir', install, '--rollback', '0.1.2']);
  assert.equal(rollback.status, 'rolled-back'); assert.deepEqual(await snapshot(data), beforeRollback);
  client = await clientFor(await configuration(install));
  try { await verifyReading(client, saved, '0.1.2', data); } finally { await client.close(); }
  await setup(unpacked, ['--install-dir', install]);
  await assert.rejects(setup(oldUnpacked, args), /newer version is active/);
});
