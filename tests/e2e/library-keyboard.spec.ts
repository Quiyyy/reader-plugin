import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { catalogPackage } from '../catalog-fixture';
import { fixtureSource } from '../online/source';
const original = `第一章 键盘\n\n${Array.from({ length: 35 }, (_, i) => `第${i}段，这是为键盘验收写的原创段落。文字沿着纸页展开，读者可以安静地继续阅读。`).join('\n\n')}\n\n第二章 回收\n\n进度和书签应当被保留。`;
for (const width of [320, 390, 1280]) {
  test(`library keyboard, editing, trash and restoration at ${width}`, async ({ page, request }, testInfo) => {
    await request.post('/api/tool', { headers: { 'X-Reader-Client': 'preview' }, data: { name: 'reader_keyboard_reset', arguments: {} } });
    await page.setViewportSize({ width, height: 844 }); await page.goto('/');
    const title = `键盘-${width}-${testInfo.repeatEachIndex}`;
    await page.getByLabel('选择 TXT 或 EPUB 书籍').setInputFiles({ name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(original + title) });
    const reading = page.getByLabel('正文，向下滚动阅读'); await expect(reading).toBeVisible(); await reading.focus();
    await page.keyboard.press('ArrowDown'); await expect.poll(() => reading.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('ArrowRight'); await expect(page.getByRole('heading', { name: '第二章 回收', exact: true })).toBeVisible();
    await reading.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true, cancelable: true, isComposing: true })));
    await expect(page.getByRole('heading', { name: '第二章 回收', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收藏当前段落（B）', exact: true }).click();
    await page.getByRole('button', { name: '搜索本书（F）', exact: true }).click();
    const search = page.getByRole('searchbox', { name: '搜索本书内容' }); await expect(search).toBeFocused(); await search.fill('abc'); await search.press('End'); await search.press('ArrowLeft');
    expect(await search.evaluate(el => (el as HTMLInputElement).selectionStart)).toBe(2);
    await page.getByRole('button', { name: '关闭搜索本书', exact: true }).click();
    await page.getByRole('button', { name: '阅读样式', exact: true }).click(); await page.getByRole('button', { name: '键盘快捷键设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '让阅读更顺手' });
    await dialog.getByRole('button', { name: '录制请求关闭宿主面板' }).click();
    await page.keyboard.press('Control+Shift+Period'); await expect(dialog.getByRole('status')).toContainText('已保存');
    await dialog.getByRole('button', { name: '录制向下滚动' }).click(); await page.keyboard.press('ArrowUp'); await expect(dialog.getByRole('status')).toContainText('重复'); await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: '请求关闭宿主面板', exact: true }).click(); await expect(page.locator('.host-close-message')).toContainText('没有宿主关闭接口');
    await page.getByRole('button', { name: '知道了' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/candidate-keyboard-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: '关闭键盘快捷键' }).click();
    await page.getByText('书籍更多操作', { exact: true }).click(); await page.getByRole('button', { name: '移到回收站', exact: true }).click();
    await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await page.getByRole('searchbox', { name: '搜索书名或作者' }).fill(title);
    const card = page.getByRole('button', { name: new RegExp(`^打开 ${title}，`) }); await card.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '第二章 回收', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '我的书签', exact: true }).click(); await expect(page.locator('.bookmark-list li')).toHaveCount(1); await page.keyboard.press('Escape');
    await reading.focus(); await page.keyboard.press('Escape'); await expect(page.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
    await page.getByLabel(`更多：${title}`, { exact: true }).click(); await page.getByRole('button', { name: '移到回收站', exact: true }).click();
    await page.getByRole('button', { name: '回收站', exact: true }).click(); await expect(page.getByRole('dialog', { name: '回收站' })).toContainText(title);
    await page.screenshot({ path: `artifacts/candidate-trash-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '恢复', exact: true }).click(); await page.getByRole('button', { name: '关闭回收站' }).click();
    await page.getByRole('button', { name: '切换列表' }).click(); await card.focus(); await page.keyboard.press('ArrowDown'); await expect(card).toBeFocused();
    await page.screenshot({ path: `artifacts/candidate-list-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '切换卡片' }).click(); await page.screenshot({ path: `artifacts/candidate-cards-${width}.png`, fullPage: true });
    await page.reload(); await page.getByRole('button', { name: '键盘快捷键', exact: true }).click(); await expect(page.getByRole('button', { name: '录制请求关闭宿主面板' })).toContainText('Ctrl + Shift + .');
    await page.getByRole('button', { name: '恢复默认快捷键' }).click(); await expect(page.getByRole('button', { name: '录制请求关闭宿主面板' })).toContainText('未设置');
  });
}

