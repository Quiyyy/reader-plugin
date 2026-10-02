import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { defaultSettings, type ReaderSettings } from '../../src/shared/types';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function previewTool(request: APIRequestContext, name: string, args: object = {}) {
  const response = await request.post('/api/tool', { headers: { 'X-Reader-Client': 'preview' }, data: { name, arguments: args } });
  expect(response.ok()).toBe(true);
  return (await response.json())._meta.reader;
}
async function waitForImport(page: Page, trigger: () => Promise<unknown>) {
  // Import includes durable filesystem writes. Observe its real result within
  // the preview API's 15-second deadline before asserting the rendered chapter.
  const finished = page.waitForResponse(response => response.url().endsWith('/api/tool')
    && response.request().method() === 'POST'
    && response.request().postDataJSON().name === 'reader_import_finish', { timeout: 15000 });
  await trigger();
  const response = await finished;
  expect(response.ok(), await response.text()).toBe(true);
  expect((await response.json())._meta.reader.summary.id).toMatch(/^[a-f0-9]{64}$/);
}
async function importFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await waitForImport(page, () => page.getByLabel('选择 TXT 或 EPUB 书籍').setInputFiles(file));
}
async function importSettingsBook(page: Page, request: APIRequestContext, title: string) {
  // Only the disposable Playwright service is reset. Repeats must start with
  // different settings so a previous successful save cannot mask a lost write.
  await previewTool(request, 'reader_settings', { settings: defaultSettings });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
  await importFile(page, { name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`第一章 样式保存\n\n${title}：原创时序验收内容。`) });
  await expect(page.getByRole('heading', { name: '第一章 样式保存', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '阅读样式', exact: true }).click();
}
async function expectSettingsAfterReload(page: Page, title: string, settings: ReaderSettings) {
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`^打开 ${title}，`) }).click();
  await expect(page.locator('.reader-app')).toHaveClass(new RegExp(`theme-${settings.theme}`));
  await expect(page.locator('.reader-app')).toHaveCSS('--reading-size', `${settings.fontSize}px`);
}
const original = `第一章 雨后的书店\n\n${Array.from({length: 35},(_,i)=>`这是第 ${i+1} 段。雨停下来的时候，街角的小书店还亮着灯。林把伞靠在门边，听见纸页翻动的声音。她找到一把靠窗的椅子，把未读完的故事重新打开。`).join('\n\n')}\n\n第二章 河边散步\n\n晚风吹过河面。桥上的灯映在水里，像一行没有写完的句子。\n\n第三章 归途\n\n她把书合上，记住了回家的路。`;
function epub() { return Buffer.from(zipSync({ mimetype: strToU8('application/epub+zip'), 'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'), 'book.opf': strToU8('<package><metadata><title>纸页之间</title><creator>Reader 测试</creator></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'), 'one.xhtml': strToU8('<html><body><h1>第一章 纸页</h1><p>这是 EPUB 里的第一段。</p><script>window.PWNED=true;fetch("https://attacker.invalid")</script><img src="https://attacker.invalid/track.png"/><p>文字安静地留在这里。</p></body></html>'), 'two.xhtml': strToU8('<html><body><h1>第二章 日落</h1><p>窗外的光慢慢落下。</p></body></html>') })); }
test('TXT import, progress, bookmarks, settings and restart', async ({ page, request }, testInfo) => {
  const title = `雨后的书店-${testInfo.repeatEachIndex}`;
  await previewTool(request, 'reader_settings', { settings: defaultSettings });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入书籍', exact: true })).toBeEnabled();
  await importFile(page, { name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`${original}\n\n验收轮次 ${testInfo.repeatEachIndex}`) });
  await expect(page.getByRole('heading', { name: '第一章 雨后的书店' })).toBeVisible();
  await page.getByRole('button', { name: '目录（T）', exact: true }).click();
  await page.locator('.chapter-item').first().click();
  await expect(page.locator('.save-indicator')).toHaveText('已保存');
  const scroll = page.getByLabel('正文，向下滚动阅读');
  await scroll.hover();
  await page.mouse.wheel(0, 1800);
  await expect.poll(async () => Number((await page.locator('.reading-percent').textContent())?.replace('%',''))).toBeGreaterThan(0);
  await expect(page.locator('.save-indicator')).toHaveText('已保存', {timeout:5000});
  await page.keyboard.press('b');
  await page.getByRole('button', {name:'我的书签',exact:true}).click();
  await expect(page.locator('.bookmark-list li')).toHaveCount(1);
  const bookmarkText = await page.locator('.bookmark-jump p').textContent(); expect(bookmarkText).toContain('这是第');
  await page.getByRole('button', {name:'关闭我的书签'}).click();
  await page.getByRole('button', {name:'阅读样式',exact:true}).click();
  await page.getByRole('button', {name:'纸色',exact:true}).click();
  await page.getByRole('button', {name:'增大字号'}).click();
  await page.getByRole('button', {name:'关闭阅读样式'}).click();
  await page.getByRole('button', {name:'返回书架'}).click();
  // click() does not await the async return handler. Reload only after its
  // progress/settings saves finish and the actual bookshelf is rendered.
  await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', {name:new RegExp(`^打开 ${title}，`)}).click();
  await expect(page.locator('.reader-app')).toHaveClass(/theme-sepia/);
  await expect(page.locator('.reader-app')).toHaveCSS('--reading-size', '21px');
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  await page.getByRole('button', {name:'目录（T）',exact:true}).click();
  await page.getByRole('button', {name:/02 第二章 河边散步/}).click();
  await expect(page.getByRole('heading', {name:'第二章 河边散步',exact:true})).toBeVisible();
  await expect(page.locator('.save-indicator')).toHaveText('已保存');
  await page.screenshot({ path: 'artifacts/reader-reading.png', fullPage: true });
  await page.getByRole('button', {name:'返回书架'}).click();
  await expect(page.getByRole('heading', {name:'书架',exact:true})).toBeVisible();
  await page.screenshot({ path: 'artifacts/reader-bookshelf.png', fullPage: true });
  expect(errors).toEqual([]);
});

