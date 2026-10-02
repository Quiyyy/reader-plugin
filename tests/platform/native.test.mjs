import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { zipSync, strToU8 } from 'fflate';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const run = promisify(execFile);
const script = name => join(root, 'scripts', name);
const environment = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));

async function sandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), 'Reader 原生 测试 '));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  return dir;
}
async function connect(config, cwd, env = environment) {
  const transport = new StdioClientTransport({ ...config, cwd, env: { ...env, ...config.env }, stderr: 'pipe' });
  const client = new Client({ name: 'reader-native-regression', version: '1.0.0' });
  try { await client.connect(transport); }
  catch (error) { await transport.close(); throw error; }
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.deepEqual(result.content, []);
  return result._meta.reader;
}
async function upload(client, filename, bytes) {
  const { uploadId } = await call(client, 'reader_import_begin', { filename, size: bytes.length });
  const half = Math.ceil(bytes.length / 2);
  for (const [index, part] of [bytes.subarray(0, half), bytes.subarray(half)].entries()) {
    await call(client, 'reader_import_chunk', { uploadId, index, data: Buffer.from(part).toString('base64') });
  }
  return call(client, 'reader_import_finish', { uploadId });
}
function epub() {
  return Buffer.from(zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    'book.opf': strToU8('<package><metadata><title>跨平台书页</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>'),
    'one.xhtml': strToU8('<html><body><h1>第一章</h1><p>这是原创测试内容。</p><p>重新启动后仍然可以接着读。</p></body></html>'),
  }));
}

test('generated local marketplace preserves native paths and never overwrites an existing destination', { timeout: 30000 }, async t => {
  const dir = await sandbox(t), output = join(dir, '插件 市场'), data = join(dir, '书库 数据');
  const codexHome = join(dir, 'Codex 设置'); await mkdir(codexHome);
  const sentinel = 'existing-setting = true\n'; await writeFile(join(codexHome, 'config.toml'), sentinel);
  const env = { ...environment, CODEX_HOME: codexHome };
  await run(process.execPath, [script('validate-plugin.mjs')], { cwd: dir, env });
  await run(process.execPath, [script('prepare-local-plugin.mjs'), '--output', output, '--data-dir', data], { cwd: dir, env });
  const marketplace = JSON.parse(await readFile(join(output, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  assert.equal(marketplace.name, 'reader-local');
  assert.equal(marketplace.interface.displayName, 'Reader');
  const pluginRoot = join(output, marketplace.plugins[0].source.path);
  const manifest = JSON.parse(await readFile(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const config = JSON.parse(await readFile(join(pluginRoot, '.mcp.json'), 'utf8')).mcpServers.reader;
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.interface.displayName, 'Reader');
  assert.equal(config.command, process.execPath);
  assert.deepEqual(config.args, [join(root, 'dist', 'server', 'index.js')]);
  assert.equal(config.env.READER_DATA_DIR, data);
  const client = await connect(config, dir);
  try { assert.deepEqual((await call(client, 'reader_list')).books, []); } finally { await client.close(); }
  await assert.rejects(run(process.execPath, [script('prepare-local-plugin.mjs'), '--output', output], { env }), /EEXIST/);
  await assert.rejects(run(process.execPath, [script('local-mcp-config.mjs'), '--data-dir', 'relative-library'], { env }), /absolute path/);
  assert.equal(await readFile(join(codexHome, 'config.toml'), 'utf8'), sentinel);
});

test('native stdio imports TXT/EPUB and preserves sources, progress, bookmarks and settings across real process restarts', { timeout: 45000 }, async t => {
  const dir = await sandbox(t), data = join(dir, '书库 长期保存'), files = join(dir, '输入 小说');
  await mkdir(files);
  const specimens = [
    ['原创 小说.TXT', Buffer.from('第一章 出发\r\n\r\n这是第一段原创测试。\r\n\r\n下一页仍然安静。', 'utf8')],
    ['原生 书页.EPUB', epub()],
  ];
  for (const [name, bytes] of specimens) await writeFile(join(files, name), bytes);
  const printed = await run(process.execPath, [script('local-mcp-config.mjs'), '--data-dir', data], { cwd: dir });
  const config = JSON.parse(printed.stdout).mcpServers.reader;
  let client = await connect(config, dir);
  const saved = [];
  let settings;
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.find(tool => tool.name === 'reader_open').title, 'Reader');
    assert.equal(tools.find(tool => tool.name === 'reader_open_file').title, 'Reader');
    assert.equal((await client.listResources()).resources[0].name, 'Reader');
    assert.deepEqual(tools.find(tool => tool.name === 'reader_open')._meta['openai/ui'].entrypoints, [{ type: 'global' }, { type: 'thread' }]);
    assert.deepEqual(tools.find(tool => tool.name === 'reader_open_file')._meta['openai/ui'].entrypoints[0].extensions, ['.txt', '.epub']);
    const resource = await client.readResource({ uri: `ui://reader/v${pkg.version}/bookshelf.html` });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.ok(resource.contents[0].text.includes('<html'));
    settings = { ...(await call(client, 'reader_list')).settings, theme: 'sepia', fontSize: 24 };
    for (const [name] of specimens) {
      const bytes = await readFile(join(files, name));
      const book = await upload(client, basename(name), bytes);
      const id = book.summary.id, locator = { chapter: 0, paragraph: 2 };
      const summary = await call(client, 'reader_progress', { id, locator });
      assert.ok(summary.progress > 0);
      await call(client, 'reader_bookmark_add', { id, locator, label: '重新打开的位置' });
      saved.push({ id, locator, progress: summary.progress, bytes, extension: book.summary.format });
    }
    await call(client, 'reader_settings', { settings });
  } finally { await client.close(); }
  client = await connect(config, files); // Different cwd must still use the same explicit data directory.
  try {
    const state = await call(client, 'reader_list');
    assert.equal(state.books.length, 2); assert.deepEqual(state.settings, settings);
    for (const expected of saved) {
      const book = await call(client, 'reader_get', { id: expected.id });
      assert.deepEqual(book.summary.locator, expected.locator);
      assert.equal(book.summary.progress, expected.progress);
      assert.deepEqual(book.bookmarks[0].locator, expected.locator);
      assert.equal(book.bookmarks[0].label, '重新打开的位置');
      assert.deepEqual(await readFile(join(data, 'books', expected.id, `source.${expected.extension}`)), expected.bytes);
      const duplicate = await upload(client, `副本.${expected.extension}`, expected.bytes);
      assert.deepEqual(duplicate.summary.locator, expected.locator);
      assert.equal(duplicate.bookmarks.length, 1);
    }
    assert.deepEqual(await readdir(join(data, '.locks')), []);
  } finally { await client.close(); }
});

test('Windows default storage is LOCALAPPDATA/Reader and survives a new process without an override',
  { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
    const dir = await sandbox(t), local = join(dir, '本地 App Data');
    const env = { ...environment, LOCALAPPDATA: local }; delete env.READER_DATA_DIR;
    const config = { command: process.execPath, args: [join(root, 'dist', 'server', 'index.js')] };
    let client = await connect(config, dir, env); let id;
    try { id = (await upload(client, '默认目录.txt', Buffer.from('第一章\n\n原生 Windows 默认书库。'))).summary.id; }
    finally { await client.close(); }
    client = await connect(config, dir, env);
    try {
      assert.equal((await call(client, 'reader_list')).books[0].id, id);
      const record = JSON.parse(await readFile(join(local, 'Reader', 'books', id, 'record.json'), 'utf8'));
      assert.equal(record.summary.id, id);
    } finally { await client.close(); }
  });
