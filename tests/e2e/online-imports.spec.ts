import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('sample source imports through file and URL UI, paginates, restarts and reads cached chapters offline', async ({ page, request }) => {
  test.setTimeout(120000);
  const publicMode = process.env.READER_TEST_PUBLIC_SOURCES === '1';
  const suffix = publicMode ? 'public' : 'fixture';
  const base = 'https://raw.githubusercontent.com/Quiyyy/reader-plugin/refs/heads/main/examples/online/';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '找书', exact: true }).click();
  const dialog = page.getByRole('main', { name: '找书与书源', exact: true });
  await dialog.getByRole('button', { name: '管理书源' }).click();
  for (const [entry, filename] of [['file', 'reader-demo.json'], ['file', 'reader-demo-array.json'], ['url', 'reader-demo.json'], ['url', 'reader-demo-array.json']] as const) {
    await dialog.getByRole('button', { name: '导入书源', exact: true }).click();
    if (entry === 'file') await dialog.getByLabel('选择书源 JSON').setInputFiles({ name: filename, mimeType: 'application/json', buffer: await readFile(`examples/online/${filename}`) });
    else { await dialog.getByRole('textbox', { name: '书源 JSON 链接' }).fill(base + filename); await dialog.getByRole('button', { name: '检查链接' }).click(); }
    const preview = dialog.getByRole('region', { name: '导入预览' });
    await expect(preview).toContainText('Reader 原创公开示例');
    await preview.locator('.source-status > summary').click();
    await expect(preview.getByText('supported', { exact: true })).toHaveCount(4);
    await expect(preview.getByText('untested', { exact: true })).toHaveCount(4);
    await page.screenshot({ path: `artifacts/online-${suffix}-${entry}-${filename}.png`, fullPage: true });
    await dialog.getByRole('button', { name: '确认导入' }).click();
    await dialog.getByRole('button', { name: '查看书源', exact: true }).click();
    await expect(preview).toHaveCount(0);
  }
  const name = 'Reader 原创公开示例';
  await dialog.getByRole('switch', { name: `启用 ${name}`, exact: true }).click();
  await dialog.getByRole('switch', { name: `停用 ${name}`, exact: true }).click();
  await dialog.getByRole('switch', { name: `启用 ${name}`, exact: true }).click();
  await dialog.getByRole('button', { name: '找书', exact: true }).click();
    await dialog.getByLabel('搜索书源').selectOption({ label: name });
  await dialog.getByLabel('在线搜索关键词').fill('河岸');
  await dialog.getByRole('button', { name: '搜索', exact: true }).click();
  await dialog.getByRole('button', { name: '下一页搜索' }).click();
  await expect(dialog.getByRole('region', { name: '在线搜索结果' })).toContainText('已到搜索末页');
  await dialog.getByRole('button', { name: '上一页搜索', exact: true }).click();
  await dialog.getByRole('button', { name: /^【在线样例】河岸的两封信 Reader 原创示例/ }).click();
  await expect(dialog.getByRole('region', { name: '在线书籍详情' })).toContainText('为 Reader 验收创作的原创短篇');
  await dialog.getByRole('button', { name: '开始阅读' }).click();
  await expect(page.getByRole('heading', { name: '第一章 河岸来信', exact: true })).toBeVisible();
  await expect(page.locator('.reading-paragraphs')).toContainText('这是第一章的第二页');
  await page.getByRole('button', { name: '目录（T）' }).click();
  await expect(page.getByRole('navigation', { name: '章节目录' }).getByRole('button')).toHaveCount(2);
  await page.getByRole('navigation', { name: '章节目录' }).getByRole('button', { name: /第二章 灯下回信/ }).click();
  await expect(page.getByRole('heading', { name: '第二章 灯下回信', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '收藏当前段落（B）' }).click();
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.screenshot({ path: `artifacts/online-${suffix}-sample-reading.png`, fullPage: true });
  await page.getByRole('button', { name: '返回找书', exact: true }).click();
  await page.getByRole('button', { name: '书架', exact: true }).click();
  await expect(page.getByRole('button', { name: /^打开 【在线样例】河岸的两封信/ })).toBeVisible();
  await page.screenshot({ path: `artifacts/online-${suffix}-sample-shelf.png`, fullPage: true });
  const restart = await request.post('http://127.0.0.1:4179/restart');
  expect(restart.ok()).toBe(true);
  const pids = await restart.json(); expect(pids.current).not.toBe(pids.previous);
  await page.reload();
  await page.getByRole('button', { name: /^打开 【在线样例】河岸的两封信/ }).click();
  await expect(page.getByRole('heading', { name: '第二章 灯下回信', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除当前段落书签（B）' })).toBeVisible();
  await expect(page.locator('.reading-percent')).toContainText('100%');
  if (!publicMode) {
    expect((await (await request.post('http://127.0.0.1:4179/offline')).json()).fixture).toBe(true);
    const before = await (await request.post('http://127.0.0.1:4179/requests')).json();
    try {
      await page.getByRole('button', { name: /上一章 第一章 河岸来信/ }).click();
      await expect(page.locator('.reading-paragraphs')).toContainText('这是第一章的第二页');
      await page.getByRole('button', { name: /下一章 第二章 灯下回信/ }).click();
      await expect(page.getByRole('heading', { name: '第二章 灯下回信', exact: true })).toBeVisible();
      expect(await (await request.post('http://127.0.0.1:4179/requests')).json()).toEqual(before);
      await page.screenshot({ path: 'artifacts/online-fixture-sample-offline.png', fullPage: true });
    } finally { await request.post('http://127.0.0.1:4179/online'); }
  }
});
