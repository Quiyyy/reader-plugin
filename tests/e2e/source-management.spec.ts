import { test, expect, type APIRequestContext } from '@playwright/test';
import { fixtureSource } from '../online/source';
import { defaultSettings } from '../../src/shared/types';

async function tool(request: APIRequestContext, name: string, args: object = {}) {
  const response = await request.post('/api/tool', { headers: { 'X-Reader-Client': 'preview' }, data: { name, arguments: args } });
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.isError).not.toBe(true);
  return result._meta.reader;
}
for (const width of [320, 390, 1280]) {
  test(`source manager search, switches, details, cancellation and keyboard at ${width}px`, async ({ page, request }) => {
    for (const source of await tool(request, 'reader_online_sources')) await tool(request, 'reader_online_remove', { id: source.id });
    await tool(request, 'reader_settings', { settings: defaultSettings });
    await page.setViewportSize({ width, height: width === 320 ? 720 : 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '找书', exact: true }).click();
    await page.getByRole('button', { name: '管理书源', exact: true }).click();
    await expect(page.getByRole('heading', { name: '还没有书源' })).toBeVisible();
    await page.screenshot({ path: `artifacts/source-manager-empty-${width}.png` });

    const sources = [
      { ...fixtureSource, bookSourceName: '河岸书源', bookSourceUrl: 'https://reader.example.com/river' },
      { ...fixtureSource, bookSourceName: '晚风书源', bookSourceUrl: 'https://evening.example.com/' },
      { ...fixtureSource, bookSourceName: '需要登录的来源', bookSourceUrl: 'https://reader.example.com/login-required', loginUrl: 'https://reader.example.com/login' },
    ];
    const preview = await tool(request, 'reader_online_preview', { json: JSON.stringify(sources) });
    await tool(request, 'reader_online_commit', { token: preview.token });
    await tool(request, 'reader_online_enable', { id: preview.sources[0].id, enabled: true });
    await page.reload();
    await page.getByRole('button', { name: '找书', exact: true }).click();
    await page.getByRole('button', { name: '管理书源', exact: true }).click();
    const manager = page.getByRole('region', { name: '已保存书源' });
    await expect(manager.locator('.managed-source')).toHaveCount(3);
    await expect(manager.locator('.source-status')).toHaveCount(0);
    await expect(manager.getByRole('switch', { name: '停用 河岸书源', exact: true })).toBeChecked();
    await expect(manager.getByRole('switch', { name: '启用 需要登录的来源', exact: true })).toBeDisabled();
    await page.screenshot({ path: `artifacts/source-manager-list-${width}.png` });
    expect(await page.locator('.discovery-shell').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

    const search = manager.getByRole('searchbox', { name: '搜索书源名称或域名' });
    await search.fill('evening.example.com');
    await expect(manager.locator('.managed-source')).toHaveCount(1);
    await expect(manager.getByRole('heading', { name: '晚风书源', exact: true })).toBeVisible();
    await search.fill('不存在的来源');
    await expect(manager.getByRole('heading', { name: '没有找到书源' })).toBeVisible();
    await manager.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(search).toBeFocused();
    await manager.getByRole('combobox', { name: '筛选书源' }).selectOption('unavailable');
    await expect(manager.locator('.managed-source')).toHaveCount(1);
    await expect(manager.getByRole('heading', { name: '需要登录的来源' })).toBeVisible();
    await manager.getByRole('combobox', { name: '筛选书源' }).selectOption('all');
    await manager.getByRole('switch', { name: '启用 晚风书源', exact: true }).click();
    await expect(manager.getByRole('switch', { name: '停用 晚风书源', exact: true })).toBeChecked();

    const more = manager.locator('summary[aria-label="更多操作 晚风书源"]');
    await more.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(manager.getByRole('button', { name: '查看详情', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(manager.locator('.source-status > summary')).toBeFocused();
    await expect(manager.locator('.source-status table')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(manager.locator('.source-status')).toHaveCount(0);
    await expect(more).toBeFocused();
    await more.click();
    await page.keyboard.press('Escape');
    await expect(manager.getByRole('button', { name: '移除书源', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '书源管理', exact: true })).toBeVisible();
    await more.click();
    await manager.getByRole('button', { name: '移除书源', exact: true }).click();
    await expect(manager.getByRole('button', { name: '确认移除', exact: true })).toBeFocused();
    await manager.getByRole('button', { name: '保留书源', exact: true }).click();
    await expect(manager.locator('.managed-source')).toHaveCount(3);
    await expect(more).toBeFocused();

    const before = await tool(request, 'reader_online_sources');
    await page.getByRole('button', { name: '导入书源', exact: true }).click();
    await page.getByLabel('选择书源 JSON').setInputFiles({ name: 'additional-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixtureSource, bookSourceName: '尚未保存的来源', bookSourceUrl: 'https://reader.example.com/new' })) });
    await expect(page.getByRole('region', { name: '导入预览' })).toBeVisible();
    await expect(page.locator('.source-preview .source-status table')).toBeHidden();
    await page.screenshot({ path: `artifacts/source-manager-import-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '导入书源', exact: true })).toHaveCount(0);
    expect(await tool(request, 'reader_online_sources')).toEqual(before);
    await expect(page.getByRole('button', { name: '导入书源', exact: true })).toBeFocused();
  });
}
