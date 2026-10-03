// Explicit maintainer acceptance: isolated package installation + native stdio
// MCP + browser AppBridge harness. Never registers/updates the user's plugin.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setup, verifyPackage } from '../distribution/installer.mjs';
const packageRoot = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass a verified candidate runtime package root');
const checked = await verifyPackage(packageRoot);
const runRoot = await fs.mkdtemp(resolve('artifacts/installed-candidate-'));
const installed = await setup({ packageRoot, installDir: join(runRoot, 'installation'), dataDir: join(runRoot, 'data') });
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
try {
  await page.goto(url); const frame = page.frameLocator('#reader');
  await frame.getByRole('heading', { name: '书架', exact: true }).waitFor();
  const source = await fs.readFile('examples/online/reader-demo.json', 'utf8');
  const hash = text => createHash('sha256').update(text).digest('hex');
  const manifest = JSON.stringify({ schemaVersion: 1, catalogId: 'installed-original-fixture', version: '0.1.0', createdAt: '2026-10-03T00:00:00Z', channel: 'candidates', sources: [{ id: 'original', version: '1.0.0', name: '安装包导入验收', path: 'sources/original/1.0.0.json', sha256: hash(source), bytes: Buffer.byteLength(source), minReaderVersion: '0.1.7', status: 'candidate', lastVerified: null, rights: { ruleLicense: 'LicenseRef-Test-Only', basis: 'Original demo fixture; no real-site acceptance', references: [] }, verification: { static: 'passed', network: 'untested', acceptance: 'pending', failureStage: null, reportPath: 'verification/original.json' } }] });
  const packageJson = JSON.stringify({ format: 'reader-source-catalog-package', schemaVersion: 1, manifestSha256: hash(manifest), manifest, files: [{ path: 'sources/original/1.0.0.json', content: source }] });
  await frame.getByRole('button', { name: '找书', exact: true }).click(); await frame.getByRole('button', { name: '管理书源', exact: true }).click(); await frame.getByRole('button', { name: '导入书源', exact: true }).click();
  await frame.getByLabel('选择书源 JSON').setInputFiles({ name: 'installed.reader-catalog.json', mimeType: 'application/json', buffer: Buffer.from(packageJson) });
  await frame.getByRole('button', { name: '确认导入', exact: true }).click(); await frame.getByRole('button', { name: '查看书源', exact: true }).click();
  assert.equal(await frame.getByRole('switch').first().getAttribute('aria-checked'), 'false');
  await page.screenshot({ path: join(runRoot, 'installed-catalog-390.png'), fullPage: true });
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
  assert.equal(saved.catalogReceipts.length, 1); assert.equal(saved.sources[0].report.enabled, false); assert.deepEqual(errors, []);
  const evidence = { installed, packageManifestHash: checked.manifestHash, source: checked.manifest.source, nativeStdioMcp: true, ui: 'AppBridge test harness, not ChatGPT', realHostCloseVerified: false, sourceReadabilityVerified: false, actualProcessRestart: true, pids, calls, errors };
  await fs.writeFile(join(runRoot, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ passed: true, runRoot, ...evidence }));
} finally { await browser.close(); await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
