// Explicit maintainer acceptance: isolated package installation + native stdio
// MCP + browser AppBridge harness. Never registers/updates the user's plugin.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setup, verifyPackage } from '../distribution/installer.mjs';
const packageRoot = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass a verified candidate runtime package root');
console.log('Verifying isolated candidate package');
const checked = await verifyPackage(packageRoot);
const runRoot = await fs.mkdtemp(resolve('artifacts/installed-candidate-'));
const installed = await setup({ packageRoot, installDir: join(runRoot, 'installation'), dataDir: join(runRoot, 'data') });
console.log(JSON.stringify({ stage: 'installed', runRoot }));
const config = JSON.parse(await fs.readFile(join(installed.installDir, 'versions', installed.version, 'plugin', '.mcp.json'), 'utf8')).mcpServers.reader;
let client, transport;
const pids = [];
const connect = async () => {
  client = new Client({ name: 'Reader isolated package acceptance', version: '1.0.0' });
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (process.env[name]) env[name] = process.env[name];
  transport = new StdioClientTransport({ ...config, env: { ...env, ...config.env, PATH: '', NODE_OPTIONS: '', NODE_PATH: '' }, stderr: 'pipe' });
  await client.connect(transport);
  pids.push(transport.pid);
};
await connect();
const tools = await client.listTools();
assert.ok(tools.tools.some(tool => tool.name === 'reader_catalog_preview' && tool._meta?.ui?.visibility.includes('app')));
const resource = await client.readResource({ uri: `ui://reader/v${installed.version}/bookshelf.html` });
const html = resource.contents[0].text;
const host = await fs.readFile('dist/test-host/index.html', 'utf8');
const calls = [];
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/host') { res.setHeader('Content-Type', 'text/html'); return res.end(host); }
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
    if (req.url === '/api/tool' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks)); calls.push(input.name);
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(await client.callTool(input)));
    }
    res.statusCode = 404; res.end();
  } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/host`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const externalCatalogs = [], live = { requested: process.argv.includes('--live-standardebooks'), passed: false };
const hash = text => createHash('sha256').update(text).digest('hex');
const nativeCall = async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }); assert.notEqual(result.isError, true, JSON.stringify(result.content)); return result._meta.reader; };
try {
  await page.goto(url); const frame = page.frameLocator('#reader');
  await frame.getByRole('heading', { name: '书架', exact: true }).waitFor();
  const source = await fs.readFile('examples/online/reader-demo.json', 'utf8');
  const manifest = JSON.stringify({ schemaVersion: 1, catalogId: 'installed-original-fixture', version: '0.1.0', createdAt: '2026-10-03T00:00:00Z', channel: 'candidates', sources: [{ id: 'original', version: '1.0.0', name: '安装包导入验收', path: 'sources/original/1.0.0.json', sha256: hash(source), bytes: Buffer.byteLength(source), minReaderVersion: '0.1.7', status: 'candidate', lastVerified: null, rights: { ruleLicense: 'LicenseRef-Test-Only', basis: 'Original demo fixture; no real-site acceptance', references: [] }, verification: { static: 'passed', network: 'untested', acceptance: 'pending', failureStage: null, reportPath: 'verification/original.json' } }] });
  const packageJson = JSON.stringify({ format: 'reader-source-catalog-package', schemaVersion: 1, manifestSha256: hash(manifest), manifest, files: [{ path: 'sources/original/1.0.0.json', content: source }] });
  await frame.getByRole('button', { name: '找书', exact: true }).click(); await frame.getByRole('button', { name: '管理书源', exact: true }).click(); await frame.getByRole('button', { name: '导入书源', exact: true }).click();
  await frame.getByLabel('选择书源 JSON').setInputFiles({ name: 'installed.reader-catalog.json', mimeType: 'application/json', buffer: Buffer.from(packageJson) });
  await frame.getByRole('button', { name: '确认导入', exact: true }).click(); await frame.getByRole('button', { name: '查看书源', exact: true }).click();
  assert.equal(await frame.getByRole('switch').first().getAttribute('aria-checked'), 'false');
  await page.screenshot({ path: join(runRoot, 'installed-catalog-390.png'), fullPage: true });
  // Optional independent project packages: exercise the exact file-import UI,
  // receipt persistence and disabled defaults without asserting live readability.
  for (const filename of process.argv.slice(3).filter(name => !name.startsWith('--'))) {
    const bytes = await fs.readFile(filename), envelope = JSON.parse(bytes), catalog = JSON.parse(envelope.manifest);
    await frame.getByRole('button', { name: '导入书源', exact: true }).click();
    await frame.getByLabel('选择书源 JSON').setInputFiles({ name: 'independent.reader-catalog.json', mimeType: 'application/json', buffer: bytes });
    const preview = frame.getByRole('region', { name: '导入预览' }); await preview.waitFor();
    assert.ok((await preview.textContent()).includes(catalog.catalogId));
    await page.screenshot({ path: join(runRoot, `installed-independent-${catalog.channel}-preview-390.png`), fullPage: true });
    const confirm = frame.getByRole('button', { name: '确认导入', exact: true });
    if (!catalog.sources.length) assert.equal(await confirm.isDisabled(), true);
    else {
      await confirm.click(); await frame.getByRole('button', { name: '查看书源', exact: true }).click();
      for (const toggle of await frame.getByRole('switch').all()) assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await frame.getByRole('button', { name: '导入书源', exact: true }).click();
      await frame.getByLabel('选择书源 JSON').setInputFiles({ name: 'repeat.reader-catalog.json', mimeType: 'application/json', buffer: bytes });
      await expect(preview.locator('.source-badge')).toHaveText(catalog.sources.map(() => '已存在'));
      await confirm.click(); await frame.getByRole('button', { name: '查看书源', exact: true }).click();
    }
    externalCatalogs.push({ filename, packageSha256: hash(bytes), manifestSha256: envelope.manifestSha256, channel: catalog.channel, sources: catalog.sources.map(source => ({ id: source.id, version: source.version, sha256: source.sha256 })), sourceCount: catalog.sources.length, uiPreview: true, committed: !!catalog.sources.length, readabilityVerified: false });
    await page.screenshot({ path: join(runRoot, `installed-independent-${catalog.channel}-390.png`), fullPage: true });
    if (!catalog.sources.length) await frame.getByRole('button', { name: '关闭导入', exact: true }).click();
  }
  await frame.getByRole('button', { name: '书架', exact: true }).click();
  await frame.getByLabel('选择 TXT 或 EPUB 书籍').setInputFiles({ name: '安装包回收测试.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 原创\n\n保留原文。\n\n第二章 恢复\n\n保留进度和书签。') });
  await frame.getByRole('heading', { name: '第一章 原创', exact: true }).waitFor();
  await frame.getByLabel('正文，向下滚动阅读').focus(); await page.keyboard.press('ArrowRight');
  await frame.getByRole('heading', { name: '第二章 恢复', exact: true }).waitFor();
  await frame.getByRole('button', { name: '收藏当前段落（B）', exact: true }).click();
  await frame.getByRole('button', { name: '阅读样式', exact: true }).click(); await frame.getByText('书籍更多操作', { exact: true }).click(); await frame.getByRole('button', { name: '移到回收站', exact: true }).click();
  await frame.getByRole('heading', { name: '书架', exact: true }).waitFor();
  const previousPid = transport.pid;
  await client.close();
  assert.throws(() => process.kill(previousPid, 0), { code: 'ESRCH' });
  await connect(); assert.notEqual(transport.pid, previousPid); // fresh process
  await page.reload(); await frame.getByRole('button', { name: '回收站', exact: true }).click(); await frame.getByRole('button', { name: '恢复', exact: true }).click(); await frame.getByRole('button', { name: '关闭回收站' }).click();
  await frame.getByRole('button', { name: /^打开 安装包回收测试，/ }).click(); await frame.getByRole('heading', { name: '第二章 恢复', exact: true }).waitFor();
  await frame.getByRole('button', { name: '我的书签', exact: true }).click(); assert.equal(await frame.locator('.bookmark-list li').count(), 1);
  await page.screenshot({ path: join(runRoot, 'installed-restored-390.png'), fullPage: true });
  const saved = JSON.parse(await fs.readFile(join(installed.dataDir, 'online-v1', 'sources.json'), 'utf8'));
  assert.equal(saved.catalogReceipts.length, 1 + externalCatalogs.filter(item => item.committed).length); assert.ok(saved.sources.every(source => !source.report.enabled)); assert.deepEqual(errors, []);
  if (live.requested) {
    live.startedAt = new Date().toISOString();
    const accepted = externalCatalogs.flatMap(catalog => catalog.sources).find(source => source.id === 'standardebooks-alice-en' && source.version === '0.1.1');
    assert.ok(accepted, 'Explicit live test requires the independently pinned standardebooks-alice-en@0.1.1 catalog'); live.rule = accepted;
    await frame.getByRole('button', { name: '关闭我的书签', exact: true }).click(); await frame.getByRole('button', { name: '返回书架', exact: true }).click();
    await frame.getByRole('button', { name: '找书', exact: true }).click(); await frame.getByRole('button', { name: '管理书源', exact: true }).click();
    await frame.getByRole('switch', { name: /^启用 Standard Ebooks CC0/ }).click();
    await frame.getByRole('button', { name: '找书', exact: true }).click(); await frame.getByLabel('在线搜索关键词').fill('Alice'); await frame.getByRole('button', { name: '搜索', exact: true }).click();
    await frame.locator('.online-result').first().click({ timeout: 45000 });
    await frame.getByRole('button', { name: /开始阅读/ }).click({ timeout: 45000 });
    await frame.getByLabel('正文，向下滚动阅读').waitFor({ timeout: 45000 });
    await frame.getByRole('button', { name: '目录（T）' }).click(); const chapters = frame.getByRole('navigation', { name: '章节目录' }).getByRole('button'); await expect(chapters).toHaveCount(20);
    await chapters.nth(5).click(); await expect(frame.locator('.reading-paragraphs')).toContainText('rabbit', { timeout: 45000, ignoreCase: true });
    live.chapterOneHash = hash(await frame.locator('.reading-paragraphs').innerText());
    await frame.getByRole('button', { name: '目录（T）' }).click(); await chapters.nth(6).click(); await expect(frame.locator('[data-reader-paragraph="1"]')).toBeVisible({ timeout: 45000 });
    await frame.locator('[data-reader-paragraph="1"]').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await expect(frame.locator('.save-indicator')).toContainText('已保存'); await frame.getByRole('button', { name: '收藏当前段落（B）' }).click();
    await page.screenshot({ path: join(runRoot, 'installed-standardebooks-reading-390.png'), fullPage: true });
    await frame.getByRole('button', { name: '返回找书', exact: true }).click(); await frame.getByRole('button', { name: '书架', exact: true }).click();
    const summary = (await nativeCall('reader_list')).books.find(book => book.format === 'online'); const before = await nativeCall('reader_get', { id: summary.id });
    assert.equal(before.document.chapters.length, 20); assert.equal(before.summary.locator.chapter, 6); assert.ok(before.summary.progress > 0); assert.equal(before.bookmarks.length, 1);
    live.before = { id: summary.id, locator: before.summary.locator, progress: before.summary.progress, bookmarks: before.bookmarks, chapterOneParagraphs: before.document.chapters[5].paragraphs.length, chapterTwoParagraphs: before.document.chapters[6].paragraphs.length, chapterTwoHash: hash(JSON.stringify(before.document.chapters[6].paragraphs)) };
    const oldPid = transport.pid; await client.close(); assert.throws(() => process.kill(oldPid, 0), { code: 'ESRCH' }); await connect(); assert.notEqual(transport.pid, oldPid);
    await page.reload(); await frame.getByRole('button', { name: /^打开 Alice/ }).click(); await frame.getByRole('button', { name: '我的书签', exact: true }).click(); await expect(frame.locator('.bookmark-list li')).toHaveCount(1);
    const after = await nativeCall('reader_get', { id: summary.id }); assert.deepEqual(after.summary.locator, before.summary.locator); assert.deepEqual(after.bookmarks, before.bookmarks); assert.equal(hash(JSON.stringify(after.document.chapters[6].paragraphs)), live.before.chapterTwoHash);
    await page.screenshot({ path: join(runRoot, 'installed-standardebooks-restart-390.png'), fullPage: true });
    live.sourceReport = (await nativeCall('reader_online_sources')).find(source => source.name.startsWith('Standard Ebooks CC0')); live.passed = true; live.finishedAt = new Date().toISOString();
  }
  const artifacts = await Promise.all((await fs.readdir(runRoot)).filter(name => name.endsWith('.png')).map(async name => ({ path: join(runRoot, name), sha256: hash(await fs.readFile(join(runRoot, name))) })));
  const evidence = { installed, packageManifestHash: checked.manifestHash, installedReaderEntrySha256: hash(await fs.readFile(config.args[0])), source: checked.manifest.source, externalCatalogs, live, artifacts, nativeStdioMcp: true, ui: 'AppBridge test harness, not ChatGPT', realHostCloseVerified: false, sourceReadabilityVerified: live.passed, actualProcessRestart: true, pids, calls, errors };
  await fs.writeFile(join(runRoot, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ passed: true, runRoot, ...evidence }));
} catch (error) { await page.screenshot({ path: join(runRoot, 'failure.png'), fullPage: true }); await fs.writeFile(join(runRoot, 'failure.json'), JSON.stringify({ error: error.stack, externalCatalogs, live, calls, pids, errors }, null, 2)); console.error(JSON.stringify({ runRoot, failed: true, error: error.message })); throw error;
} finally { await browser.close(); await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
