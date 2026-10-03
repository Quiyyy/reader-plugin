import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderStore } from '../src/server/store.js';
import { OnlineSourceService } from '../src/server/online/service.js';
import { defaultKeyboard, keyboardSchema, shortcutError } from '../src/shared/keyboard.js';
import { fixtureServer, fixtureSource } from './online/fixture.js';
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'Reader 回收站 ')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const bytes = Buffer.from('第一章 风起\n\n原创段落甲。\n\n原创段落乙。\n\n第二章 灯光\n\n结尾。');
describe('reversible library transactions', () => {
  it('retains bytes, progress, bookmarks, identity and same-title imports through restart/restore', async () => {
    const store = new ReaderStore(directory), a = await store.importBook('同名.txt', bytes);
    const loc = { chapter: 1, paragraph: 1 };
    await store.saveProgress(a.summary.id, loc); await store.addBookmark(a.summary.id, loc, '保存');
    const snapshot = await readFile(join(directory, 'books', a.summary.id, 'record.json'));
    await store.trashBook(a.summary.id);
    expect((await store.list()).books).toEqual([]);
    await expect(store.saveProgress(a.summary.id, { chapter: 0, paragraph: 0 })).rejects.toThrow('回收站');
    await expect(store.importBook('重复.txt', bytes)).rejects.toThrow('恢复');
    const b = await store.importBook('同名.txt', Buffer.concat([bytes, Buffer.from('\n新内容')]));
    const restarted = new ReaderStore(directory);
    expect((await restarted.listTrash())[0].summary.locator).toEqual(loc);
    expect(await readFile(join(directory, 'books', a.summary.id, 'record.json'))).toEqual(snapshot);
    await restarted.restoreBook(a.summary.id);
    expect((await restarted.list()).books.map(book => book.id).sort()).toEqual([a.summary.id, b.summary.id].sort());
    const restored = await restarted.open(a.summary.id);
    expect(restored.summary.locator).toEqual(loc); expect(restored.bookmarks[0].label).toBe('保存');
    expect(await readFile(join(directory, 'books', a.summary.id, 'source.txt'))).toEqual(bytes);
  });
  it('serializes concurrent trash, duplicate import and progress writers without resurrection', async () => {
    const store = new ReaderStore(directory), book = await store.importBook('并发.txt', bytes), id = book.summary.id;
    await Promise.allSettled([store.trashBook(id), store.saveProgress(id, { chapter: 1, paragraph: 0 }), store.importBook('重复.txt', bytes)]);
    expect((await store.list()).books).toHaveLength(0); expect(await store.listTrash()).toHaveLength(1);
    await store.restoreBook(id); expect((await store.list()).books).toHaveLength(1);
  });
  it('gates online record/cache together, keeps sources, restores offline without reset', async () => {
    const fixture = await fixtureServer();
    try {
      const store = new ReaderStore(directory), online = new OnlineSourceService(store, fixture.client), signal = new AbortController().signal;
      const preview = await online.preview(JSON.stringify(fixtureSource)); await online.commit(preview.token); await online.manage(preview.sources[0].id, true);
      const result = (await online.search(preview.sources[0].id, '原创', 1, signal))[0];
      const detail = await online.detail(result, signal), book = await online.add(detail, signal);
      const chapter = book.document.chapters[1]; await online.chapter(book.summary.id, chapter.id, signal);
      const locator = { chapter: 1, chapterId: chapter.id, paragraph: 1 };
      await online.saveProgress(book.summary.id, locator); await online.addBookmark(book.summary.id, locator, '在线保存');
      const sources = await readFile(join(directory, 'online-v1', 'sources.json'));
      await online.trashBook(book.summary.id);
      expect(await online.listBooks()).toEqual([]);
      await expect(online.add(detail, signal)).rejects.toThrow('回收站');
      await expect(online.chapter(book.summary.id, chapter.id, signal)).rejects.toThrow('回收站');
      expect(await readFile(join(directory, 'online-v1', 'sources.json'))).toEqual(sources);
      fixture.setOffline(true); const requests = fixture.requests.length;
      const restarted = new ReaderStore(directory); await restarted.restoreBook(book.summary.id);
      const restored = await new OnlineSourceService(restarted, fixture.client).open(book.summary.id, signal);
      expect(restored.summary.locator).toEqual(locator); expect(restored.bookmarks[0].label).toBe('在线保存'); expect(restored.document.chapters[1].paragraphs[1]).toBe('这是原创测试段落。');
      expect(fixture.requests).toHaveLength(requests);
    } finally { await fixture.close(); }
  });
});
it('rejects a chapter response started before trash even when the book is quickly restored', async () => {
  const fixture = await fixtureServer();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const observed = new Promise<void>(resolve => { started = resolve; });
  try {
    const store = new ReaderStore(directory), online = new OnlineSourceService(store, fixture.client), signal = new AbortController().signal;
    const preview = await online.preview(JSON.stringify(fixtureSource)); await online.commit(preview.token); await online.manage(preview.sources[0].id, true);
    const result = (await online.search(preview.sources[0].id, '原创', 1, signal))[0], detail = await online.detail(result, signal), book = await online.add(detail, signal);
    const originalGet = fixture.client.get.bind(fixture.client);
    vi.spyOn(fixture.client, 'get').mockImplementation(async (...args) => { const response = await originalGet(...args); if (String(args[0]).includes('/chapter/two')) { started(); await gate; } return response; });
    const pending = online.chapter(book.summary.id, book.document.chapters[1].id, signal);
    const rejected = expect(pending).rejects.toThrow('过期请求');
    await observed; await online.trashBook(book.summary.id); await store.restoreBook(book.summary.id); release(); await rejected;
    fixture.setOffline(true); const restored = await online.open(book.summary.id, signal);
    expect(restored.summary.locator.chapter).toBe(0); expect(restored.document.chapters[1].loaded).toBe(false);
  } finally { release(); vi.restoreAllMocks(); await fixture.close(); }
});
describe('keyboard settings', () => {
  it('preserves legacy reading settings, validates duplicates/reserved keys and backs up resets', async () => {
    const store = new ReaderStore(directory); expect(await store.keyboard()).toEqual(defaultKeyboard);
    expect(shortcutError('Ctrl+KeyW', 'closeHost', defaultKeyboard.bindings)).toBeTruthy();
    expect(shortcutError('Alt+F4', 'closeHost', defaultKeyboard.bindings)).toBeTruthy();
    expect(shortcutError('Meta+KeyQ', 'closeHost', defaultKeyboard.bindings)).toBeTruthy();
    expect(shortcutError('ArrowUp', 'scrollDown', defaultKeyboard.bindings)).toContain('重复');
    const settings = { version: 1 as const, bindings: { ...defaultKeyboard.bindings, closeHost: 'Ctrl+Shift+Period' } };
    expect(keyboardSchema.parse(settings)).toEqual(settings);
    await store.saveKeyboard(settings); expect(await new ReaderStore(directory).keyboard()).toEqual(settings);
    await store.saveKeyboard(defaultKeyboard);
    expect(JSON.parse(await readFile(join(directory, 'keyboard-v1.before-save.json'), 'utf8'))).toEqual(settings);
    await writeFile(join(directory, 'keyboard-v1.json'), 'broken');
    await expect(store.keyboard()).rejects.toThrow('损坏'); await store.saveKeyboard(defaultKeyboard);
    expect(await store.keyboard()).toEqual(defaultKeyboard); expect(await readFile(join(directory, 'keyboard-v1.before-save.json'), 'utf8')).toBe('broken');
  });
});