test('MCP AppBridge catalog UI and declined teardown keep the actual UI visible', async ({ page }) => {
  const html = await readFile('dist/test-host/index.html', 'utf8');
  await page.route('**/__test_host', route => route.fulfill({ contentType: 'text/html', body: html })); await page.goto('/__test_host');
  const app = page.frameLocator('#reader'); await expect(app.getByRole('heading', { name: '书架', exact: true })).toBeVisible();
  await app.getByRole('button', { name: '键盘快捷键', exact: true }).click(); await app.getByRole('button', { name: '请求关闭宿主面板', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__readerHarness.teardownRequests.length)).toBe(1);
  await expect(app.locator('.host-close-message')).toContainText('已发送关闭请求'); await expect(page.locator('#reader')).toBeVisible();
  await app.getByRole('button', { name: '知道了' }).click();
  await app.getByRole('button', { name: '录制请求关闭宿主面板' }).click(); await page.keyboard.press('Control+Shift+Period');
  await expect(app.getByRole('button', { name: '录制请求关闭宿主面板' })).toContainText('Ctrl + Shift + .');
  await app.getByRole('button', { name: '关闭键盘快捷键' }).click(); await app.getByRole('button', { name: '键盘快捷键', exact: true }).focus();
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.down('Period'); await page.keyboard.down('Period'); await page.keyboard.up('Period'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await expect.poll(() => page.evaluate(() => (window as any).__readerHarness.teardownRequests.length)).toBe(2);
  await app.getByRole('button', { name: '知道了' }).click();
  const iframe = page.frames().find(frame => frame !== page.mainFrame())!;
  await iframe.evaluate(() => { (window as any).openai = { requestClose: () => Promise.reject(new Error('test host rejected close')) }; });
  await app.getByRole('button', { name: '键盘快捷键', exact: true }).focus(); await page.keyboard.press('Control+Shift+Period');
  await expect(app.locator('.host-close-message')).toContainText('未完成关闭请求'); await expect(page.locator('#reader')).toBeVisible(); await app.getByRole('button', { name: '知道了' }).click();
  await app.getByRole('button', { name: '找书', exact: true }).click(); await app.getByRole('button', { name: '管理书源', exact: true }).click(); await app.getByRole('button', { name: '导入书源', exact: true }).click();
  const pkg = catalogPackage([{ ...fixtureSource, bookSourceName: '清单原创源', bookSourceUrl: 'https://reader.example.com/catalog' }]);
  await app.getByLabel('选择书源 JSON').setInputFiles({ name: 'fixture.reader-catalog.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg)) });
  await expect(app.getByRole('region', { name: '导入预览' })).toContainText('fixture-only'); await expect(app.getByText('候选清单：未保证可读。', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'artifacts/candidate-catalog-harness.png', fullPage: true });
  await app.getByRole('button', { name: '确认导入', exact: true }).click(); await app.getByRole('button', { name: '启用并找书', exact: true }).click();
  await app.getByLabel('在线搜索关键词').fill('原创'); await app.getByRole('button', { name: '搜索', exact: true }).click();
  await app.getByRole('button', { name: /^原创河岸故事 Reader 测试作者/ }).click(); await app.getByRole('button', { name: /开始阅读/ }).click();
  await expect(app.getByRole('heading', { name: '第一章 河岸', exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__readerHarness.calls); expect(calls).toContain('reader_catalog_preview'); expect(calls).toContain('reader_online_commit'); expect(calls).toContain('reader_online_add');
});

test('editable content and focus outside Reader never dispatch reading shortcuts', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('选择 TXT 或 EPUB 书籍').setInputFiles({ name: '焦点边界.txt', mimeType: 'text/plain', buffer: Buffer.from(original + 'boundary') });
  await expect(page.getByRole('heading', { name: '第一章 键盘', exact: true })).toBeVisible();
  const prevented = await page.evaluate(() => {
    const root = document.querySelector('.reader-app')!;
    const editable = document.createElement('div'); editable.contentEditable = 'plaintext-only'; root.append(editable); editable.focus();
    const inside = !editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true })); editable.remove();
    const outside = document.createElement('button'); document.body.append(outside); outside.focus();
    const external = !outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true })); outside.remove();
    return { inside, external };
  });
  expect(prevented).toEqual({ inside: false, external: false }); await expect(page.getByRole('heading', { name: '第一章 键盘', exact: true })).toBeVisible();
});

test('shelf arrows move between cards and Enter opens the focused title', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 TXT 或 EPUB 书籍').setInputFiles(['书架焦点甲', '书架焦点乙'].map(title => ({ name: `${title}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`第一章 ${title}\n\n原创焦点测试。`) })));
  const query = page.getByRole('searchbox', { name: '搜索书名或作者' }); await query.fill('书架焦点');
  const cards = page.locator('.book-card'); await expect(cards).toHaveCount(2);
  await cards.first().focus(); await page.keyboard.press('ArrowRight'); await expect(cards.nth(1)).toBeFocused();
  const name = await cards.nth(1).getAttribute('aria-label'); await page.keyboard.press('Enter');
  await expect(page.locator('.reading-title')).toHaveText(name!.split('，')[0].slice(3));
});
