import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BookDetail, BookSummary, Bookmark, Locator } from '../../shared/types.js';
import type { OnlineDetail, OnlineResult, SourcePreview, SourceReport, Stage } from '../../shared/online.js';
import { atomicWrite, ReaderStore } from '../store.js';
import { hash, importSources, inspectSource, SOURCE_LIMITS, stageKeys, type Source } from './import.js';
import { SafeHttpClient, sameOriginUrl } from './http.js';
import { searchRequest } from './request.js';
import { compileRule, documentContext, extract, select, cleanContent } from './rules.js';

const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
const chapterSchema = z.object({ id: idSchema, title: z.string().max(500), url: z.string().max(4096) });
const locatorSchema = z.object({ chapter: z.number().int().nonnegative(), paragraph: z.number().int().nonnegative(), chapterId: idSchema });
const recordSchema = z.object({ version: z.literal(1), id: idSchema, sourceId: idSchema, revision: idSchema, url: z.string(), tocUrl: z.string(), title: z.string(), author: z.string(), chapters: z.array(chapterSchema).min(1).max(SOURCE_LIMITS.chapters), locator: locatorSchema, bookmarks: z.array(z.object({ id: z.string(), locator: locatorSchema, label: z.string(), createdAt: z.string() })).max(1000), addedAt: z.string(), lastReadAt: z.string().optional() });
type RecordBook = z.infer<typeof recordSchema>;
type Toc = RecordBook['chapters'];
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const err = (error: unknown) => error instanceof Error ? error.message : '联网操作失败';
const cleanTitle = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 500);
function changedFields(before: any, after: any, path = ''): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changedFields(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

/** Separate versioned records and per-chapter caches; local TXT/EPUB schema stays v1. */
export class OnlineSourceService {
  private readonly directory: string;
  private previews = new Map<string, { sources: Source[]; previous: string; expires: number }>();
  private jobs = new Map<string, { controller: AbortController; promise: Promise<unknown>; key: string; users: Set<string> }>();
  constructor(private readonly store: ReaderStore, private readonly http = new SafeHttpClient()) { this.directory = join(store.dataDir, 'online-v1'); }
  private async ready() { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  private path(id: string) { idSchema.parse(id); return join(this.directory, `${id}.json`); }
  private async sources(): Promise<Source[]> {
    await this.ready();
    try {
      const stored = JSON.parse(await fs.readFile(join(this.directory, 'sources.json'), 'utf8'));
      if (stored.version !== 1 || !Array.isArray(stored.sources) || stored.sources.length > SOURCE_LIMITS.stored) throw new Error('Invalid sources');
      return stored.sources.map((source: Source) => {
        const inspected = inspectSource(source.raw);
        if (inspected.report.revision !== source.report.revision) throw new Error('Invalid source revision');
        inspected.generation = source.generation ?? source.report.revision;
        inspected.report.enabled = source.report.enabled === true && ['supported', 'partial'].includes(inspected.report.syntax);
        for (const stage of ['search', 'detail', 'toc', 'content'] as Stage[]) {
          const old = source.report.stages[stage];
          if (old && ['untested', 'passed', 'failed'].includes(old.network)) Object.assign(inspected.report.stages[stage], { network: old.network, lastError: old.lastError, checkedAt: old.checkedAt });
        }
        return inspected;
      });
    } catch (error) { if (missing(error)) return []; throw new Error('在线书源存储损坏；本地书籍不受影响'); }
  }
  private async writeSources(sources: Source[]) { await atomicWrite(join(this.directory, 'sources.json'), JSON.stringify({ version: 1, sources })); }
  async listSources(): Promise<SourceReport[]> { return (await this.sources()).map(s => s.report); }
  async preview(json: string): Promise<SourcePreview> {
    const sources = importSources(json), existing = await this.sources();
    for (const [key, entry] of this.previews) if (entry.expires < Date.now()) this.previews.delete(key);
    if (this.previews.size >= 4) this.previews.delete(this.previews.keys().next().value!);
    const token = randomUUID();
    this.previews.set(token, { sources, previous: this.fingerprint(existing), expires: Date.now() + 10 * 60_000 });
    return { token, sources: sources.map(s => s.report), changes: sources.map(source => { const old = existing.find(s => s.report.id === source.report.id); return { id: source.report.id, kind: !old ? 'new' : old.report.revision === source.report.revision ? 'unchanged' : 'replace', previousName: old?.report.name, fields: old ? changedFields(old.raw, source.raw) : Object.keys(source.raw) }; }) };
  }
  async previewUrl(url: string, signal: AbortSignal) { const response = await this.http.get(url, signal); return this.preview(response.text); }
  private fingerprint(sources: Source[]) { return hash(JSON.stringify(sources.map(s => [s.report.id, s.report.revision, s.report.enabled, s.generation]))); }
  async commit(token: string) {
    const entry = this.previews.get(token);
    if (!entry || entry.expires < Date.now()) throw new Error('导入预览已过期，请重新预览');
    return this.store.locked('online-sources', async () => {
      const existing = await this.sources();
      if (this.fingerprint(existing) !== entry.previous) throw new Error('书源已发生变化，请重新预览并确认差异');
      for (const source of entry.sources) {
        const index = existing.findIndex(s => s.report.id === source.report.id);
        if (index >= 0 && existing[index]!.report.revision === source.report.revision) continue;
        source.generation = randomUUID();
        if (index >= 0) existing[index] = source; else existing.push(source);
      }
      if (existing.length > SOURCE_LIMITS.stored) throw new Error('最多保存 100 个书源');
      await this.writeSources(existing); this.previews.delete(token);
      return existing.map(s => s.report);
    });
  }
  async manage(id: string, enabled: boolean | null) {
    return this.store.locked('online-sources', async () => {
      let sources = await this.sources(); const source = sources.find(s => s.report.id === id);
      if (!source) throw new Error('书源不存在');
      if (enabled && !['supported', 'partial'].includes(source.report.syntax)) throw new Error('该源语法不可用，无法启用');
      if (enabled === null) sources = sources.filter(s => s !== source); else { source.report.enabled = enabled; source.generation = randomUUID(); }
      await this.writeSources(sources); return sources.map(s => s.report);
    });
  }
  async source(id: string, revision?: string, generation?: string): Promise<Source> {
    const source = (await this.sources()).find(s => s.report.id === id);
    if (!source?.report.enabled) throw new Error('书源未启用或已移除；已有缓存仍可阅读');
    if (revision && source.report.revision !== revision) throw new Error('书源版本已改变，请重新搜索添加；旧缓存和进度保留');
    if (generation && source.generation !== generation) throw new Error('书源启停状态已改变，已丢弃过期响应');
    return source;
  }
  private async tracked<T>(source: Source, stage: Stage, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const report = source.report.stages[stage];
    if (!['supported', 'partial'].includes(report.syntax)) throw new Error(`${stageKeys[stage]}：该阶段语法 ${report.syntax}，请查看字段诊断`);
    const update = async (error?: string) => this.store.locked('online-sources', async () => {
      const sources = await this.sources(), current = sources.find(s => s.report.id === source.report.id);
      if (current?.report.revision === source.report.revision && current.generation === source.generation && current.report.enabled) {
        Object.assign(current.report.stages[stage], { network: error ? 'failed' : 'passed', lastError: error, checkedAt: new Date().toISOString() });
        await this.writeSources(sources);
      } else if (!error) throw new Error('书源状态已变化，已丢弃过期响应');
    });
    try { signal.throwIfAborted(); const result = await work(); signal.throwIfAborted(); await this.source(source.report.id, source.report.revision, source.generation); await update(); return result; }
    catch (error) { if (!signal.aborted) await update(err(error)); throw error; }
  }
  private rule(source: Source, stage: Stage, field: string) { return source.raw[stageKeys[stage]]?.[field] as string | undefined; }
  private values(source: Source, stage: Stage, field: string, context: any, required = false): string[] {
    try {
      const text = this.rule(source, stage, field);
      let values = text ? extract(compileRule(text), context) : [];
      const replacement = field === 'content' && this.rule(source, stage, 'replaceRegex');
      if (replacement) values = values.map(value => cleanContent(value, replacement, context)).filter(value => value.trim());
      if ((required || text && !['nextTocUrl', 'nextContentUrl'].includes(field)) && !values.length) throw new Error('没有匹配到非空结果');
      return values;
    } catch (error) { throw new Error(`${stageKeys[stage]}.${field}：${err(error)}`); }
  }
  private rows(source: Source, stage: Stage, field: string, context: any, allowEmpty = false): any[] {
    try { const result = select(compileRule(this.rule(source, stage, field)!, true), context, { strictJson: true }); if (!allowEmpty && !result.length) throw new Error('没有匹配到列表'); return result; }
    catch (error) { throw new Error(`${stageKeys[stage]}.${field}：${err(error)}`); }
  }
  private url(source: Source, value: string, base: string, field: string): string {
    try {
      if (field === 'ruleToc.chapterUrl' && new URL(value, base).hash) throw new Error('首版不支持以 URL 片段区分章节，未合并这些章节');
      return sameOriginUrl(value, base, new URL(source.report.url).origin);
    }
    catch (error) { throw new Error(`${field}：${err(error)}`); }
  }
  async search(sourceId: string, key: string, page: number, signal: AbortSignal): Promise<OnlineResult[]> {
    const source = await this.source(sourceId);
    return this.tracked(source, 'search', signal, async () => {
      if (page > 1 && !source.raw.searchUrl.includes('{{page}}')) throw new Error('searchUrl：该源未声明 {{page}}，不支持搜索翻页');
      const request = searchRequest(source.raw.searchUrl, key, page);
      const url = this.url(source, request.url, source.report.url, 'searchUrl');
      const response = request.method === 'POST' ? await this.http.post(url, request.body!, signal, new URL(source.report.url).origin) : await this.http.get(url, signal, new URL(source.report.url).origin);
      let context: any;
      try { context = documentContext(response.text); }
      catch (error) { throw new Error(`ruleSearch.bookList：响应解析失败：${err(error)}`); }
      const results = new Map<string, OnlineResult>();
      for (const row of this.rows(source, 'search', 'bookList', context, true)) {
        const url = this.url(source, this.values(source, 'search', 'bookUrl', row, true)[0]!, response.url, 'ruleSearch.bookUrl');
        results.set(url, { sourceId, revision: source.report.revision, url, title: cleanTitle(this.values(source, 'search', 'name', row, true)[0]!), author: cleanTitle(this.values(source, 'search', 'author', row)[0] ?? '') });
        if (results.size > 200) throw new Error('ruleSearch.bookList：结果超过 200 项');
      }
      return [...results.values()];
    });
  }
  async detail(result: OnlineResult, signal: AbortSignal): Promise<OnlineDetail> {
    const source = await this.source(result.sourceId, result.revision);
    return this.tracked(source, 'detail', signal, async () => {
      const url = this.url(source, result.url, source.report.url, 'bookUrl');
      const response = await this.http.get(url, signal, new URL(source.report.url).origin), context = documentContext(response.text);
      const toc = this.values(source, 'detail', 'tocUrl', context, !!this.rule(source, 'detail', 'tocUrl'))[0] ?? response.url;
      return { ...result, url: response.url, title: cleanTitle(this.values(source, 'detail', 'name', context, !!this.rule(source, 'detail', 'name'))[0] ?? result.title), author: cleanTitle(this.values(source, 'detail', 'author', context)[0] ?? result.author), intro: this.values(source, 'detail', 'intro', context).join('\n').slice(0, 10000), tocUrl: this.url(source, toc, response.url, 'ruleBookInfo.tocUrl') };
    });
  }
  private async pages(source: Source, stage: 'toc' | 'content', start: string, signal: AbortSignal, visit: (context: any, url: string) => void) {
    let url = start; const visited = new Set<string>();
    for (let page = 1; page <= SOURCE_LIMITS.pages; page++) {
      if (visited.has(url)) throw new Error(`${stageKeys[stage]}：检测到分页循环`);
      visited.add(url);
      const response = await this.http.get(url, signal, new URL(source.report.url).origin), context = documentContext(response.text);
      visit(context, response.url);
      const field = stage === 'toc' ? 'nextTocUrl' : 'nextContentUrl';
      const links = this.values(source, stage, field, context);
      if (links.length > 1) throw new Error(`${stageKeys[stage]}.${field}：下一页必须最多匹配一个链接`);
      if (!links.length) return;
      if (page === SOURCE_LIMITS.pages) throw new Error(`${stageKeys[stage]}.${field}：分页超过 5 页，未保存不完整结果`);
      url = this.url(source, links[0]!, response.url, `${stageKeys[stage]}.${field}`);
    }
  }
  private async toc(source: Source, url: string, signal: AbortSignal): Promise<Toc> {
    return this.tracked(source, 'toc', signal, async () => {
      const chapters = new Map<string, Toc[number]>();
      await this.pages(source, 'toc', this.url(source, url, source.report.url, 'tocUrl'), signal, (context, base) => {
        for (const row of this.rows(source, 'toc', 'chapterList', context)) {
          const url = this.url(source, this.values(source, 'toc', 'chapterUrl', row, true)[0]!, base, 'ruleToc.chapterUrl');
          const id = hash(url);
          chapters.set(id, { id, url, title: cleanTitle(this.values(source, 'toc', 'chapterName', row, true)[0]!) });
          if (chapters.size > SOURCE_LIMITS.chapters) throw new Error('ruleToc.chapterList：目录超过 5000 章');
        }
      });
      return [...chapters.values()];
    });
  }
  async has(id: string) { try { await fs.access(this.path(id)); return true; } catch (error) { if (missing(error)) return false; throw error; } }
  private async read(id: string): Promise<RecordBook> { const book = recordSchema.parse(JSON.parse(await fs.readFile(this.path(id), 'utf8'))); if (book.id !== id) throw new Error('在线书籍 ID 不一致'); return book; }
  private async write(book: RecordBook) { await this.ready(); await atomicWrite(this.path(book.id), JSON.stringify(recordSchema.parse(book))); }
  private summary(book: RecordBook): BookSummary { return { id: book.id, title: book.title, author: book.author, format: 'online', addedAt: book.addedAt, lastReadAt: book.lastReadAt, chapterCount: book.chapters.length, wordCount: 0, progress: book.chapters.length <= 1 ? 0 : book.locator.chapter / (book.chapters.length - 1), locator: book.locator }; }
  async listBooks(): Promise<BookSummary[]> {
    await this.ready(); const books: BookSummary[] = [];
    for (const name of await fs.readdir(this.directory)) if (/^[a-f0-9]{64}\.json$/.test(name)) books.push(this.summary(await this.read(name.slice(0, -5))));
    return books;
  }
  private cachePath(book: RecordBook, chapterId: string) { idSchema.parse(chapterId); return join(this.directory, 'cache', book.id, book.revision, `${chapterId}.json`); }
  private async cached(book: RecordBook, chapterId: string): Promise<string[] | undefined> {
    try { return z.array(z.string()).min(1).max(50000).parse(JSON.parse(await fs.readFile(this.cachePath(book, chapterId), 'utf8'))); }
    catch (error) { if (missing(error)) return undefined; throw new Error('章节缓存损坏；未覆盖原缓存'); }
  }
  private async asDetail(book: RecordBook, chapterId = book.locator.chapterId): Promise<BookDetail> {
    const paragraphs = await this.cached(book, chapterId);
    return { summary: this.summary(book), bookmarks: book.bookmarks, document: { id: book.id, title: book.title, author: book.author, format: 'online', warnings: ['Legado 无脚本兼容子集；正文按章加载，在线进度按目录章节估算。搜索仅限当前章节，不包含其他已缓存章节，不自动下载全书。'], chapters: book.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, paragraphs: chapter.id === chapterId ? paragraphs ?? [] : [], loaded: chapter.id === chapterId && !!paragraphs })) } };
  }
  async add(detail: OnlineDetail, signal: AbortSignal): Promise<BookDetail> {
    const source = await this.source(detail.sourceId, detail.revision);
    const canonicalUrl = this.url(source, detail.url, source.report.url, 'bookUrl');
    const id = hash(`online:${detail.sourceId}:${detail.revision}:${canonicalUrl}`);
    if (!['supported', 'partial'].includes(source.report.stages.content.syntax)) throw new Error('ruleContent：正文语法不可用，请查看书源字段诊断');
    if (await this.has(id)) return this.open(id, signal);
    const chapters = await this.toc(source, detail.tocUrl, signal);
    const book: RecordBook = { version: 1, id, sourceId: detail.sourceId, revision: detail.revision, url: canonicalUrl, tocUrl: detail.tocUrl, title: detail.title, author: detail.author, chapters, locator: { chapter: 0, paragraph: 0, chapterId: chapters[0]!.id }, bookmarks: [], addedAt: new Date().toISOString() };
    await this.store.locked('online-sources', () => this.store.locked(`online-${id}`, async () => { signal.throwIfAborted(); await this.source(source.report.id, source.report.revision, source.generation); if (!await this.has(id)) await this.write(book); }));
    return this.open(id, signal);
  }
  async open(id: string, signal: AbortSignal): Promise<BookDetail> {
    const book = await this.read(id);
    await this.chapter(id, book.locator.chapterId, signal);
    return this.store.locked(`online-${id}`, async () => { const current = await this.read(id); current.lastReadAt = new Date().toISOString(); await this.write(current); return this.asDetail(current); });
  }
  async chapter(id: string, chapterId: string, signal: AbortSignal): Promise<BookDetail> {
    const book = await this.read(id), chapter = book.chapters.find(c => c.id === chapterId);
    if (!chapter) throw new Error('章节已不在目录中，请刷新书籍');
    if (await this.cached(book, chapterId)) return this.asDetail(book, chapterId);
    const source = await this.source(book.sourceId, book.revision);
    const paragraphs = await this.tracked(source, 'content', signal, async () => {
      const paragraphs: string[] = []; let bytes = 0;
      await this.pages(source, 'content', chapter.url, signal, context => {
        for (const value of this.values(source, 'content', 'content', context, true)) for (const part of value.split(/\n+/).map(p => p.trim()).filter(Boolean)) {
          bytes += Buffer.byteLength(part);
          if (bytes > 4 * 1024 * 1024 || paragraphs.length >= 50000) throw new Error('ruleContent.content：章节超过 4 MiB / 50000 段');
          paragraphs.push(part);
        }
        if (!paragraphs.length) throw new Error('ruleContent.content：正文为空');
      });
      return paragraphs;
    });
    await this.store.locked('online-sources', () => this.store.locked(`online-${id}`, async () => {
      signal.throwIfAborted(); await this.source(book.sourceId, book.revision, source.generation);
      const current = await this.read(id); if (current.revision !== book.revision || !current.chapters.some(c => c.id === chapterId)) throw new Error('目录或书源已变化，已丢弃过期正文');
      const path = this.cachePath(book, chapterId), directory = join(path, '..');
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await atomicWrite(path, JSON.stringify(paragraphs));
      // Bounded disk cache; keep current and resume chapters. Bookmarks retain
      // stable IDs even if their text is later evicted and must be fetched again.
      const entries = await Promise.all((await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => ({ name, stat: await fs.stat(join(directory, name)) })));
      let size = entries.reduce((n, e) => n + e.stat.size, 0);
      for (const entry of entries.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) {
        if (size <= 32 * 1024 * 1024) break;
        if (entry.name === `${chapterId}.json` || entry.name === `${current.locator.chapterId}.json`) continue;
        await fs.unlink(join(directory, entry.name)); size -= entry.stat.size;
      }
    }));
    return this.asDetail(await this.read(id), chapterId);
  }
  async refresh(id: string, signal: AbortSignal): Promise<BookDetail> {
    const book = await this.read(id), source = await this.source(book.sourceId, book.revision), chapters = await this.toc(source, book.tocUrl, signal);
    return this.store.locked('online-sources', () => this.store.locked(`online-${id}`, async () => {
      signal.throwIfAborted(); await this.source(book.sourceId, book.revision, source.generation);
      const current = await this.read(id);
      const align = (loc: RecordBook['locator']) => { const chapter = chapters.findIndex(c => c.id === loc.chapterId); if (chapter < 0) throw new Error('新目录缺少进度或书签章节；旧目录已保留'); return { ...loc, chapter }; };
      current.locator = align(current.locator); current.bookmarks = current.bookmarks.map(b => ({ ...b, locator: align(b.locator) })); current.chapters = chapters;
      await this.write(current); return this.asDetail(current);
    }));
  }
  private async checkedLocator(book: RecordBook, locator: Locator) {
    const checked = locatorSchema.parse(locator), index = book.chapters.findIndex(c => c.id === checked.chapterId);
    const paragraphs = await this.cached(book, checked.chapterId);
    if (index < 0 || !paragraphs || checked.paragraph >= paragraphs.length) throw new Error('进度必须指向已加载章节的有效段落');
    return { ...checked, chapter: index };
  }
  async saveProgress(id: string, locator: Locator) { return this.store.locked(`online-${id}`, async () => { const book = await this.read(id); book.locator = await this.checkedLocator(book, locator); book.lastReadAt = new Date().toISOString(); await this.write(book); return this.summary(book); }); }
  async addBookmark(id: string, locator: Locator, label: string): Promise<Bookmark[]> { return this.store.locked(`online-${id}`, async () => { const book = await this.read(id), checked = await this.checkedLocator(book, locator); if (book.bookmarks.length >= 1000) throw new Error('书签超过 1000 条'); if (!book.bookmarks.some(b => b.locator.chapterId === checked.chapterId && b.locator.paragraph === checked.paragraph)) book.bookmarks.push({ id: randomUUID(), locator: checked, label, createdAt: new Date().toISOString() }); await this.write(book); return book.bookmarks; }); }
  async removeBookmark(id: string, bookmarkId: string) { return this.store.locked(`online-${id}`, async () => { const book = await this.read(id); book.bookmarks = book.bookmarks.filter(b => b.id !== bookmarkId); await this.write(book); return book.bookmarks; }); }

  /** Duplicate operations share work; cancelling one subscriber keeps others alive. */
  run<T>(requestId: string, key: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.jobs.has(requestId)) throw new Error('请求 ID 已在使用');
    if (this.jobs.size >= 20) throw new Error('在线请求过多');
    let job = [...this.jobs.values()].find(j => j.key === key);
    if (!job) {
      const controller = new AbortController(), users = new Set<string>();
      const timer = setTimeout(() => controller.abort(new Error('在线操作超过 45 秒')), 45000);
      const promise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return work(controller.signal); }).then(value => { controller.signal.throwIfAborted(); return value; }).finally(() => { clearTimeout(timer); for (const user of users) this.jobs.delete(user); });
      job = { controller, promise, key, users };
    }
    job.users.add(requestId); this.jobs.set(requestId, job);
    const selected = job;
    return selected.promise.then(value => { if (!selected.users.has(requestId)) throw new Error('请求已取消'); return value as T; });
  }
  cancel(requestId: string) { const job = this.jobs.get(requestId); if (job) { job.users.delete(requestId); this.jobs.delete(requestId); if (!job.users.size) job.controller.abort(new Error('请求已取消')); } return { cancelled: true }; }
}
