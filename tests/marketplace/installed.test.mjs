import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { zipSync, strToU8 } from 'fflate';

const run = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const target = `${process.platform}-${process.arch}`;
const id = `reader-${target}`;
const cli = process.env.READER_TEST_CODEX;
assert.ok(cli && resolve(cli) === cli, 'READER_TEST_CODEX must name the real official CLI executable.');
const current = join(root, 'artifacts/marketplace', target);
const fixture = join(root, 'artifacts/marketplace', `${target}-fixture`);
const remote = process.env.READER_TEST_REMOTE === '1';
const publication = remote ? JSON.parse(await fs.readFile(join(root, 'artifacts/publication.json'), 'utf8')) : null;
const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'Reader 无 Node 市场 验收 ')));
const home = join(base, '隔离 Codex'), cwd = join(base, '空 工作目录'), osHome = join(base, '隔离 用户'), market = join(base, 'marketplace');
const defaults = { HOME: osHome, USERPROFILE: osHome, LOCALAPPDATA: join(osHome, 'AppData', 'Local'), APPDATA: join(osHome, 'AppData', 'Roaming'), XDG_DATA_HOME: join(osHome, '.local', 'share') };
const data = remote ? (process.platform === 'darwin' ? join(osHome, 'Library', 'Application Support', 'Reader') : process.platform === 'win32' ? join(defaults.LOCALAPPDATA, 'Reader') : join(defaults.XDG_DATA_HOME, 'reader-plugin')) : join(base, '持久 书库');
await fs.mkdir(home); await fs.mkdir(cwd); await fs.mkdir(join(market, '.agents/plugins'), { recursive: true });
await fs.mkdir(osHome);
const env = { ...process.env, ...defaults, CODEX_HOME: home, NODE_OPTIONS: '', NODE_PATH: '', GIT_TERMINAL_PROMPT: '0' };
delete env.READER_DATA_DIR;
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
// The host's documented Git source transport still needs Git. Supply only Git
// and operating-system tools, never the maintainer's Node/npm installation.
const git = (await run(process.platform === 'win32' ? 'where.exe' : '/usr/bin/which', ['git'])).stdout.trim().split(/\r?\n/)[0];
if (process.platform === 'win32') env.PATH = [dirname(git), join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';');
else {
  const bin = join(base, 'host-git'); await fs.mkdir(bin);
  await fs.writeFile(join(bin, 'git'), `#!/bin/sh\nexec '${git.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
  env.PATH = bin;
}
async function assertNoSystemNode() {
  for (const tool of ['node', 'npm', 'npm.cmd']) {
    // execFile intentionally rejects .cmd on Windows (EINVAL), even when the
    // file is absent. Check Windows executable resolution instead of attempting
    // to run a batch script or accepting EINVAL as proof that npm is missing.
    if (process.platform === 'win32') await assert.rejects(run('where.exe', [tool], { env, cwd }), error => error.code === 1);
    else await assert.rejects(run(tool, ['--version'], { env, cwd }), error => error.code === 'ENOENT');
  }
}
const json = async path => JSON.parse(await fs.readFile(path, 'utf8'));
const catalog = join(market, '.agents/plugins/marketplace.json');
const command = async args => JSON.parse((await run(cli, args, { env, cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout);
const records = [];
let firstLaunchMs;
after(async () => {
  if (process.env.READER_KEEP_TEST_DATA) return;
  await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function stage(packageRoot, name) {
  const destination = join(market, name);
  await fs.cp(packageRoot, destination, { recursive: true });
  // Only the disposable wrapper gets an explicit test library. The exact
  // launcher, app, runtime and signed payload manifest stay byte-identical.
  const config = await json(join(destination, 'mcp.json'));
  config.mcpServers.reader.env.READER_DATA_DIR = data;
  await fs.writeFile(join(destination, 'mcp.json'), JSON.stringify(config));
  return destination;
}
async function activate(name, expectedVersion) {
  if (!remote) await fs.writeFile(catalog, JSON.stringify({ name: 'reader-test-marketplace', plugins: [{ name: id, source: { source: 'local', path: `./${name}` }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }));
  await command(['plugin', 'marketplace', 'add', remote ? publication.catalogs[name === 'legacy' ? 'fixture' : 'current'].source : market, '--json']);
  const installed = await command(['plugin', 'add', `${id}@${remote ? 'reader-marketplace' : 'reader-test-marketplace'}`, '--json']);
  assert.equal(installed.version, expectedVersion);
  const config = (await command(['mcp', 'list', '--json'])).find(item => item.name === 'reader').transport;
  assert.ok(config.command.startsWith(installed.installedPath));
  assert.equal(config.env.PLUGIN_ROOT, installed.installedPath);
  assert.ok(config.env.PLUGIN_DATA.startsWith(home));
  assert.equal(config.cwd, installed.installedPath);
  assert.equal(config.env.READER_DATA_DIR, remote ? undefined : data);
  if (process.platform !== 'win32') assert.ok((await fs.stat(config.command)).mode & 0o100);
  return config;
}
async function open(config) {
  const transport = new StdioClientTransport({ ...config, env: { ...defaults, ...config.env, PATH: '', NODE_PATH: '', NODE_OPTIONS: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'reader-installed-marketplace-test', version: '1.0.0' });
  try { await client.connect(transport); } catch (error) { await transport.close(); throw error; }
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result._meta.reader;
}
function epub() {
  return Buffer.from(zipSync({ mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
    'book.opf': strToU8('<package><metadata><title>市场升级原创 EPUB</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>'),
    'one.xhtml': strToU8('<html><body><h1>第一章</h1><p>原创验收段落一。</p><p>原始字节应该保留。</p><p>更新后接着读。</p></body></html>') }));
}
async function seed(config) {
  const started = Date.now();
  const client = await open(config);
  firstLaunchMs = Date.now() - started;
  try {
    for (const [filename, bytes] of [['原创 中文.txt', Buffer.from('第一章\n\n原创验收第一段。\n\n原创验收第二段。\n\n更新之后的段落。')], ['原创 EPUB.epub', epub()]]) {
      const begin = await call(client, 'reader_import_begin', { filename, size: bytes.length });
      await call(client, 'reader_import_chunk', { uploadId: begin.uploadId, index: 0, data: bytes.toString('base64') });
      const book = await call(client, 'reader_import_finish', { uploadId: begin.uploadId });
      const locator = { chapter: 0, paragraph: 2 };
      const summary = await call(client, 'reader_progress', { id: book.summary.id, locator });
      assert.ok(summary.progress > 0);
      await call(client, 'reader_bookmark_add', { id: book.summary.id, locator, label: '升级前书签' });
      records.push({ id: hash(bytes), locator, progress: summary.progress, format: book.summary.format, bytes });
    }
    const settings = { ...(await call(client, 'reader_list')).settings, theme: 'sepia', fontSize: 23 };
    await call(client, 'reader_settings', { settings }); return settings;
  } finally { await client.close(); }
}
async function verify(config, version, settings, labels = ['升级前书签']) {
  const client = await open(config);
  try {
    assert.equal(client.getServerVersion().version, version);
    const state = await call(client, 'reader_list'); assert.equal(state.books.length, 2); assert.deepEqual(state.settings, settings);
    const tools = (await client.listTools()).tools; assert.equal(tools.length, 12);
    const uri = tools.find(tool => tool.name === 'reader_open')._meta.ui.resourceUri;
    assert.equal(uri, `ui://reader/v${version}/bookshelf.html`);
    assert.ok((await client.readResource({ uri })).contents[0].text.includes('<html'));
    for (const saved of records) {
      const book = await call(client, 'reader_get', { id: saved.id });
      assert.deepEqual(book.summary.locator, saved.locator); assert.equal(book.summary.progress, saved.progress);
      assert.deepEqual(book.bookmarks.map(b => b.label).sort(), [...labels].sort());
      assert.deepEqual(await fs.readFile(join(data, 'books', saved.id, `source.${saved.format}`)), saved.bytes);
    }
  } finally { await client.close(); }
}
async function snapshot() {
  const result = {};
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.locks') continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), path);
      else result[path] = hash(await fs.readFile(join(dir, entry.name)));
    }
  }
  await walk(data); return result;
}

