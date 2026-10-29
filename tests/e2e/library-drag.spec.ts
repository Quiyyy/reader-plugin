import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { defaultAppearance } from '../../src/shared/workspace';

const mime = 'application/x-reader-library-items';
async function call(request: APIRequestContext, name: string, args: object = {}) {
  const response = await request.post('/api/tool', { headers: { 'X-Reader-Client': 'preview' }, data: { name, arguments: args } });
  expect(response.ok()).toBe(true); const result = await response.json(); expect(result.isError, JSON.stringify(result)).not.toBe(true); return result._meta.reader;
}
async function fixture(request: APIRequestContext, label: string) {
  await call(request, 'reader_appearance', { appearance: { ...defaultAppearance, mode: 'light' } });
  await call(request, 'reader_library_layout', { layout: 'cards' });
  const root = (await call(request, 'reader_folder_save', { name: label === 'layout' ? 'Agent' : '拖拽验收 ' + label, parentId: null })).value;
  const folder = (await call(request, 'reader_folder_save', { name: '参考资料', parentId: root.id })).value;
  const second = (await call(request, 'reader_folder_save', { name: '项目笔记', parentId: root.id })).value;
  const bytes = Buffer.from('第一章 阅读\n\n这是为交互验收编写的原创内容。' + label);
  const upload = await call(request, 'reader_import_begin', { filename: '阅读的方法.txt', size: bytes.length });
  await call(request, 'reader_import_chunk', { uploadId: upload.uploadId, index: 0, data: bytes.toString('base64') });
  const book = await call(request, 'reader_import_finish', { uploadId: upload.uploadId });
  await call(request, 'reader_book_metadata', { id: book.summary.id, revision: 0, metadata: { folderId: root.id, tags: ['原始标签'] } });
  const note = (await call(request, 'reader_note_create', { title: 'Agent 学习札记', body: '从上下文到工具调用，记录每次实践的观察。', folderId: root.id, tags: ['保留'], imageIds: [], sourceIds: [] })).value;
  return { root, folder, second, book, note };
}
async function enter(page: Page, name: string) {
  await page.goto('/'); await page.getByRole('button', { name: '打开文件夹 ' + name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('drag books and mixed selections into folders, undo, and drag back through breadcrumbs in list view', async ({ page, request }) => {
  const f = await fixture(request, 'move'); await enter(page, f.root.name);
  const book = page.locator(`[data-book-id="${f.book.summary.id}"] .library-open`), note = page.locator(`[data-note-id="${f.note.id}"] .library-open`);
  const target = page.locator(`[data-folder-id="${f.folder.id}"]`);
  const visits = (await call(request, 'reader_workspace')).visits;
  await book.dragTo(target); await expect(book).toHaveCount(0);
  expect((await call(request, 'reader_workspace')).books[f.book.summary.id]).toMatchObject({ folderId: f.folder.id, tags: ['原始标签'] });
  expect((await call(request, 'reader_workspace')).visits).toEqual(visits);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(book).toBeVisible();
  await page.getByRole('button', { name: '选择', exact: true }).click(); await book.click(); await note.click();
  await expect(page.locator('.library-entry.selected')).toHaveCount(2);
  await book.dragTo(target); await expect(book).toHaveCount(0); await expect(note).toHaveCount(0);
  expect(await call(request, 'reader_note_get', { id: f.note.id })).toMatchObject({ body: f.note.body, folderId: f.folder.id, tags: ['保留'] });
  await page.getByRole('button', { name: '打开文件夹 参考资料', exact: true }).click();
  await page.getByRole('button', { name: '列表视图', exact: true }).click(); await expect(note).toBeEnabled();
  await note.dragTo(page.getByRole('navigation', { name: '文件夹路径' }).getByRole('button', { name: f.root.name, exact: true }));
  await expect(note).toHaveCount(0);
  expect((await call(request, 'reader_note_get', { id: f.note.id })).folderId).toBe(f.root.id);
  await page.getByRole('button', { name: '返回上一级', exact: true }).click(); await expect(note).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: '打开文件夹 ' + f.root.name, exact: true }).click(); await expect(note).toBeVisible();
});

test('invalid, cancelled, foreign and stale drags cannot partially move library content', async ({ page, request }) => {
  const f = await fixture(request, 'boundaries'); await enter(page, f.root.name);
  const target = page.locator(`[data-folder-id="${f.folder.id}"]`), folder = target.locator('.library-open'), note = page.locator(`[data-note-id="${f.note.id}"] .library-open`);
  let moves = 0; page.on('request', req => { if (req.url().endsWith('/api/tool') && req.postDataJSON()?.name === 'reader_library_move') moves++; });
  const data = await page.evaluateHandle(() => new DataTransfer());
  await folder.dispatchEvent('dragstart', { dataTransfer: data }); await target.dispatchEvent('dragover', { dataTransfer: data });
  await expect(target).not.toHaveClass(/drop-over/); await target.dispatchEvent('drop', { dataTransfer: data }); expect(moves).toBe(0);
  await note.dispatchEvent('dragstart', { dataTransfer: data }); await target.dispatchEvent('dragover', { dataTransfer: data }); await expect(target).toHaveClass(/drop-over/);
  await page.keyboard.press('Escape'); await expect(target).not.toHaveClass(/drop-over/); await target.dispatchEvent('drop', { dataTransfer: data }); expect(moves).toBe(0);
  await data.evaluate((transfer, type) => transfer.setData(type, 'foreign-payload'), mime);
  await target.dispatchEvent('drop', { dataTransfer: data }); expect(moves).toBe(0);
  await note.dispatchEvent('dragstart', { dataTransfer: data });
  await call(request, 'reader_note_update', { id: f.note.id, revision: f.note.revision, patch: { body: '来自另一窗口的新内容' } });
  await target.dispatchEvent('dragover', { dataTransfer: data }); await target.dispatchEvent('drop', { dataTransfer: data });
  await expect(page.getByRole('alert')).toContainText('另一个窗口'); await expect(note).toBeVisible();
  expect(await call(request, 'reader_note_get', { id: f.note.id })).toMatchObject({ folderId: f.root.id, body: '来自另一窗口的新内容' });
  expect(moves).toBe(1); await data.dispose();
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['第一章 外部导入\n\n外部文件仍使用导入流程。'], '拖入原文件.txt', { type: 'text/plain' })); return transfer;
  });
  await page.locator('.library-shelf').dispatchEvent('drop', { dataTransfer: files });
  await expect(page.getByRole('heading', { name: '第一章 外部导入', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await expect(page.getByRole('heading', { name: f.root.name, exact: true })).toBeVisible();
  const imported = (await call(request, 'reader_list')).books.find((book: any) => book.title === '拖入原文件');
  expect((await call(request, 'reader_workspace')).books[imported.id].folderId).toBe(f.root.id); expect(moves).toBe(1); await files.dispose();
});

test('refined library toolbar, menus, empty state and drag targets fit light, dark and narrow layouts', async ({ page, request }) => {
  const f = await fixture(request, 'layout');
  for (const title of ['工具调用设计', '上下文与记忆', '一次迭代的复盘', '阅读清单']) await call(request, 'reader_note_create', { title, body: title === '阅读清单' ? '' : '把问题拆小，用可验证的结果推进下一步。', folderId: f.root.id, tags: [], imageIds: [], sourceIds: [] });
  await enter(page, f.root.name);
  for (const width of [1280, 744, 390, 320]) {
    await page.setViewportSize({ width, height: 860 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole('button', { name: '新建', exact: true })).toBeInViewport();
    await expect(page.getByRole('group', { name: '书库视图' })).toBeInViewport();
    expect(await page.locator('.library-heading h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(22);
    await page.getByRole('heading', { name: 'Agent', exact: true }).click(); await page.mouse.move(3, 3);
    await page.screenshot({ path: `artifacts/refined-library-${width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: '管理 阅读清单', exact: true }).click(); await expect(page.getByRole('menu', { name: '整理菜单' })).toBeInViewport(); await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: '打开文件夹 项目笔记', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加内容', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 744, height: 860 }); await page.screenshot({ path: 'artifacts/refined-library-empty.png', animations: 'disabled' });
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  await call(request, 'reader_appearance', { appearance: { ...defaultAppearance, mode: 'dark' } }); await page.reload();
  await page.getByRole('button', { name: '打开文件夹 Agent', exact: true }).click();
  await expect(page.locator('.study-workspace')).toHaveClass(/dark/); await page.screenshot({ path: 'artifacts/refined-library-dark.png', animations: 'disabled' });
  const data = await page.evaluateHandle(() => new DataTransfer());
  await page.locator(`[data-note-id="${f.note.id}"] .library-open`).dispatchEvent('dragstart', { dataTransfer: data });
  await page.locator(`[data-folder-id="${f.folder.id}"]`).dispatchEvent('dragover', { dataTransfer: data });
  await expect(page.locator(`[data-folder-id="${f.folder.id}"]`)).toHaveClass(/drop-over/);
  await page.screenshot({ path: 'artifacts/refined-library-drag.png', animations: 'disabled' }); await page.keyboard.press('Escape'); await data.dispose();
  await call(request, 'reader_appearance', { appearance: { ...defaultAppearance, mode: 'light' } });
});
