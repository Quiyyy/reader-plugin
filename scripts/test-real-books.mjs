// Opt-in acceptance against public-domain or user-authorized books outside the repo.
// Only metadata and screenshots enter artifacts/ (gitignored); book bytes stay external.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.READER_ACCEPTANCE_BOOKS_DIR;
if (!source) throw new Error('Set READER_ACCEPTANCE_BOOKS_DIR to a book directory outside the repository');
const directory = resolve(source);
if (directory === root || directory.startsWith(root.endsWith('/') ? root : root + '/')) throw new Error('Keep acceptance books outside the repository');
const files = (await readdir(directory)).filter(name => /\.(txt|epub)$/i.test(name)).sort();
if (!files.length) throw new Error('No TXT/EPUB books found in the specified directory');
const dataDir = await mkdtemp(join(tmpdir(), 'reader-real-books-'));
const artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
let server;
let origin;
async function startServer() {
  server = spawn(process.execPath, ['dist/server/index.js', '--http'], {
    cwd: root, env: { ...process.env, READER_DATA_DIR: dataDir, PORT: '0' }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  origin = await new Promise((resolveReady, reject) => {
    let diagnostic = '';
    const timer = setTimeout(() => reject(new Error('Reader test server did not start')), 15000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Reader exited (${code}): ${diagnostic}`)); });
    server.stderr.on('data', chunk => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096);
      const match = diagnostic.match(/Reader preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolveReady(match[1]); }
    });
  });
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 8000);
  try { await exited; } finally { clearTimeout(timer); }
}
const report = { mode: 'standalone-preview-with-real-process-restart', books: [], dataDir, passed: false };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
let context;
try {
  await startServer();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await context.newPage();
  page.setDefaultTimeout(15000);
  for (const [index, name] of files.entries()) {
    const bytes = await readFile(join(directory, name));
    const item = { file: basename(name), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    report.books.push(item);
    console.log(`Importing ${name} (${bytes.length} bytes)`);
    await page.goto(origin);
    await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
    await page.getByLabel('选择 TXT 或 EPUB 书籍').setInputFiles(join(directory, name));
    await expect(page.locator('.reading-title')).toBeVisible({ timeout: 90000 });
    item.title = await page.locator('.reading-title').innerText();
    await page.getByRole('button', { name: '目录（T）', exact: true }).click();
    item.chapters = await page.locator('.chapter-item').count();
    expect(item.chapters).toBeGreaterThan(0);
    await page.locator('.chapter-item').nth(Math.min(3, item.chapters - 1)).click();
    const scroll = page.getByLabel('正文，向下滚动阅读');
    await scroll.hover();
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.locator('.reading-paragraphs p').count()).toBeGreaterThan(0);
    const paragraphs = await page.locator('.reading-paragraphs p').allTextContents();
    const paragraph = paragraphs.find(text => text.trim().length > 30) || paragraphs[0];
    const query = paragraph.trim().slice(0, 16);
    await page.getByRole('button', { name: '搜索本书（F）', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索本书内容' }).fill(query);
    await expect.poll(() => page.locator('.search-results button').count()).toBeGreaterThan(0);
    item.searchMatches = await page.locator('.search-results button').count();
    await page.locator('.search-results button').first().click();
    // Save a nonzero reading position, even when a common query matched front matter.
    await page.getByRole('button', { name: '目录（T）', exact: true }).click();
    await page.locator('.chapter-item').nth(Math.floor(item.chapters / 2)).click();
    await scroll.hover();
    await page.mouse.wheel(0, 800);
    await expect.poll(async () => Number((await page.locator('.reading-percent').innerText()).replace('%', ''))).toBeGreaterThan(0);
    await page.getByRole('button', { name: '收藏当前段落（B）', exact: true }).click();
    await page.getByRole('button', { name: '我的书签', exact: true }).click();
    await expect(page.locator('.bookmark-list li')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭我的书签', exact: true }).click();
    await page.getByRole('button', { name: '阅读样式', exact: true }).click();
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await page.getByRole('button', { name: '关闭阅读样式', exact: true }).click();
    await expect(page.locator('.reader-app')).toHaveClass(/theme-dark/);
    await expect(page.locator('.save-indicator')).toHaveText('已保存');
    item.progress = await page.locator('.reading-percent').innerText();
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.screenshot({ path: join(artifacts, `real-book-${index + 1}.png`) });
    await page.getByRole('button', { name: '返回书架', exact: true }).click();
    await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    item.readingFlow = 'passed';
  }
  await context.close();
  await stopServer();
  await startServer(); // A new Node process and a fresh browser context, same data directory.
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  for (const item of report.books) {
    await page.goto(origin);
    const card = page.locator('.book-card').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) });
    await card.click();
    await expect(page.locator('.reading-title')).toHaveText(item.title);
    await expect(page.locator('.reading-percent')).toHaveText(item.progress);
    await expect(page.locator('.reader-app')).toHaveClass(/theme-dark/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '我的书签', exact: true }).click();
    await expect(page.locator('.bookmark-list li')).toHaveCount(1);
    item.processRestart = 'passed';
  }
  report.passed = true;
  console.log(`${report.books.length} real-book reading and process-restart checks passed.`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeFile(join(artifacts, 'real-books.json'), JSON.stringify(report, null, 2) + '\n');
  await context?.close();
  await browser.close();
  await stopServer();
}
