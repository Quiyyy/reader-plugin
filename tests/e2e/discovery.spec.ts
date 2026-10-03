import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { fixtureSource } from '../online/source';

async function tool(request: APIRequestContext, name: string, args: object = {}) {
  const response = await request.post('/api/tool', { headers: { 'X-Reader-Client': 'preview' }, data: { name, arguments: args } });
  expect(response.ok()).toBe(true);
  const data = await response.json(); expect(data.isError).not.toBe(true); return data._meta.reader;
}
async function clearSources(request: APIRequestContext) {
  for (const source of await tool(request, 'reader_online_sources')) await tool(request, 'reader_online_remove', { id: source.id });
}
async function upload(page: Page, source: object = fixtureSource) {
  await page.getByLabel('选择书源 JSON').setInputFiles({ name: 'original-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.getByRole('region', { name: '导入预览' })).toBeVisible();
}
async function seed(request: APIRequestContext, sources: object[]) {
  const preview = await tool(request, 'reader_online_preview', { json: JSON.stringify(sources) });
  await tool(request, 'reader_online_commit', { token: preview.token });
  for (const source of preview.sources) await tool(request, 'reader_online_enable', { id: source.id, enabled: true });
}

for (const width of [320, 390, 1280]) {
  test(`discovery onboarding, wizard focus and retained reading route at ${width}px`, async ({ page, request }) => {
    await clearSources(request);
    await page.setViewportSize({ width, height: width === 320 ? 720 : 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '找书', exact: true }).click();
    await expect(page.getByText('先添加一个找书的来源')).toBeVisible();
    await page.screenshot({ path: `artifacts/redesign-empty-${width}.png` });
    await page.getByRole('button', { name: '导入书源', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: '导入书源', exact: true });
    await expect(wizard.getByRole('heading', { name: '添加你信任的来源' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(wizard.getByRole('button', { name: '关闭导入' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(wizard.locator('summary')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(wizard.getByRole('button', { name: '关闭导入' })).toBeFocused();
    await page.screenshot({ path: `artifacts/redesign-import-${width}.png` });
    await upload(page);
    await expect(wizard).toContainText('只检查格式；导入后需启用并试读。');
    await page.screenshot({ path: `artifacts/redesign-review-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(wizard).toHaveCount(0);
    await expect(page.getByRole('button', { name: '导入书源', exact: true })).toBeFocused();
    expect(await tool(request, 'reader_online_sources')).toEqual([]);
    await page.getByRole('button', { name: '导入书源', exact: true }).click();
    await upload(page);
    let commits = 0;
    page.on('request', r => { if (r.url().endsWith('/api/tool') && r.postDataJSON()?.name === 'reader_online_commit') commits++; });
    await wizard.getByRole('button', { name: '确认导入', exact: true }).evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
    await expect(wizard.getByRole('region', { name: '导入完成' })).toBeVisible();
    expect(commits).toBe(1);
    await page.screenshot({ path: `artifacts/redesign-saved-${width}.png` });
    // Saving alone does not enable sources; close and recover from the empty state.
    if (width === 1280) {
      await wizard.getByRole('button', { name: '启用并找书' }).click();
      await expect(wizard).toHaveCount(0);
    } else {
    await wizard.getByRole('button', { name: '关闭导入' }).click();
    await expect(page.getByText('还没有启用的书源')).toBeVisible();
    await page.getByRole('button', { name: '去启用书源' }).click();
    await page.getByRole('switch', { name: '启用 原创公开文本测试源', exact: true }).click();
    await page.getByRole('button', { name: '找书', exact: true }).click();
    }
    await expect(page.getByLabel('在线搜索关键词')).toBeFocused();
    await page.getByLabel('在线搜索关键词').fill('原创');
    await page.keyboard.press('Enter');
    const result = page.getByRole('button', { name: /^原创河岸故事 Reader 测试作者/ });
    await expect(result).toContainText('来自 原创公开文本测试源');
    await result.click();
    await expect(page.getByRole('button', { name: '返回搜索结果' })).toBeFocused();
    await page.screenshot({ path: `artifacts/redesign-detail-${width}.png` });
    await page.getByRole('button', { name: '开始阅读' }).click();
    await expect(page.getByRole('heading', { name: '第一章 河岸', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回找书', exact: true }).click();
    await expect(page.getByRole('region', { name: '在线书籍详情' })).toBeVisible();
    await page.getByRole('button', { name: '返回搜索结果' }).click();
    await expect(result).toBeFocused();
    await expect(page.getByLabel('在线搜索关键词')).toHaveValue('原创');
    await page.screenshot({ path: `artifacts/redesign-results-${width}.png` });
    expect(await page.locator('.discovery-shell').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '书架', exact: true }).click();
    await expect(page.getByRole('button', { name: '找书', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '找书', exact: true }).click();
    await expect(page.getByLabel('在线搜索关键词')).toHaveValue('原创');
  });
}

for (const action of ['cancel', 'close']) test(`wizard validates errors and ${action} ignores in-flight preview without a late result`, async ({ page, request }) => {
  await clearSources(request); await page.goto('/');
  await page.getByRole('button', { name: '找书', exact: true }).click();
  await page.getByRole('button', { name: '导入书源', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '导入书源', exact: true });
  await page.getByLabel('选择书源 JSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(wizard.getByRole('alert')).toBeVisible();
  await upload(page);
  await wizard.getByRole('button', { name: '重新选择' }).click();
  await expect(wizard.getByRole('heading', { name: '添加你信任的来源' })).toBeFocused();
  let release!: () => void, seen!: () => void, released!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { seen = resolve; });
  const finished = new Promise<void>(resolve => { released = resolve; });
  let cancelled = 0;
  page.on('request', r => { if (r.url().endsWith('/api/tool') && r.postDataJSON()?.name === 'reader_online_cancel') cancelled++; });
  await page.route('**/api/tool', async route => {
    if (route.request().postDataJSON()?.name !== 'reader_online_preview_url') return route.continue();
    const response = await route.fetch(); seen(); await gate; await route.fulfill({ response }); released();
  });
  await wizard.getByLabel('书源 JSON 链接').fill('https://raw.githubusercontent.com/Quiyyy/reader-plugin/refs/heads/main/examples/online/reader-demo.json');
  await wizard.getByRole('button', { name: '检查链接' }).click(); await started;
  if (action === 'cancel') {
    await wizard.getByRole('button', { name: '取消', exact: true }).click();
    await expect(wizard.getByRole('status')).toContainText('已取消');
  }
  await wizard.getByRole('button', { name: '关闭导入' }).click();
  release(); await finished;
  await expect(wizard).toHaveCount(0);
  expect(cancelled).toBeGreaterThan(0);
  expect(await tool(request, 'reader_online_sources')).toEqual([]);
  await page.getByRole('button', { name: '导入书源', exact: true }).click();
  await expect(wizard.getByRole('region', { name: '导入预览' })).toHaveCount(0);
  await expect(wizard.getByRole('heading', { name: '添加你信任的来源' })).toBeVisible();
});

test('failed sources stay below usable results, retry preserves results, cancel ignores late search', async ({ page, request }) => {
  await clearSources(request);
  await seed(request, [fixtureSource, { ...fixtureSource, bookSourceName: '暂时离线的来源', bookSourceUrl: 'https://reader.example.com/failing', searchUrl: '/missing' }]);
  await page.goto('/'); await page.getByRole('button', { name: '找书', exact: true }).click();
  await page.getByLabel('在线搜索关键词').fill('原创');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const results = page.getByRole('region', { name: '在线搜索结果' });
  await expect(results.getByRole('button', { name: /^原创河岸故事/ })).toBeEnabled();
  await expect(page.locator('.search-failures')).toContainText('1 个来源暂未返回结果，其他结果仍可阅读');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('.search-failures summary').click();
  await page.getByRole('button', { name: '重试这些来源' }).click();
  await expect(results.getByRole('button', { name: /^原创河岸故事/ })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/redesign-partial-failure.png' });
  let release!: () => void, seen!: () => void, released!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { seen = resolve; });
  const finished = new Promise<void>(resolve => { released = resolve; });
  await page.getByLabel('搜索书源').selectOption({ label: '原创公开文本测试源' });
  await page.route('**/api/tool', async route => {
    if (route.request().postDataJSON()?.name !== 'reader_online_search') return route.continue();
    const response = await route.fetch(); seen(); await gate; await route.fulfill({ response }); released();
  });
  await page.getByRole('button', { name: '搜索', exact: true }).click(); await started;
  await page.getByRole('button', { name: '取消', exact: true }).click();
  release(); await finished;
  await expect(page.locator('.online-notice')).toContainText('已取消');
  await expect(results).toHaveCount(0);
  await expect(page.getByRole('button', { name: '搜索', exact: true })).toBeEnabled();
});
