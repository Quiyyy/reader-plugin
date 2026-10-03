// Narrow installed-runtime acceptance. Reuse only a previously verified isolated
// installation; create a new library. No runtime patches or source-owner changes.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const prior = JSON.parse(await fs.readFile(resolve(process.argv[2]), 'utf8'));
const installDir = resolve(prior.installed.installDir), within = relative(resolve('artifacts'), installDir);
assert.ok(within && !within.startsWith('..') && !isAbsolute(within) && within.startsWith('installed-candidate-'));
assert.equal(prior.source.commit, '3bc0a57aaf0ad99dabc36a6931cdce60aa8784f0');
const config = JSON.parse(await fs.readFile(join(installDir, 'versions/0.1.7/plugin/.mcp.json'), 'utf8')).mcpServers.reader;
const packageRoot = join(installDir, 'versions/0.1.7/package');
const manifestBytes = await fs.readFile(join(packageRoot, 'package-manifest.json')), manifest = JSON.parse(manifestBytes);
assert.equal(hash(manifestBytes), prior.packageManifestHash);
assert.equal(hash(await fs.readFile(config.args[0])), prior.installedReaderEntrySha256);
const uiHash = hash(await fs.readFile(join(packageRoot, 'runtime/dist/ui/index.html')));
assert.equal(uiHash, manifest.files['runtime/dist/ui/index.html']);
const runRoot = await fs.mkdtemp(resolve('artifacts/catalog-update-installed-')), dataDir = join(runRoot, 'data');
const calls = [], pids = [], checkpoints = [], errors = [];
let client, transport;
async function connect() {
  client = new Client({ name: 'Original catalog update acceptance', version: '1.0.0' });
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key]) env[key] = process.env[key];
  transport = new StdioClientTransport({ ...config, env: { ...env, ...config.env, READER_DATA_DIR: dataDir, PATH: '', NODE_OPTIONS: '', NODE_PATH: '' }, stderr: 'pipe' });
  await client.connect(transport); pids.push(transport.pid);
}
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content)); return result._meta.reader;
};
await connect();
const html = (await client.readResource({ uri: 'ui://reader/v0.1.7/bookshelf.html' })).contents[0].text;
assert.equal(hash(html), uiHash);
const host = await fs.readFile('dist/test-host/index.html', 'utf8');
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/host' || req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/host' ? host : html); return; }
    if (req.url === '/api/tool' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks)), result = await client.callTool(input);
      calls.push({ name: input.name, at: new Date().toISOString(), isError: result.isError === true });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    res.statusCode = 404; res.end();
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), frame = page.frameLocator('#reader');
page.on('pageerror', error => errors.push(error.message));
const screenshot = async name => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.frames().find(f => f !== page.mainFrame()).evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const bytes = await page.locator('#reader').screenshot({ path: join(runRoot, name), animations: 'disabled' });
    if (bytes.length > 8192) return;
  }
  throw new Error(`Blank screenshot: ${name}`);
};
const mark = (name, evidence = {}) => { checkpoints.push({ name, at: new Date().toISOString(), ...evidence }); console.log(name); };
const base = JSON.parse(await fs.readFile('examples/online/reader-demo.json', 'utf8'));
// Own original demo, pinned to the already reviewed release. No production
// source bytes are modified. The second source is an unqueried preservation control.
base.bookSourceUrl = 'https://cdn.jsdelivr.net/gh/Quiyyy/reader-plugin@d7da13d98e2847bd580af3b848dfa24033f2cb09/examples/online/demo/';
base.bookSourceName = '原创升级源 v1';
const control = { ...base, bookSourceUrl: base.bookSourceUrl + 'preservation-control/', bookSourceName: '原书源保留对照' };
const revised = { ...base, bookSourceName: '原创升级源 v2' };
function catalog(version, entries) {
  const files = entries.map(({ id, version: sourceVersion, raw }) => ({ path: `sources/${id}/${sourceVersion}.json`, content: JSON.stringify(raw) + '\n' }));
  const manifest = JSON.stringify({ schemaVersion: 1, catalogId: 'original-update-acceptance', version, createdAt: '2026-10-03T00:00:00Z', channel: 'candidates', sources: entries.map(({ id, version: sourceVersion, raw }, index) => ({ id, version: sourceVersion, name: raw.bookSourceName, path: files[index].path, sha256: hash(files[index].content), bytes: Buffer.byteLength(files[index].content), minReaderVersion: '0.1.7', status: 'candidate', lastVerified: null, rights: { ruleLicense: 'LicenseRef-Test-Only', basis: 'Reader original public demo; synthetic catalog-update acceptance only', references: [] }, verification: { static: 'passed', network: 'untested', acceptance: 'untested', failureStage: null, reportPath: `verification/${id}.json` } })) }) + '\n';
  return JSON.stringify({ format: 'reader-source-catalog-package', schemaVersion: 1, manifestSha256: hash(manifest), manifest, files });
}
const v1 = catalog('0.1.0', [{ id: 'original-demo', version: '1.0.0', raw: base }, { id: 'control', version: '1.0.0', raw: control }]);
const v2 = catalog('0.2.0', [{ id: 'original-demo', version: '1.1.0', raw: revised }]);
const conflict = catalog('0.2.0', [{ id: 'original-demo', version: '1.1.0', raw: { ...revised, bookSourceName: '同版本冲突测试' } }]);
await fs.writeFile(join(runRoot, 'original-v1.reader-catalog.json'), v1);
await fs.writeFile(join(runRoot, 'original-v2.reader-catalog.json'), v2);
const sourcesFile = join(dataDir, 'online-v1/sources.json');
const storedSources = async () => JSON.parse(await fs.readFile(sourcesFile, 'utf8'));
const preview = frame.getByRole('region', { name: '导入预览' });
async function select(pkg) {
  await frame.getByRole('button', { name: '导入书源', exact: true }).click();
  await frame.getByLabel('选择书源 JSON').setInputFiles({ name: 'original.reader-catalog.json', mimeType: 'application/json', buffer: Buffer.from(pkg) });
}
async function confirm() {
  await frame.getByRole('button', { name: '确认导入', exact: true }).click();
  await frame.getByRole('button', { name: '查看书源', exact: true }).click();
}
let savedBook, stateBefore;
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/host`);
  await frame.getByRole('button', { name: '找书', exact: true }).click(); await frame.getByRole('button', { name: '管理书源', exact: true }).click();
  await select(v1); await expect(preview).toContainText('original-update-acceptance · 0.1.0'); await confirm();
  for (const toggle of await frame.getByRole('switch').all()) assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await frame.getByRole('switch', { name: '启用 原创升级源 v1', exact: true }).click();
  await frame.getByRole('switch', { name: '启用 原书源保留对照', exact: true }).click();
  const initial = await call('reader_online_sources'), targetId = initial.find(s => s.name === base.bookSourceName).id, controlId = initial.find(s => s.name === control.bookSourceName).id;
  await frame.getByRole('button', { name: '找书', exact: true }).click(); await frame.getByLabel('搜索书源').selectOption(targetId);
  await frame.getByLabel('在线搜索关键词').fill('河岸'); await frame.getByRole('button', { name: '搜索', exact: true }).click();
  await frame.locator('.online-result').first().click({ timeout: 45000 }); await frame.getByRole('button', { name: '开始阅读', exact: true }).click({ timeout: 45000 });
  await frame.getByLabel('正文，向下滚动阅读').waitFor({ timeout: 45000 });
  await frame.getByRole('button', { name: '目录（T）' }).click(); const chapters = frame.getByRole('navigation', { name: '章节目录' }).getByRole('button'); await expect(chapters).toHaveCount(2);
  const title = await chapters.nth(1).locator('span').nth(1).textContent(); await chapters.nth(1).click(); await frame.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 45000 });
  await frame.getByRole('button', { name: '收藏当前段落（B）', exact: true }).click();
  await frame.getByRole('button', { name: '返回找书', exact: true }).click(); await frame.getByRole('button', { name: '管理书源', exact: true }).click();
  savedBook = (await call('reader_list')).books.find(b => b.format === 'online');
  const bookFile = join(dataDir, 'online-v1', `${savedBook.id}.json`), beforeBytes = await fs.readFile(bookFile), bookRecord = JSON.parse(beforeBytes);
  assert.equal(bookRecord.locator.chapter, 1); assert.equal(bookRecord.bookmarks.length, 1); assert.ok(savedBook.progress > 0);
  const cacheDir = join(dataDir, 'online-v1/cache', savedBook.id, bookRecord.revision);
  const cacheHashes = async () => Object.fromEntries(await Promise.all((await fs.readdir(cacheDir)).sort().map(async name => [name, hash(await fs.readFile(join(cacheDir, name)))])));
  const beforeCache = await cacheHashes(); assert.equal(Object.keys(beforeCache).length, 2);
  stateBefore = await storedSources(); const baselineSourceBytes = await fs.readFile(sourcesFile), oldSource = stateBefore.sources.find(s => s.report.id === targetId), controlBefore = stateBefore.sources.find(s => s.report.id === controlId);
  mark('original v1 imported and enabled; original online book cached with nonzero progress and bookmark', { targetId, controlId, bookId: savedBook.id, locator: bookRecord.locator });
  await select(v2); await expect(preview).toContainText('original-update-acceptance · 0.2.0'); await expect(preview).toContainText('原创升级源 v2 · 1.1.0');
  await expect(preview.locator('.source-badge')).toHaveText('更新'); await expect(preview).toContainText('更新后需重新启用，已有缓存和进度保留');
  await preview.getByText('查看变更字段', { exact: true }).click(); await expect(preview).toContainText('bookSourceName');
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await screenshot(`update-preview-${width}.png`); }
  await page.setViewportSize({ width: 390, height: 844 });
  const commitsBeforeCancel = calls.filter(c => c.name === 'reader_online_commit').length;
  await frame.getByRole('button', { name: '关闭导入', exact: true }).click();
  assert.equal(calls.filter(c => c.name === 'reader_online_commit').length, commitsBeforeCancel);
  assert.deepEqual(await fs.readFile(sourcesFile), baselineSourceBytes); assert.deepEqual(await fs.readFile(bookFile), beforeBytes); assert.deepEqual(await cacheHashes(), beforeCache);
  mark('cancelled v2 preview: no commit; exact source, book and cache bytes unchanged');
  await select(v2); await expect(preview.locator('.source-badge')).toHaveText('更新'); await confirm();
  const after = await storedSources(), updated = after.sources.find(s => s.report.id === targetId);
  assert.equal(after.sources.length, 2); assert.equal(updated.report.name, revised.bookSourceName); assert.notEqual(updated.report.revision, oldSource.report.revision); assert.equal(updated.report.enabled, false);
  assert.deepEqual(after.sources.find(s => s.report.id === controlId), controlBefore); assert.equal(after.catalogReceipts.length, 2);
  assert.deepEqual(await fs.readFile(bookFile), beforeBytes); assert.deepEqual(await cacheHashes(), beforeCache);
  const backup = JSON.parse(await fs.readFile(join(dataDir, 'online-v1/sources.before-catalog-v1.json'), 'utf8')); assert.deepEqual(backup, stateBefore);
  await screenshot('update-confirmed-disabled-390.png'); mark('confirmed v2: same source ID, new revision, disabled; omitted control source and reading bytes preserved; v1 backup retained');
  await frame.getByRole('switch', { name: '启用 原创升级源 v2', exact: true }).click();
  const enabledSource = frame.getByRole('switch', { name: '停用 原创升级源 v2', exact: true });
  await expect(enabledSource).toHaveAttribute('aria-checked', 'true'); await expect(enabledSource).toBeEnabled();
  const beforeRepeat = await storedSources(); await select(v2); await expect(preview.locator('.source-badge')).toHaveText('已存在'); await screenshot('update-idempotent-preview-390.png'); await confirm();
  assert.deepEqual(await storedSources(), beforeRepeat); assert.deepEqual(await fs.readFile(bookFile), beforeBytes); assert.deepEqual(await cacheHashes(), beforeCache);
  mark('identical v2 reimport: no duplicate receipt/source; enabled state, revision, generation, book and cache unchanged');
  await select(conflict); await expect(frame.getByRole('alert')).toContainText('已经导入过不同内容');
  await screenshot('update-version-conflict-390.png'); await frame.getByRole('button', { name: '关闭导入', exact: true }).click();
  assert.deepEqual(await storedSources(), beforeRepeat); assert.deepEqual(await fs.readFile(bookFile), beforeBytes); mark('conflicting bytes under the same catalog version rejected without writes');
  const oldPid = transport.pid; await client.close(); assert.throws(() => process.kill(oldPid, 0), { code: 'ESRCH' }); await connect(); assert.notEqual(transport.pid, oldPid);
  await page.reload(); await frame.getByRole('button', { name: /^打开 【在线样例】河岸的两封信/ }).click(); await frame.getByRole('heading', { name: title, exact: true }).waitFor();
  await frame.getByRole('button', { name: '我的书签', exact: true }).click(); await expect(frame.locator('.bookmark-list li')).toHaveCount(1); await screenshot('update-restart-reading-390.png');
  const restored = await call('reader_get', { id: savedBook.id }); assert.deepEqual(restored.summary.locator, bookRecord.locator); assert.deepEqual(restored.bookmarks, bookRecord.bookmarks); assert.deepEqual(await cacheHashes(), beforeCache);
  assert.equal((await storedSources()).sources.find(s => s.report.id === targetId).report.stages.content.network, 'untested'); assert.deepEqual(errors, []);
  mark('fresh process: old revision cached book resumes at same locator and bookmark; no new-revision content request');
  const artifacts = await Promise.all((await fs.readdir(runRoot)).filter(n => n.endsWith('.png')).map(async name => ({ path: join(runRoot, name), sha256: hash(await fs.readFile(join(runRoot, name))) })));
  const evidence = { status: 'passed', completedAt: new Date().toISOString(), reader: { commit: prior.source.commit, packageManifestHash: prior.packageManifestHash, entrySha256: prior.installedReaderEntrySha256, uiSha256: uiHash }, node: process.version, platform: process.platform, arch: process.arch, dataDir, installedRuntimeReusedReadOnly: true, fixtures: { originalDemoPinnedCommit: 'd7da13d98e2847bd580af3b848dfa24033f2cb09', v1PackageSha256: hash(v1), v2PackageSha256: hash(v2), v1ManifestSha256: JSON.parse(v1).manifestSha256, v2ManifestSha256: JSON.parse(v2).manifestSha256 }, checkpoints, pids, artifacts, calls, errors, nativeStdioMcp: true, ui: 'Edge AppBridge test harness', realChatGptCloseVerified: false, sourceOwnerFilesChanged: false, productionSourcesChanged: false };
  await fs.writeFile(join(runRoot, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ passed: true, runRoot, checkpoints: checkpoints.length, artifacts: artifacts.length }));
} catch (error) {
  await page.screenshot({ path: join(runRoot, 'failure.png') }).catch(() => {}); await fs.writeFile(join(runRoot, 'failure.json'), JSON.stringify({ error: error.stack, checkpoints, calls, pids, errors }, null, 2)); console.error(JSON.stringify({ passed: false, runRoot, error: error.message })); throw error;
} finally { await browser.close(); await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