for (const inFlight of [false, true]) {
  test(`settings persistence waits for ${inFlight ? 'an in-flight save and the latest queued edits' : 'the debounced save before returning'}`, async ({ page, request }, testInfo) => {
    const title = `样式时序-${inFlight ? '队列' : '立即返回'}-${testInfo.repeatEachIndex}`;
    await importSettingsBook(page, request, title);
    const observed = signal(), release = signal();
    const writes: ReaderSettings[] = [];
    await page.route('**/api/tool', async route => {
      const payload = route.request().postDataJSON();
      if (payload.name === 'reader_settings') {
        writes.push(payload.arguments.settings);
        if (writes.length === 1) { observed.resolve(); await release.promise; }
      }
      await route.continue();
    });
    const expected = { ...defaultSettings, theme: inFlight ? 'dark' as const : 'sepia' as const, fontSize: 21 };
    try {
      await page.getByRole('button', { name: '纸色', exact: true }).click();
      if (inFlight) {
        await observed.promise;
        await page.getByRole('button', { name: '深色', exact: true }).click();
      }
      await page.getByRole('button', { name: '增大字号' }).click();
      await page.getByRole('button', { name: '关闭阅读样式' }).click();
      await page.getByRole('button', { name: '返回书架', exact: true }).click();
      await observed.promise;
      await expect(page.locator('.returning-overlay')).toBeVisible();
      await expect(page.getByRole('heading', { name: '书架', exact: true })).toHaveCount(0);
      expect(writes).toHaveLength(1);
      expect((await previewTool(request, 'reader_list')).settings).toEqual(defaultSettings);
      release.resolve();
      await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(writes.at(-1)).toEqual(expected);
      if (inFlight) {
        expect(writes.length).toBeGreaterThanOrEqual(2);
        expect(writes[0]).toEqual({ ...defaultSettings, theme: 'sepia' });
      }
      expect((await previewTool(request, 'reader_list')).settings).toEqual(expected);
      await expectSettingsAfterReload(page, title, expected);
    } finally {
      release.resolve();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
test('EPUB strips active content and fits narrow panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4178') && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.goto('/'); await importFile(page, {name:'纸页之间.epub',mimeType:'application/epub+zip',buffer:epub()});
  await expect(page.getByText('这是 EPUB 里的第一段。', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => (window as any).PWNED)).toBeUndefined(); expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'目录（T）',exact:true}).click(); await page.keyboard.press('Escape'); await expect(page.locator('.reader-panel')).toHaveCount(0);
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({path:'artifacts/reader-mobile.png',fullPage:true});
});
test('Chinese hard wraps reflow, cross-line search works, and fragment bookmarks restore', async ({ page }) => {
  const paragraphs = Array.from({ length: 36 }, (_, i) => `　　这是第${i + 1}段原创测试文字，旅人沿着河岸慢慢向前走，直到他看见远\n处的小桥，还有桥边一盏温暖的灯。`);
  await page.goto('/');
  await importFile(page, { name: '连续中文.txt', mimeType: 'text/plain', buffer: Buffer.from('第一章 归途\n\n' + paragraphs.join('\n\n')) });
  await expect(page.locator('.reading-paragraphs p')).toHaveCount(37);
  await expect(page.locator('.reading-paragraphs p').nth(1)).toContainText('远处的小桥');
  await page.getByRole('button', { name: '搜索本书（F）', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索本书内容' }).fill('远处的小桥');
  await expect(page.locator('.search-results button')).toHaveCount(36);
  await page.locator('.search-results button').nth(20).click();
  await page.getByRole('button', { name: '收藏当前段落（B）', exact: true }).click();
  await expect(page.locator('.save-indicator')).toHaveText('已保存');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /打开 连续中文/ }).click();
  await expect.poll(() => page.getByLabel('正文，向下滚动阅读').evaluate(element => element.scrollTop)).toBeGreaterThan(1000);
  await page.getByRole('button', { name: '我的书签', exact: true }).click();
  await expect(page.locator('.bookmark-list li')).toHaveCount(1);
  await page.locator('.bookmark-jump').click();
  await expect(page.locator('.reading-paragraphs .has-bookmark')).toContainText('第21段');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/reader-chinese-reflow.png', fullPage: true });
});
test('a stalled progress request releases the return overlay and can be retried', async ({ page }) => {
  test.setTimeout(45000); // One bounded import plus the deliberately stalled 15-second save.
  await page.goto('/');
  await importFile(page, { name: '超时恢复.txt', mimeType: 'text/plain', buffer: Buffer.from(original + '\n\n网络超时恢复测试。') });
  await expect(page.getByRole('heading', { name: '第一章 雨后的书店' })).toBeVisible();
  await page.route('**/api/tool', route => {
    if (route.request().postDataJSON().name === 'reader_progress') return;
    return route.continue();
  });
  await page.getByLabel('正文，向下滚动阅读').hover();
  await page.mouse.wheel(0, 1800);
  await expect.poll(async () => Number((await page.locator('.reading-percent').textContent())?.replace('%', ''))).toBeGreaterThan(0);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(page.locator('.returning-overlay')).toBeVisible();
  await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('alert')).toContainText('阅读位置未保存：Reader 服务响应超时，请重试');
  await page.unroute('**/api/tool');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /打开 超时恢复/ }).click();
  await expect.poll(() => page.getByLabel('正文，向下滚动阅读').evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
});
test('real AppBridge in opaque iframe imports host file and persists through app-only RPC', async ({ page }) => {
  const html = await readFile('dist/test-host/index.html','utf8');
  await page.route('**/__test_host', route => route.fulfill({contentType:'text/html',body:html}));
  await page.goto('/__test_host'); const frame = page.frameLocator('#reader');
  await expect(frame.getByRole('heading',{name:'书架',exact:true})).toBeVisible();
  await waitForImport(page, () => page.evaluate(async ({name,blob}) => { await (window as any).__readerHarness.openFile(name,blob); },{name:'宿主文件.txt',blob:Buffer.from('第一章 宿主文件\n\n通过真正的 MCP Apps 协议打开。').toString('base64')}));
  await expect(frame.getByRole('heading',{name:'第一章 宿主文件',exact:true})).toBeVisible();
  await expect(frame.getByText('通过真正的 MCP Apps 协议打开。',{exact:true})).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__readerHarness.calls);
  expect(calls).toContain('reader_import_finish'); expect(calls).toContain('reader_list');
  await page.evaluate(() => (window as any).__readerHarness.setTheme('dark'));
  await expect(frame.locator('html')).toHaveAttribute('data-host-theme','dark');
});
