import { test, expect } from '@playwright/test';
import { fixtureSource } from '../online/source';

for (const width of [320, 390, 1280]) {
  test(`long directory continuation is explicit and keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const rpc = async (name: string, args: unknown) => {
      const response = await page.request.post('/api/tool', { headers: { 'X-Reader-Client': 'preview' }, data: { name, arguments: args } });
      expect(response.ok()).toBeTruthy(); return (await response.json())._meta.reader;
    };
    const raw = { ...fixtureSource, bookSourceName: `原创长目录 ${width}`, bookSourceUrl: `https://reader.example.com/long-${width}`, ruleBookInfo: { ...fixtureSource.ruleBookInfo, tocUrl: '@js:"https://reader.example.com/long-toc"' } };
    const preview = await rpc('reader_online_preview', { json: JSON.stringify(raw) });
    await rpc('reader_online_commit', { token: preview.token }); await rpc('reader_online_enable', { id: preview.sources[0].id, enabled: true });
    await page.goto('/'); await page.getByRole('button', { name: '找书', exact: true }).click();
    await page.getByLabel('搜索书源').selectOption(preview.sources[0].id);
    await page.getByLabel('在线搜索关键词').fill('原创'); await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.getByRole('button', { name: /^原创河岸故事 Reader 测试作者/ }).click();
    await page.getByRole('button', { name: '开始阅读' }).click();
    const resume = page.getByRole('button', { name: '继续加载目录', exact: true });
    await expect(resume).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.pagination-notice')).toContainText('已加载 8 页、8 章');
    await page.screenshot({ path: `artifacts/long-directory-paused-${width}.png`, fullPage: true });
    await resume.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '原创分页第1章', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/long-directory-reading-${width}.png`, fullPage: true });
  });
}

test('a paginated next chapter retains the current chapter until complete and can continue by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rpc = async (name: string, args: unknown) => (await (await page.request.post('/api/tool', { headers: { 'X-Reader-Client': 'preview' }, data: { name, arguments: args } })).json())._meta.reader;
  const raw = { ...fixtureSource, bookSourceName: '原创长章测试', bookSourceUrl: 'https://reader.example.com/long-content-source', ruleBookInfo: { ...fixtureSource.ruleBookInfo, tocUrl: '@js:"https://reader.example.com/long-content-toc"' } };
  const preview = await rpc('reader_online_preview', { json: JSON.stringify(raw) });
  await rpc('reader_online_commit', { token: preview.token }); await rpc('reader_online_enable', { id: preview.sources[0].id, enabled: true });
  await page.goto('/'); await page.getByRole('button', { name: '找书', exact: true }).click();
  await page.getByLabel('搜索书源').selectOption(preview.sources[0].id);
  await page.getByLabel('在线搜索关键词').fill('原创'); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('button', { name: /^原创河岸故事 Reader 测试作者/ }).click();
  await page.getByRole('button', { name: '开始阅读' }).click();
  await expect(page.getByRole('heading', { name: '第一章 河岸', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /下一章 原创长章/ }).click();
  for (const count of [8, 16]) {
    const resume = page.getByRole('button', { name: '继续加载章节', exact: true });
    await expect(resume).toBeVisible(); await expect(page.locator('.pagination-notice')).toContainText(`已加载 ${count} 页`);
    await expect(page.getByRole('heading', { name: '第一章 河岸', exact: true })).toBeVisible();
    await expect(page.locator('.reading-paragraphs')).not.toContainText('原创长章第');
    await resume.focus(); await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('heading', { name: '原创长章', exact: true })).toBeVisible();
  await expect(page.locator('.reading-paragraphs')).toContainText('原创长章第 17 页');
});
