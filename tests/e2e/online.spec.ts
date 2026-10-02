import { test, expect } from '@playwright/test';
import { fixtureSource } from '../online/source';

for (const width of [390, 1280]) {
  test(`online sources preview, enable, search, lazy reading and offline resume at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const external: string[] = [], errors: string[] = [];
    page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4178/')) external.push(req.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: '在线书源', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '在线书源', exact: true });
    await dialog.getByText('导入书源 JSON', { exact: true }).click();
    const name = `原创测试源 ${width}`;
    await dialog.getByLabel('选择书源 JSON').setInputFiles({ name: 'source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixtureSource, bookSourceName: name, bookSourceUrl: `https://reader.example.com/${width}` })) });
    await expect(dialog.getByRole('region', { name: '导入预览' })).toBeVisible();
    const preview = dialog.getByRole('region', { name: '导入预览' });
    await preview.locator('summary').click();
    await expect(preview.getByText('untested', { exact: true })).toHaveCount(4);
    await dialog.getByRole('button', { name: '确认导入这些书源' }).click();
    await expect(dialog.getByRole('button', { name: `启用 ${name}`, exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: `启用 ${name}`, exact: true }).click();
    await dialog.getByLabel('搜索书源').selectOption({ label: name });
    await dialog.getByLabel('在线搜索关键词').fill('原创');
    await dialog.getByRole('button', { name: '搜索', exact: true }).click();
    await dialog.getByRole('button', { name: '原创河岸故事 Reader 测试作者' }).click();
    await expect(dialog.getByRole('region', { name: '在线书籍详情' })).toContainText('合成的原创测试文本');
    await dialog.getByRole('button', { name: '加入书架并阅读' }).click();
    await expect(page.getByRole('heading', { name: '第一章 河岸', exact: true })).toBeVisible();
    await expect(page.locator('.reading-paragraphs')).toContainText('河水缓慢流过石桥');
    await page.getByRole('button', { name: /下一章 第二章 灯光/ }).click();
    await expect(page.getByRole('heading', { name: '第二章 灯光', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '收藏当前段落（B）' }).click();
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await expect(page.locator('.reading-paragraphs img, .reading-paragraphs script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).PWNED)).toBeUndefined();
    await page.screenshot({ path: `artifacts/online-reading-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '返回书架', exact: true }).click();
    await page.getByRole('button', { name: '在线书源', exact: true }).click();
    const row = dialog.locator('.source-row').filter({ hasText: name });
    await row.locator('summary').click();
    await expect(row.getByText('passed', { exact: true })).toHaveCount(4);
    await dialog.getByRole('button', { name: `停用 ${name}`, exact: true }).click();
    await page.screenshot({ path: `artifacts/online-sources-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await dialog.getByRole('button', { name: '关闭在线书源' }).click();
    await page.reload();
    await page.getByRole('button', { name: /^打开 原创河岸故事/ }).first().click();
    await expect(page.getByRole('heading', { name: '第二章 灯光', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '移除当前段落书签（B）' })).toBeVisible();
    expect(external).toEqual([]); expect(errors).toEqual([]);
  });
}

test('blocked script source displays exact field diagnosis and cannot be enabled', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '在线书源', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '在线书源', exact: true });
  await dialog.getByText('导入书源 JSON', { exact: true }).click();
  await dialog.getByLabel('选择书源 JSON').setInputFiles({ name: 'blocked.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixtureSource, bookSourceName: '<img onerror=alert(1)>', bookSourceUrl: 'https://reader.example.com/blocked', loginUrl: '/login', ruleContent: { content: '@js:evil()' } })) });
  const preview = dialog.getByRole('region', { name: '导入预览' }); await preview.locator('summary').click();
  await expect(preview).toContainText('ruleContent.content'); await expect(preview).toContainText('loginUrl');
  await expect(preview.locator('img')).toHaveCount(0);
  await dialog.getByRole('button', { name: '确认导入这些书源' }).click();
  await expect(dialog.getByRole('button', { name: '启用 <img onerror=alert(1)>', exact: true })).toBeDisabled();
});