async function officialHost() {
  const child = spawn(cli, ['app-server', '--stdio'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const message = JSON.parse(line); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } });
  const request = async (id, method, params) => {
    let timer;
    try { return await Promise.race([new Promise(resolve => { pending.set(id, resolve); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Public app-server timed out: ${method}\n${stderr}`)), 60000); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    const initialized = await request(1, 'initialize', { clientInfo: { name: 'reader_marketplace_verifier', version: '1.0.0' } });
    assert.ok(initialized.result, JSON.stringify(initialized));
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const status = await request(2, 'mcpServerStatus/list', { serverName: 'reader', detail: 'full' });
    assert.ok(status.result, JSON.stringify(status));
    const reader = status.result.data.find(server => server.name === 'reader');
    assert.ok(reader, JSON.stringify(status.result));
    assert.equal(Object.keys(reader.tools).length, 12);
    assert.equal(reader.resources.length, 1);
    assert.ok(JSON.stringify(reader.tools).includes('reader_open'));
    return { initialized: initialized.result, status: status.result };
  } finally {
    child.stdin.end();
    await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    lines.close();
  }
}

test('official install preserves executable permissions and runs with no Node/npm on PATH', { timeout: 900000 }, async () => {
  await assertNoSystemNode();
  const payload = await json(join(current, 'runtime-manifest.json'));
  if (process.env.CI) { assert.equal(payload.source.commit, process.env.GITHUB_SHA); assert.equal(payload.source.dirty, false); }
  assert.equal(payload.testFixture, false); assert.equal(payload.target, target);
  const historical = await json(join(fixture, 'runtime-manifest.json'));
  assert.equal(historical.source.commit, '81a87e9d7bb38db31cc1f755021af5b809e79169'); assert.equal(historical.source.dirty, false); assert.equal(historical.testFixture, true);
  if (!remote) { await stage(fixture, 'legacy'); await stage(current, 'current'); }
  const old = await activate('legacy', '0.1.3'); const settings = await seed(old);
  await verify(old, '0.1.3', settings);
  let before = await snapshot();
  let config = await activate('current', payload.version);
  assert.deepEqual(await snapshot(), before, 'Official install must not modify the external library.');
  assert.equal(config.env.PLUGIN_DATA, old.env.PLUGIN_DATA, 'Host plugin data directory changed across versions.');
  const start = Date.now();
  await verify(config, payload.version, settings);
  const upgradedVerificationMs = Date.now() - start;
  const info = JSON.parse((await run(config.command, ['--runtime-info'], { cwd, env: { ...config.env, PATH: '' }, timeout: 30000 })).stdout);
  assert.equal(info.nodeVersion, '24.21.0'); assert.equal(info.version, payload.version);
  assert.equal(hash(await fs.readFile(info.node)), payload.nodeSha256);
  const changed = { ...settings, theme: 'dark', fontSize: 25 };
  const client = await open(config);
  try {
    await call(client, 'reader_settings', { settings: changed });
    for (const saved of records) {
      saved.locator = { chapter: 0, paragraph: 1 };
      saved.progress = (await call(client, 'reader_progress', { id: saved.id, locator: saved.locator })).progress;
      await call(client, 'reader_bookmark_add', { id: saved.id, locator: saved.locator, label: '升级后书签' });
    }
  } finally { await client.close(); }
  await verify(config, payload.version, changed, ['升级前书签', '升级后书签']);
  before = await snapshot(); config = await activate('current', payload.version); assert.deepEqual(await snapshot(), before);
  const detached = `${market}-moved`; await fs.rename(market, detached);
  let host;
  try { await verify(config, payload.version, changed, ['升级前书签', '升级后书签']); host = await officialHost(); }
  finally { await fs.rename(detached, market); }
  before = await snapshot(); const rollback = await activate('legacy', '0.1.3'); assert.deepEqual(await snapshot(), before);
  await verify(rollback, '0.1.3', changed, ['升级前书签', '升级后书签']);
  config = await activate('current', payload.version); await verify(config, payload.version, changed, ['升级前书签', '升级后书签']);
  // Fail closed on a modified cache without silently overwriting it.
  const original = await fs.readFile(info.node); await fs.writeFile(info.node, 'unknown modified runtime');
  try {
    await assert.rejects(run(config.command, ['--runtime-info'], { cwd, env: { ...config.env, PATH: '' }, timeout: 30000 }), /damaged|not overwritten/);
    assert.equal(await fs.readFile(info.node, 'utf8'), 'unknown modified runtime');
  } finally { await fs.writeFile(info.node, original); }
  const evidence = { target, version: payload.version, source: payload.source, transport: remote ? 'github-marketplace' : 'local-marketplace', officialCli: (await run(cli, ['--version'], { env, cwd })).stdout.trim(), firstLaunchMs, upgradedVerificationMs, publicAppServer: host,
    libraryBooks: 2, originalBytesPreserved: true, upgradeRollbackRestart: 'passed', dataIndependentOfPluginCache: true, noNodePath: true, executablePermissionPreserved: true };
  await fs.mkdir(join(root, 'artifacts/marketplace-evidence'), { recursive: true });
  await fs.writeFile(join(root, 'artifacts/marketplace-evidence', `${target}${remote ? '-github' : '-local'}.json`), JSON.stringify(evidence, null, 2));
});
