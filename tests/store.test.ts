import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderStore } from '../src/server/store.js';
import { defaultSettings } from '../src/shared/types.js';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'reader-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const source = Buffer.from('第一章 风起\n一阵微风。\n另一阵微风。\n第二章 回家\n终于回家。', 'utf8');

describe('durable ReaderStore', () => {
  it('starts empty with server-backed defaults', async () => {
    const state = await new ReaderStore(directory).list();
    expect(state.books).toEqual([]);
    expect(state.settings).toEqual(defaultSettings);
    expect(state.storage.mode).toBe('server');
  });
  it('preserves source bytes and deduplicates exact uploads without resetting state', async () => {
    const store = new ReaderStore(directory);
    const book = await store.importBook('Original.txt', source);
    await store.saveProgress(book.summary.id, { chapter: 1, paragraph: 1 });
    await store.addBookmark(book.summary.id, { chapter: 1, paragraph: 1 }, 'Home');
    const duplicate = await store.importBook('Renamed.txt', source);
    expect(duplicate.summary.id).toBe(book.summary.id);
    expect(duplicate.summary.title).toBe('Original');
    expect(duplicate.summary.progress).toBe(1);
    expect(duplicate.bookmarks).toHaveLength(1);
    expect((await store.list()).books).toHaveLength(1);
    expect(await readFile(join(directory, 'books', book.summary.id, 'source.txt'))).toEqual(source);
    expect((await readdir(join(directory, 'books'))).filter(name => name.startsWith('.import-'))).toEqual([]);
  });
  it('reports a conflicting explicit encoding without changing an existing import', async () => {
    const store = new ReaderStore(directory);
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    const book = await store.importBook('Encoding.txt', bytes);
    expect(book.document.encoding).toBe('gb18030');
    await store.addBookmark(book.summary.id, { chapter: 0, paragraph: 0 }, 'Keep me');
    expect((await store.importBook('Encoding.txt', bytes, 'GB18030')).summary.id).toBe(book.summary.id);
    await expect(store.importBook('Encoding.txt', bytes, 'Big5')).rejects.toThrow(/Re-decoding an existing import is not available/);
    const retained = await store.open(book.summary.id);
    expect(retained.document.encoding).toBe('gb18030');
    expect(retained.document.chapters[0]!.paragraphs).toEqual(['中文']);
    expect(retained.bookmarks[0]!.label).toBe('Keep me');
  });
  it('recovers reading position, bookmarks, settings and stable paragraph indices after restart', async () => {
    const store = new ReaderStore(directory);
    const imported = await store.importBook('Journey.txt', source);
    const locator = { chapter: 0, paragraph: 2 };
    await store.saveProgress(imported.summary.id, locator);
    await store.addBookmark(imported.summary.id, locator, 'A moment');
    await store.saveSettings({ ...defaultSettings, theme: 'sepia', fontSize: 24 });
    const restarted = new ReaderStore(directory);
    const book = await restarted.open(imported.summary.id);
    expect(book.summary.locator).toEqual(locator);
    expect(book.summary.lastReadAt).toBeTruthy();
    expect(book.document.chapters[0]!.paragraphs[2]).toBe('另一阵微风。');
    expect(book.bookmarks[0]!.label).toBe('A moment');
    expect((await restarted.list()).settings.theme).toBe('sepia');
    expect((await restarted.open(imported.summary.id)).summary.locator).toEqual(locator);
  });
  it('serializes concurrent mutations across ReaderStore instances without dropping bookmarks', async () => {
    const first = new ReaderStore(directory), second = new ReaderStore(directory);
    const book = await first.importBook('Journey.txt', source);
    await Promise.all([
      first.addBookmark(book.summary.id, { chapter: 0, paragraph: 1 }, 'One'),
      second.addBookmark(book.summary.id, { chapter: 1, paragraph: 1 }, 'Two'),
      first.saveProgress(book.summary.id, { chapter: 0, paragraph: 2 }),
      second.open(book.summary.id),
    ]);
    const saved = await first.open(book.summary.id);
    expect(saved.bookmarks.map(bookmark => bookmark.label).sort()).toEqual(['One', 'Two']);
    expect(saved.summary.locator).toEqual({ chapter: 0, paragraph: 2 });
  });
  it('retains independent updates from separate Node processes and keeps progress records small', async () => {
    const store = new ReaderStore(directory);
    const book = await store.importBook('Journey.txt', source);
    const documentPath = join(directory, 'books', book.summary.id, 'document.json');
    const documentBefore = await readFile(documentPath, 'utf8');
    const moduleUrl = new URL('../src/server/store.ts', import.meta.url).href;
    const run = promisify(execFile);
    const worker = (paragraph: number) => run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import { ReaderStore } from ${JSON.stringify(moduleUrl)}; const store = new ReaderStore(${JSON.stringify(directory)}); await store.addBookmark(${JSON.stringify(book.summary.id)}, { chapter: 0, paragraph: ${paragraph} }, 'Process ${paragraph}');`]);
    await Promise.all([worker(1), worker(2)]);
    const restarted = new ReaderStore(directory);
    expect((await restarted.open(book.summary.id)).bookmarks).toHaveLength(2);
    await restarted.saveProgress(book.summary.id, { chapter: 1, paragraph: 1 });
    expect(await readFile(documentPath, 'utf8')).toBe(documentBefore);
    const record = await readFile(join(directory, 'books', book.summary.id, 'record.json'), 'utf8');
    expect(record.length).toBeLessThan(2_000);
    expect(JSON.parse(record)).not.toHaveProperty('document');
  });
  it('reports corrupted metadata without modifying the preserved original', async () => {
    const store = new ReaderStore(directory);
    const book = await store.importBook('Journey.txt', source);
    await writeFile(join(directory, 'books', book.summary.id, 'record.json'), '{not valid JSON');
    await expect(store.open(book.summary.id)).rejects.toThrow(/damaged/);
    expect(await readFile(join(directory, 'books', book.summary.id, 'source.txt'))).toEqual(source);
  });
  it('deduplicates simultaneous imports and repeated bookmarks, removes idempotently', async () => {
    const first = new ReaderStore(directory), second = new ReaderStore(directory);
    const [one, two] = await Promise.all([first.importBook('One.txt', source), second.importBook('Two.txt', source)]);
    expect(one.summary.id).toBe(two.summary.id);
    const marks = await first.addBookmark(one.summary.id, { chapter: 0, paragraph: 1 }, 'One');
    expect(await second.addBookmark(one.summary.id, { chapter: 0, paragraph: 1 }, 'Again')).toHaveLength(1);
    expect(await first.removeBookmark(one.summary.id, marks[0]!.id)).toEqual([]);
    expect(await first.removeBookmark(one.summary.id, marks[0]!.id)).toEqual([]);
  });
  it('rejects invalid IDs, locators, filenames and settings without changing existing state', async () => {
    const store = new ReaderStore(directory);
    const book = await store.importBook('Journey.txt', source);
    await expect(store.open('../../secret')).rejects.toThrow(/Invalid book ID/);
    await expect(store.saveProgress(book.summary.id, { chapter: 0, paragraph: 999 })).rejects.toThrow(/outside/);
    await expect(store.saveProgress(book.summary.id, { chapter: -1, paragraph: 0 })).rejects.toThrow();
    await expect(store.saveSettings({ ...defaultSettings, fontSize: 1_000 })).rejects.toThrow();
    await expect(store.addBookmark(book.summary.id, { chapter: 0, paragraph: 0 }, 'x'.repeat(241))).rejects.toThrow(/240/);
    await expect(store.importBook('invalid.zip', source)).rejects.toThrow(/Only/);
    expect((await store.open(book.summary.id)).summary.locator).toEqual({ chapter: 0, paragraph: 0 });
    expect((await store.list()).settings).toEqual(defaultSettings);
  });
  it('keeps originals when an import fails and leaves no partial library entry', async () => {
    const store = new ReaderStore(directory);
    await expect(store.importBook('broken.epub', Buffer.from('not an epub'))).rejects.toThrow();
    expect((await store.list()).books).toEqual([]);
    expect(await readdir(join(directory, '.locks'))).toEqual([]);
    expect(await readdir(join(directory, 'books'))).toEqual([]);
  });
});
