import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReaderStore } from '../src/server/store.js';
import { OnlineSourceService } from '../src/server/online/service.js';
import { IncompleteLoadError } from '../src/shared/online.js';
import { fixtureServer, fixtureSource } from './online/fixture.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); });
const signal = () => new AbortController().signal;
async function setup(options: { pages?: number; rows?: number; contentPages?: number; mode?: string; script?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'reader-pagination-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const state = { pages: 18, rows: 2, contentPages: 1, mode: '', script: false, ...options };
  const server = await fixtureServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const url = new URL(req.url!, 'https://reader.example.com'), page = Number(url.searchParams.get('p') ?? 1);
    if (url.pathname === '/toc') {
      if (state.mode === 'failure' && page === 3) { res.writeHead(503); res.end('temporary'); return; }
      if (state.mode === 'redirect' && page === 2) { res.writeHead(302, { Location: '/toc' }); res.end(); return; }
      const from = state.mode === 'duplicate' ? 0 : (page - 1) * state.rows;
      const rows = Array.from({ length: state.rows }, (_, i) => `<a href="/chapter/${from + i}">Original chapter ${from + i}</a>`).join('');
      const overlap = page > 1 && state.mode !== 'duplicate' ? `<a href="/chapter/${from - 1}">Overlapping navigation</a>` : '';
      const next = state.mode === 'cycle' ? '/toc' : page < state.pages ? `/toc?p=${page + 1}` : '';
      res.end(`<div class="chapters">${overlap}${rows}</div>${next ? `<a class="next" href="${next}">Next</a><a class="next" href="https://reader.example.com${next}#top">Next duplicate navigation</a>` : ''}`);
    } else if (url.pathname.startsWith('/chapter/')) {
      res.end(`<div id="content">Original paragraph on page ${state.mode === 'duplicate-content' ? 1 : page}.</div>${page < state.contentPages ? `<a class="next" href="${url.pathname}?p=${page + 1}">Next</a>` : ''}`);
    } else { res.writeHead(404); res.end('missing'); }
  });
  cleanups.push(server.close);
  const store = new ReaderStore(dir), online = new OnlineSourceService(store, server.client);
  const raw = { ...fixtureSource, ...(state.script ? { ruleToc: { ...fixtureSource.ruleToc, chapterName: '@text@js:result + " / " + page', nextTocUrl: '@js:java.put("counter", String(Number(java.get("counter")||0)+1));java.getStringList("a.next@href")[0]||"";' } } : {}) };
  const preview = await online.preview(JSON.stringify(raw)); await online.commit(preview.token); await online.manage(preview.sources[0].id, true);
  const source = await online.source(preview.sources[0].id);
  const detail = { sourceId: source.report.id, revision: source.report.revision, url: 'https://reader.example.com/book', tocUrl: 'https://reader.example.com/toc', title: 'Original long fixture', author: 'Reader tests', intro: '' };
  return { dir, store, online, detail, state, ...server };
}
async function complete<T>(work: () => Promise<T>) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await work(); }
    catch (error) { if (!(error instanceof IncompleteLoadError && error.incomplete.paused)) throw error; }
  }
  throw Error('unexpected endless continuation');
}

