import { test, expect } from '@playwright/test';
import { declarativeSource } from '../online/declarative';

for (const width of [320, 390, 1280]) test(`declarative source shows stage limits and reads original fixture at ${width}px`, async ({ page, request }) => {
  const name = `原创语法样例 ${width}`, partialName = `仅搜索样例 ${width}`, blockedName = `需脚本样例 ${width}`;
  const sources = [
    { ...declarativeSource, bookSourceName: name, bookSourceUrl: `https://reader.example.com/grammar-${width}` },
    { ...declarativeSource, bookSourceName: partialName, bookSourceUrl: `https://reader.example.com/partial-${width}`, ruleContent: { content: '@js:requiredButUnsupported()' } },
    { ...declarativeSource, bookSourceName: blockedName, bookSourceUrl: `https://reader.example.com/blocked-${width}`, searchUrl: '@js:requiredButUnsupported()' },
  ];
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:4178/')) external.push(req.url()); });
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '找书', exact: true }).click();
  const panel = page.getByRole('main', { name: '找书与书源' });
  await panel.getByRole('button', { name: '管理书源' }).click();
  await panel.getByRole('button', { name: '导入书源', exact: true }).click();
  await panel.getByLabel('选择书源 JSON').setInputFiles({ name: 'original-grammar.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sources)) });
  const preview = panel.getByRole('region', { name: '导入预览' });
  await expect(preview).toContainText('仅能尝试搜索');
  await expect(preview).toContainText('暂不支持');
  await page.screenshot({ path: `artifacts/declarative-preview-${width}.png`, fullPage: true });
  await panel.getByRole('button', { name: '确认导入' }).click();
  await panel.getByRole('button', { name: '查看书源', exact: true }).click();
  const full = panel.locator('.managed-source').filter({ hasText: name });
  const partial = panel.locator('.managed-source').filter({ hasText: partialName });
  await expect(full).toContainText('待验证');
  await expect(partial).toContainText('仅能尝试搜索');
  await expect(panel.getByRole('switch', { name: `启用 ${blockedName}`, exact: true })).toBeDisabled();
  await full.locator('.source-menu > summary').click();
  await full.getByRole('button', { name: '查看详情', exact: true }).click();
  await expect(full.getByText('untested', { exact: true })).toHaveCount(4);
  await expect(full).toContainText('整体忽略');
  await page.screenshot({ path: `artifacts/declarative-stages-${width}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `artifacts/declarative-manager-${width}.png`, fullPage: true });
  await panel.getByRole('switch', { name: `启用 ${name}`, exact: true }).click();
  await panel.getByRole('button', { name: '找书', exact: true }).click();
  await panel.getByLabel('搜索书源').selectOption({ label: name });
  await panel.getByLabel('在线搜索关键词').fill('纸桥');
  await panel.getByRole('button', { name: '搜索', exact: true }).click();
  await panel.getByRole('button', { name: /^原创纸桥 样例作者/ }).click();
  await expect(panel.getByRole('region', { name: '在线书籍详情' })).toContainText('原创的两章短文');
  await panel.getByRole('button', { name: '开始阅读' }).click();
  await expect(page.locator('.reading-paragraphs')).toContainText('纸桥的另一端留着一片叶子。');
  await expect(page.locator('.reading-paragraphs')).not.toContainText('本章完');
  await expect(page.locator('.reading-paragraphs img, .reading-paragraphs script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).GRAMMAR_EXECUTED)).toBeUndefined();
  await page.screenshot({ path: `artifacts/declarative-reading-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: /下一章 第二章 灯笼/ }).click();
  await expect(page.getByRole('heading', { name: '第二章 灯笼', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收藏当前段落（B）' }).click();
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.getByRole('button', { name: '返回找书', exact: true }).click();
  await panel.getByRole('button', { name: '返回搜索结果' }).click();
  await expect(panel.getByLabel('在线搜索关键词')).toHaveValue('纸桥');
  await panel.getByRole('button', { name: '管理书源' }).click();
  await expect(full).toContainText('最近可用');
  await panel.getByRole('button', { name: '书架', exact: true }).click();
  const restart = await (await request.post('http://127.0.0.1:4179/restart')).json();
  expect(restart.previous).not.toBe(restart.current);
  await request.post('http://127.0.0.1:4179/offline');
  try {
    const before = await (await request.post('http://127.0.0.1:4179/requests')).json();
    await page.reload();
    await page.getByRole('button', { name: /^打开 原创纸桥/ }).first().click();
    await expect(page.getByRole('heading', { name: '第二章 灯笼', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '移除当前段落书签（B）' })).toBeVisible();
    expect(await (await request.post('http://127.0.0.1:4179/requests')).json()).toEqual(before);
  } finally { await request.post('http://127.0.0.1:4179/online'); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});