describe('bounded, resumable long directories and chapters', () => {
  it('loads 8000 unique chapters across 40 pages and a process restart without downloading the book', async () => {
    const f = await setup({ pages: 40, rows: 200 });
    await expect(f.online.add(f.detail, signal())).rejects.toMatchObject({ incomplete: { stage: 'toc', pages: 8, items: 1600, paused: true, resumable: true } });
    expect(await f.online.listBooks()).toEqual([]);
    expect((await f.online.listSources())[0].stages.toc.network).toBe('untested');
    expect(f.requests.filter(path => path.startsWith('/chapter/'))).toEqual([]);
    const restarted = new OnlineSourceService(new ReaderStore(f.dir), f.client);
    const book = await complete(() => restarted.add(f.detail, signal()));
    expect(book.document.chapters).toHaveLength(8000);
    expect(book.document.chapters[200].title).toBe('Original chapter 200');
    expect(new Set(f.requests.filter(path => path.startsWith('/toc'))).size).toBe(40);
    expect(f.requests.filter(path => path.startsWith('/toc'))).toHaveLength(40);
    expect(f.requests.filter(path => path.startsWith('/chapter/'))).toEqual(['/chapter/0']);
    expect(await readdir(join(f.dir, 'online-v1/pagination-v1'))).toEqual([]);
  }, 30_000);

  it('resumes a 17-page original chapter without caching or displaying partial body text', async () => {
    const f = await setup({ pages: 1, contentPages: 17 });
    await expect(f.online.add(f.detail, signal())).rejects.toMatchObject({ incomplete: { stage: 'content', pages: 8, items: 8, paused: true } });
    const [summary] = await f.online.listBooks();
    await expect(readdir(join(f.dir, 'online-v1/cache', summary.id))).rejects.toMatchObject({ code: 'ENOENT' });
    const restarted = new OnlineSourceService(new ReaderStore(f.dir), f.client);
    const book = await complete(() => restarted.open(summary.id, signal()));
    expect(book.document.chapters[0].paragraphs).toHaveLength(17);
    expect(book.document.chapters[0].paragraphs.at(-1)).toBe('Original paragraph on page 17.');
    expect(f.requests.filter(path => path.startsWith('/chapter/'))).toHaveLength(17);
  });

  it('keeps a good book, progress and bookmarks intact while refreshing; retries only the failed page', async () => {
    const f = await setup({ pages: 1 });
    const book = await f.online.add(f.detail, signal());
    const locator = { chapter: 0, paragraph: 0, chapterId: book.document.chapters[0].id };
    await f.online.saveProgress(book.summary.id, locator); await f.online.addBookmark(book.summary.id, locator, 'original bookmark');
    const path = join(f.dir, 'online-v1', `${book.summary.id}.json`), before = await readFile(path, 'utf8');
    f.state.pages = 10; f.state.mode = 'failure';
    await expect(f.online.refresh(book.summary.id, signal())).rejects.toMatchObject({ incomplete: { pages: 2, resumable: true, paused: false } });
    expect(await readFile(path, 'utf8')).toBe(before);
    const requests = f.requests.length; f.state.mode = '';
    const refreshed = await complete(() => f.online.refresh(book.summary.id, signal()));
    expect(f.requests[requests]).toBe('/toc?p=3');
    expect(refreshed.document.chapters).toHaveLength(20);
    expect(refreshed.bookmarks[0].label).toBe('original bookmark');
    expect(refreshed.summary.locator).toEqual(locator);
  });

  it.each(['cycle', 'redirect', 'duplicate'])('rejects %s loops and does not promote an incomplete directory', async mode => {
    const f = await setup({ mode });
    await expect(f.online.add(f.detail, signal())).rejects.toMatchObject({ incomplete: { resumable: false, paused: false } });
    expect(await f.online.listBooks()).toEqual([]);
    expect(f.requests.length).toBeLessThanOrEqual(3);
    expect(await readdir(join(f.dir, 'online-v1/pagination-v1'))).toEqual([]);
  });

  it('rejects duplicate body pages reached through changing URLs', async () => {
    const f = await setup({ pages: 1, contentPages: 6, mode: 'duplicate-content' });
    await expect(f.online.add(f.detail, signal())).rejects.toMatchObject({ incomplete: { stage: 'content', resumable: false } });
    expect(f.requests.filter(path => path.startsWith('/chapter/'))).toHaveLength(2);
  });

  it('retains script variables and page number across batches without relaxing the isolated runtime', async () => {
    // This case needs three batches, not a second large-row stress workload.
    // The separate 600-row case retains per-row script/worker recycling coverage.
    const f = await setup({ pages: 18, rows: 8, script: true });
    await expect(f.online.add(f.detail, signal())).rejects.toMatchObject({ incomplete: { pages: 8, items: 64, paused: true } });
    const book = await complete(() => f.online.add(f.detail, signal()));
    expect(book.document.chapters).toHaveLength(144);
    expect(book.document.chapters[80].title).toBe('Original chapter 80 / 11');
    const vars = JSON.parse(await readFile(join(f.dir, 'online-v1', `variables-${f.detail.sourceId}-${f.detail.revision}.json`), 'utf8'));
    expect(vars['book:https://reader.example.com/book'].counter).toBe('18');
  }, 30_000);

  it('does not reuse an interrupted directory after source disable/re-enable', async () => {
    const f = await setup();
    await expect(f.online.add(f.detail, signal())).rejects.toMatchObject({ incomplete: { paused: true } });
    await f.online.manage(f.detail.sourceId, false); await f.online.manage(f.detail.sourceId, true);
    const before = f.requests.length;
    await expect(f.online.add(f.detail, signal())).rejects.toMatchObject({ incomplete: { pages: 8, paused: true } });
    expect(f.requests[before]).toBe('/toc');
  });

  it('supports more than 500 small per-row scripts without raising CPU or WASM memory budgets', async () => {
    const f = await setup({ pages: 1, rows: 600, script: true });
    const book = await f.online.add(f.detail, signal());
    expect(book.document.chapters).toHaveLength(600);
    expect(book.document.chapters.at(-1)!.title).toBe('Original chapter 599 / 1');
  }, 20_000);

  it('stops an endless changing directory at the cumulative page budget across continuations', async () => {
    const f = await setup({ pages: 1000, rows: 1 });
    await expect(complete(() => f.online.add(f.detail, signal()))).rejects.toMatchObject({ incomplete: { pages: 256, resumable: false } });
    expect(f.requests).toHaveLength(256);
    expect(await f.online.listBooks()).toEqual([]);
  }, 30_000);
});
