import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BookDetail, BookSummary, Bookmark, Locator } from '../../shared/types.js';
import { IncompleteLoadError, type OnlineDetail, type OnlineResult, type SourcePreview, type SourceReport, type Stage } from '../../shared/online.js';
import { atomicWrite, ReaderStore } from '../store.js';
import { hash, importSources, inspectSource, SOURCE_LIMITS, stageKeys, sourceOrigins, type Source } from './import.js';
import { SafeHttpClient, allowedUrl } from './http.js';
import { searchRequest, staticHeaders } from './request.js';
import { documentContext } from './rules.js';
import { RuleEvaluator } from './evaluate.js';
import { ScriptSession, type ScriptGlobals } from './script.js';
import { parseRate } from './rate.js';
import { parseCatalogPackage, catalogReceiptSchema, type CatalogReceipt } from './catalog.js';
import { SCRIPT_LIMITS } from './script-syntax.js';
import { PaginationDraft, PaginationBoundaryError, PAGINATION_LIMITS, type PaginationCheckpoint, type RuleState } from './pagination.js';

const idSchema = z.string().regex(/^[a-f0-9]{64}$/);
const chapterSchema = z.object({ id: idSchema, title: z.string().max(500), url: z.string().max(4096) });
const locatorSchema = z.object({ chapter: z.number().int().nonnegative(), paragraph: z.number().int().nonnegative(), chapterId: idSchema });
const recordSchema = z.object({ version: z.literal(1), id: idSchema, sourceId: idSchema, revision: idSchema, url: z.string(), tocUrl: z.string(), title: z.string(), author: z.string(), chapters: z.array(chapterSchema).min(1).max(SOURCE_LIMITS.chapters), locator: locatorSchema, bookmarks: z.array(z.object({ id: z.string(), locator: locatorSchema, label: z.string(), createdAt: z.string() })).max(1000), addedAt: z.string(), lastReadAt: z.string().optional() });
type RecordBook = z.infer<typeof recordSchema>;
type Toc = RecordBook['chapters'];
interface RuleControl {
  signal: AbortSignal;
  restore(state?: RuleState): void;
  snapshot(): RuleState;
  usage(): { requests: number; bytes: number };
  resumeUsage(requests: number, bytes: number): void;
}
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
  private previews = new Map<string, { catalog?: CatalogReceipt; sources: Source[]; previous: string; expires: number }>();
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
  private async receipts(): Promise<CatalogReceipt[]> {
    try { return z.array(catalogReceiptSchema).parse(JSON.parse(await fs.readFile(join(this.directory, 'sources.json'), 'utf8')).catalogReceipts ?? []); }
    catch (error) { if (missing(error)) return []; throw new Error('清单回执损坏；未覆盖原文件'); }
  }
  private async writeSources(sources: Source[], receipts?: CatalogReceipt[]) { await atomicWrite(join(this.directory, 'sources.json'), JSON.stringify({ version: 1, sources, catalogReceipts: receipts ?? await this.receipts() })); }
  async previewCatalog(packageJson: string): Promise<SourcePreview> {
    const { json, receipt } = parseCatalogPackage(packageJson);
    const prior = (await this.receipts()).find(item => item.catalogId === receipt.catalogId && item.version === receipt.version);
    if (prior && prior.manifestSha256 !== receipt.manifestSha256) throw new Error('该清单版本已经导入过不同内容；请发布新版本');
    if (!receipt.sources.length) return { token: '', sources: [], changes: [], catalog: receipt };
    const preview = await this.preview(json);
    if (new Set(preview.sources.map(source => source.id)).size !== receipt.sources.length) { this.previews.delete(preview.token); throw new Error('清单的不同条目指向重复书源'); }
    this.previews.get(preview.token)!.catalog = receipt;
    return { ...preview, catalog: receipt };
  }
  async listSources(): Promise<SourceReport[]> { return (await this.sources()).map(s => s.report); }
  async preview(json: string): Promise<SourcePreview> {
    const sources = importSources(json), existing = await this.sources();
    for (const [key, entry] of this.previews) if (entry.expires < Date.now()) this.previews.delete(key);
    if (this.previews.size >= 4) this.previews.delete(this.previews.keys().next().value!);
    const token = randomUUID();
    this.previews.set(token, { sources, previous: this.fingerprint(existing), expires: Date.now() + 10 * 60_000 });
    return { token, sources: sources.map(s => s.report), changes: sources.map(source => { const old = existing.find(s => s.report.id === source.report.id); return { id: source.report.id, kind: !old ? 'new' : old.report.revision === source.report.revision ? 'unchanged' : 'replace', previousName: old?.report.name, fields: old ? changedFields(old.raw, source.raw) : Object.keys(source.raw) }; }) };
  }
  async previewUrl(url: string, signal: AbortSignal) { const response = await this.http.get(url, signal); return JSON.parse(response.text)?.format === 'reader-source-catalog-package' ? this.previewCatalog(response.text) : this.preview(response.text); }
  private fingerprint(sources: Source[]) { return hash(JSON.stringify(sources.map(s => [s.report.id, s.report.revision, s.report.enabled, s.generation]))); }
  async commit(token: string) {
    const entry = this.previews.get(token);
    if (!entry || entry.expires < Date.now()) throw new Error('导入预览已过期，请重新预览');
    return this.store.locked('online-sources', async () => {
      const existing = await this.sources();
      const receipts = await this.receipts();
      if (entry.catalog) {
        const prior = receipts.find(item => item.catalogId === entry.catalog!.catalogId && item.version === entry.catalog!.version);
        if (prior && prior.manifestSha256 !== entry.catalog.manifestSha256) throw new Error('清单版本内容冲突，请重新预览');
        if (!prior) { if (receipts.length >= 100) throw new Error('清单回执已达 100 条，请先备份维护'); receipts.push(entry.catalog); }
      }
      if (this.fingerprint(existing) !== entry.previous) throw new Error('书源已发生变化，请重新预览并确认差异');
      for (const source of entry.sources) {
        const index = existing.findIndex(s => s.report.id === source.report.id);
        if (index >= 0 && existing[index]!.report.revision === source.report.revision) continue;
        source.generation = randomUUID();
        if (index >= 0) existing[index] = source; else existing.push(source);
      }
      if (existing.length > SOURCE_LIMITS.stored) throw new Error('最多保存 100 个书源');
      if (entry.catalog) {
        try { await fs.copyFile(join(this.directory, 'sources.json'), join(this.directory, 'sources.before-catalog-v1.json'), 1); }
        catch (error) { if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      await this.writeSources(existing, receipts); this.previews.delete(token);
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
  private async tracked<T>(source: Source, stage: Stage, signal: AbortSignal, work: (rules: RuleEvaluator, fetchPage: (input: string) => Promise<{ text: string; url: string }>, control: RuleControl) => Promise<T>, globals?: Partial<ScriptGlobals>): Promise<T> {
    const report = source.report.stages[stage];
    if (!['supported', 'partial'].includes(report.syntax)) throw new Error(`${stageKeys[stage]}：该阶段语法 ${report.syntax}，请查看字段诊断`);
    const update = async (error?: string) => this.store.locked('online-sources', async () => {
      const sources = await this.sources(), current = sources.find(s => s.report.id === source.report.id);
      if (current?.report.revision === source.report.revision && current.generation === source.generation && current.report.enabled) {
        Object.assign(current.report.stages[stage], { network: error ? 'failed' : 'passed', lastError: error, checkedAt: new Date().toISOString() });
        await this.writeSources(sources);
      } else if (!error) throw new Error('书源状态已变化，已丢弃过期响应');
    });
    return this.store.locked(`online-rule-${source.report.id}`, async () => {
      const controller = new AbortController(), abort = () => controller.abort(signal.reason);
      let requests = 0, bytes = 0, priorRequests = 0, priorBytes = 0;
      const paginated = stage === 'toc' || stage === 'content';
      const totalBytes = stage === 'toc' ? PAGINATION_LIMITS.tocBytes : PAGINATION_LIMITS.contentBytes;
      const origin = new URL(source.report.url).origin, origins = sourceOrigins(source.raw, source.report.url);
      const defaults = staticHeaders(source.raw.header), rate = parseRate(source.raw.concurrentRate);
      const statePath = join(this.directory, `variables-${source.report.id}-${source.report.revision}.json`);
      let saved: Record<string, Record<string, string>> = Object.create(null);
      try { saved = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch (error) { if (!missing(error)) throw new Error('书源变量存储损坏'); }
      const scope = globals?.chapter?.url ? `chapter:${globals.chapter.url}` : globals?.book?.bookUrl ? `book:${globals.book.bookUrl}` : 'source';
      const fetchPage = async (input: string) => {
        controller.signal.throwIfAborted();
        await this.source(source.report.id, source.report.revision, source.generation);
        const request = searchRequest(input, rules.globals.key ?? '', rules.globals.page ?? 1);
        const url = allowedUrl(request.url, rules.globals.baseUrl, origins);
        const policy = { headers: { ...defaults, ...request.headers }, charset: request.charset, origins, rate, sourceKey: source.report.id,
          beforeRequest: () => { if (++requests + priorRequests > PAGINATION_LIMITS.requests && paginated) throw new PaginationBoundaryError('分页累计请求超过 512 次，请检查书源规则'); if (requests > SCRIPT_LIMITS.requests) throw new Error('本批请求超过 20 次（含脚本、重定向和连接重试）'); } };
        const response = request.method === 'POST' ? await this.http.post(url, request.body!, controller.signal, origin, policy) : await this.http.get(url, controller.signal, origin, policy);
        if (typeof source.raw.loginUrl === 'string' && /^https?:|^\//.test(source.raw.loginUrl)) {
          try {
            const login = new URL(source.raw.loginUrl, source.report.url), received = new URL(response.url);
            if (login.pathname !== '/' && login.origin === received.origin && login.pathname === received.pathname) throw new Error('网站跳转至登录入口；需要授权登录，已停止');
          } catch (error) { if ((error as Error).message.includes('登录入口')) throw error; }
        }
        bytes += Buffer.byteLength(response.text); if (paginated && bytes + priorBytes > totalBytes) throw new PaginationBoundaryError(`分页响应合计超过 ${totalBytes / 1024 / 1024} MiB`); if (bytes > SCRIPT_LIMITS.networkBytes) throw Error('本批响应合计超过 8 MiB');
        // These two documented JSD assets can be injected into ordinary public
        // pages. Ignore only their exact paths as blocking signals; no page
        // script is executed/fetched. All other challenge markers still stop.
        const challengeSignals = response.text.replace(/\/cdn-cgi\/challenge-platform\/scripts\/jsd\/(?:main|api)\.js(?=[\s"'<>?#]|$)/gi, '');
        if (/<title[^>]*>\s*(?:Just a moment|Attention Required|人机验证|用户登录|会员登录)/i.test(response.text) || /(?:cf-chl-|challenge-platform)/i.test(challengeSignals)) throw Error('网站要求登录或人机验证；未绕过访问限制');
        return response;
      };
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      const timer = setTimeout(() => controller.abort(new Error('规则阶段超时，请重试')), SCRIPT_LIMITS.sessionMs);
      const script = new ScriptSession(controller.signal, async input => (await fetchPage(input)).text);
      script.variables = Object.assign(Object.create(null), saved.source, globals?.book?.bookUrl ? saved[`book:${globals.book.bookUrl}`] : {}, saved[scope]);
      const rules = new RuleEvaluator(script, { baseUrl: source.report.url, book: { origin, ...globals?.book }, source: { bookSourceUrl: source.report.url }, ...globals });
      // Internal snapshots, keyed by source revision and URL, cannot be supplied
      // via UI results. Search fields can pass java.put data to that book only.
      const changedScopes: RuleState['scopes'] = Object.create(null);
      rules.saveScope = (scope: string) => { saved[scope] = changedScopes[scope] = { ...script.variables }; };
      const control: RuleControl = {
        signal: controller.signal,
        restore(state) { if (state) { script.variables = { ...state.variables }; Object.assign(saved, state.scopes); Object.assign(changedScopes, state.scopes); } },
        snapshot() { const state = { variables: { ...script.variables }, scopes: { ...changedScopes } }; if (Buffer.byteLength(JSON.stringify(state)) > 1024 * 1024) throw Error('分页规则状态超过 1 MiB'); return state; },
        usage: () => ({ requests: priorRequests + requests, bytes: priorBytes + bytes }),
        resumeUsage(count, size) { priorRequests = count; priorBytes = size; },
      };
      try {
        signal.throwIfAborted(); const result = await work(rules, fetchPage, control); controller.signal.throwIfAborted();
        await this.source(source.report.id, source.report.revision, source.generation);
        saved[scope] = { ...script.variables };
        if (Object.keys(saved).length > SOURCE_LIMITS.chapters + 1 || Buffer.byteLength(JSON.stringify(saved)) > 1024 * 1024) throw Error('书源持久变量超过 20001 作用域 / 1 MiB');
        await atomicWrite(statePath, JSON.stringify(saved)); await update(); return result;
      } catch (error) { if (!signal.aborted && !(error instanceof IncompleteLoadError && error.incomplete.paused)) await update(err(error)); throw error; }
      finally { script.close(); controller.abort(); clearTimeout(timer); signal.removeEventListener('abort', abort); }
    });
  }
  private rule(source: Source, stage: Stage, field: string) { return source.raw[stageKeys[stage]]?.[field] as string | undefined; }
  private async values(rules: RuleEvaluator, source: Source, stage: Stage, field: string, context: any, required = false): Promise<string[]> {
    try {
      const text = this.rule(source, stage, field);
      let values = text ? await rules.rule(text, context) : [];
      const replacement = field === 'content' && this.rule(source, stage, 'replaceRegex');
      if (replacement) { const cleaned = []; for (const value of values) cleaned.push(await rules.clean(value, replacement, context)); values = cleaned.filter(value => value.trim()); }
      if ((required || text && !['nextTocUrl', 'nextContentUrl'].includes(field)) && !values.length) throw new Error('没有匹配到非空结果');
      return values;
    } catch (error) { throw new Error(`${stageKeys[stage]}.${field}：${err(error)}`); }
  }
  private async rows(rules: RuleEvaluator, source: Source, stage: Stage, field: string, context: any, allowEmpty = false): Promise<any[]> {
    try { const result = await rules.rule(this.rule(source, stage, field)!, context, true); if (!allowEmpty && !result.length) throw new Error('没有匹配到列表'); return result; }
    catch (error) { throw new Error(`${stageKeys[stage]}.${field}：${err(error)}`); }
  }
  private url(source: Source, value: string, base: string, field: string): string {
    try {
      if (field === 'ruleToc.chapterUrl' && new URL(value, base).hash) throw new Error('首版不支持以 URL 片段区分章节，未合并这些章节');
      return allowedUrl(value, base, sourceOrigins(source.raw, source.report.url));
    }
    catch (error) { throw new Error(`${field}：${err(error)}`); }
  }
  async search(sourceId: string, key: string, page: number, signal: AbortSignal): Promise<OnlineResult[]> {
    const source = await this.source(sourceId);
    return this.tracked(source, 'search', signal, async (rules, fetchPage) => {
      if (page > 1 && !/\bpage\b/.test(source.raw.searchUrl)) throw new Error('searchUrl：该源未声明 {{page}}，不支持搜索翻页');
      const response = await fetchPage(await rules.url(source.raw.searchUrl));
      rules.globals.baseUrl = response.url;
      let context: any;
      try { context = documentContext(response.text); }
      catch (error) { throw new Error(`ruleSearch.bookList：响应解析失败：${err(error)}`); }
      const results = new Map<string, OnlineResult>();
      const rows = await this.rows(rules, source, 'search', 'bookList', context, true), sourceVariables = { ...rules.script.variables };
      if (!rows.length && context?.nodeType) {
        const title = (await rules.rule('title@text', context)).join('').trim();
        if (/^(?:提示信息|系统提示|错误提示|访问错误|Error|Access Denied)$/i.test(title)) throw new Error('ruleSearch.bookList：网站返回提示或错误页，不能确认搜索结果为空；请检查书源访问条件');
      }
      for (const row of rows) {
        rules.script.variables = { ...sourceVariables };
        rules.globals.book = { origin: new URL(source.report.url).origin };
        const title = cleanTitle((await this.values(rules, source, 'search', 'name', row, true))[0]!);
        rules.globals.book.name = title;
        const author = cleanTitle((await this.values(rules, source, 'search', 'author', row))[0] ?? '');
        rules.globals.book.author = author;
        const url = this.url(source, (await this.values(rules, source, 'search', 'bookUrl', row, true))[0]!, response.url, 'ruleSearch.bookUrl');
        results.set(url, { sourceId, revision: source.report.revision, url, title, author });
        rules.saveScope(`book:${url}`);
        if (results.size > 200) throw new Error('ruleSearch.bookList：结果超过 200 项');
      }
      rules.script.variables = sourceVariables;
      return [...results.values()];
    }, { key, page });
  }
  async detail(result: OnlineResult, signal: AbortSignal): Promise<OnlineDetail> {
    const source = await this.source(result.sourceId, result.revision);
    return this.tracked(source, 'detail', signal, async (rules, fetchPage) => {
      const url = this.url(source, result.url, source.report.url, 'bookUrl');
      const response = await fetchPage(url); rules.globals.baseUrl = response.url;
      let context = documentContext(response.text);
      if (this.rule(source, 'detail', 'init')) context = await rules.init(this.rule(source, 'detail', 'init')!, context);
      const toc = (await this.values(rules, source, 'detail', 'tocUrl', context, !!this.rule(source, 'detail', 'tocUrl')))[0] ?? response.url;
      return { ...result, url: response.url, title: cleanTitle((await this.values(rules, source, 'detail', 'name', context, !!this.rule(source, 'detail', 'name')))[0] ?? result.title), author: cleanTitle((await this.values(rules, source, 'detail', 'author', context))[0] ?? result.author), intro: (await this.values(rules, source, 'detail', 'intro', context)).join('\n').slice(0, 10000), tocUrl: this.url(source, toc, response.url, 'ruleBookInfo.tocUrl') };
    }, { book: { origin: new URL(source.report.url).origin, bookUrl: result.url, name: result.title, author: result.author } });
  }
  private async pages<T>(rules: RuleEvaluator, fetchPage: (input: string) => Promise<{ text: string; url: string }>, control: RuleControl, source: Source, stage: 'toc' | 'content', start: string, identity: unknown, schema: z.ZodType<T[]>, visit: (context: any, url: string) => Promise<T[]>, merge: (previous: T[], page: T[]) => T[]): Promise<T[]> {
    const draft = new PaginationDraft(this.directory, [source.report.id, source.report.revision, source.generation, stage, start, identity]);
    let checkpoint = await draft.read();
    const loaded = checkpoint ? schema.safeParse(checkpoint.payload) : undefined;
    if (loaded && !loaded.success) { await draft.remove(); throw Error('分页续点损坏，已清除临时续点；原书籍不变，请重试'); }
    let items: T[] = loaded?.success ? loaded.data : [];
    checkpoint ??= { version: 1, updatedAt: Date.now(), pages: 0, next: start, visited: [], fingerprints: [], requests: 0, bytes: 0, payload: [] };
    const state: PaginationCheckpoint = checkpoint;
    control.restore(state.rules); control.resumeUsage(state.requests, state.bytes);
    const began = Date.now(), visited = new Set(state.visited), fingerprints = new Set(state.fingerprints);
    const label = stage === 'toc' ? '目录' : '章节';
    const progress = () => ({ stage, pages: state.pages, items: items.length, resumable: true, paused: false });
    const save = async () => { Object.assign(state, control.usage()); await this.store.locked('online-pagination-drafts', () => draft.save(state)); };
    try {
      for (let batch = 0; state.next; batch++) {
        control.signal.throwIfAborted();
        if (batch >= PAGINATION_LIMITS.batchPages || Date.now() - began >= PAGINATION_LIMITS.batchMs || batch > 0 && rules.script.shouldPause) {
          throw new IncompleteLoadError(`${label}尚未完成，已加载 ${state.pages} 页、${items.length} ${stage === 'toc' ? '章' : '段'}。已保存续点，可继续加载；原书籍和阅读进度未改动。`, { ...progress(), paused: true });
        }
        if (state.requests >= PAGINATION_LIMITS.requests) throw new PaginationBoundaryError('分页累计请求已达 512 次，请检查书源规则');
        if (state.pages >= PAGINATION_LIMITS.pages) throw new PaginationBoundaryError('分页超过 256 页总预算，请检查书源下一页规则');
        const url = this.url(source, state.next, start, `${stageKeys[stage]}.nextUrl`);
        if (visited.has(url)) throw new PaginationBoundaryError('检测到分页循环（重复链接）');
        await rules.beginPage(); rules.globals.page = state.pages + 1;
        const response = await fetchPage(url);
        if (response.url !== url && visited.has(response.url)) throw new PaginationBoundaryError('检测到分页循环（重定向回已读取页面）');
        const context = documentContext(response.text); rules.globals.baseUrl = response.url;
        const values = await visit(context, response.url);
        const fingerprint = hash(JSON.stringify(stage === 'toc' ? values.map(value => (value as Toc[number]).id) : values));
        if (fingerprints.has(fingerprint)) throw new PaginationBoundaryError('检测到分页循环（不同链接返回重复内容）');
        const field = stage === 'toc' ? 'nextTocUrl' : 'nextContentUrl';
        const links = [...new Set((await this.values(rules, source, stage, field, context)).map(link => this.url(source, link, response.url, `${stageKeys[stage]}.${field}`)))];
        if (links.length > 1) throw new PaginationBoundaryError(`${stageKeys[stage]}.${field}：匹配了多个不同下一页，请检查书源规则`);
        const combined = merge(items, values);
        if (stage === 'toc' && combined.length === items.length) throw new PaginationBoundaryError('目录下一页没有新增章节，请检查书源分页规则');
        schema.parse(combined); control.signal.throwIfAborted();
        const snapshot = control.snapshot();
        visited.add(url); visited.add(response.url); fingerprints.add(fingerprint);
        items = combined;
        Object.assign(state, { pages: state.pages + 1, next: links[0] ?? '', payload: items, visited: [...visited], fingerprints: [...fingerprints], rules: snapshot });
        await save();
      }
      return items;
    } catch (error) {
      // Only complete pages are checkpointed. A failed current page is retried,
      // never presented as a complete directory or written into chapter cache.
      if (error instanceof PaginationBoundaryError) { await draft.remove(); throw new IncompleteLoadError(`${label}尚未完成：${err(error)}。已停止并清除临时续点，未覆盖原书籍或缓存；请更新书源后重试。`, { ...progress(), resumable: false }); }
      if (state.pages) await save();
      if (error instanceof IncompleteLoadError) throw error;
      throw new IncompleteLoadError(`${label}尚未完成${state.pages ? `（已保留 ${state.pages} 页续点）` : ''}：${err(error)}。原书籍、缓存和进度未改动；可重试继续，规则错误请更新书源。`, progress());
    }
  }
  private async toc(source: Source, url: string, signal: AbortSignal, book: Record<string, unknown>, identity: unknown): Promise<Toc> {
    return this.tracked(source, 'toc', signal, async (rules, fetchPage, control) => {
      return this.pages(rules, fetchPage, control, source, 'toc', this.url(source, url, source.report.url, 'tocUrl'), identity, z.array(chapterSchema).max(SOURCE_LIMITS.chapters), async (context, base) => {
        const rows = await this.rows(rules, source, 'toc', 'chapterList', context), bookVariables = { ...rules.script.variables }, page: Toc = [];
        for (const row of rows) {
          control.signal.throwIfAborted();
          rules.script.variables = { ...bookVariables };
          const url = this.url(source, (await this.values(rules, source, 'toc', 'chapterUrl', row, true))[0]!, base, 'ruleToc.chapterUrl');
          page.push({ id: hash(url), url, title: cleanTitle((await this.values(rules, source, 'toc', 'chapterName', row, true))[0]!) });
          if (JSON.stringify(rules.script.variables) !== JSON.stringify(bookVariables)) rules.saveScope(`chapter:${url}`);
        }
        rules.script.variables = bookVariables;
        return page;
      }, (previous, page) => {
        const chapters = new Map(previous.map(chapter => [chapter.id, chapter]));
        for (const chapter of page) if (!chapters.has(chapter.id)) chapters.set(chapter.id, chapter);
        if (chapters.size > SOURCE_LIMITS.chapters) throw new PaginationBoundaryError('目录超过 20000 章总预算');
        return [...chapters.values()];
      });
    }, { book });
  }
  private async clearPages(source: Source, stage: 'toc' | 'content', start: string, identity: unknown) {
    await new PaginationDraft(this.directory, [source.report.id, source.report.revision, source.generation, stage, this.url(source, start, source.report.url, stage), identity]).remove();
  }
  async has(id: string) { try { await fs.access(this.path(id)); return true; } catch (error) { if (missing(error)) return false; throw error; } }
  private async read(id: string): Promise<RecordBook> { await this.store.assertActive(id); const book = recordSchema.parse(JSON.parse(await fs.readFile(this.path(id), 'utf8'))); if (book.id !== id) throw new Error('在线书籍 ID 不一致'); return book; }
  private async write(book: RecordBook) { await this.ready(); await atomicWrite(this.path(book.id), JSON.stringify(recordSchema.parse(book))); }
  private summary(book: RecordBook): BookSummary { return { id: book.id, title: book.title, author: book.author, format: 'online', addedAt: book.addedAt, lastReadAt: book.lastReadAt, chapterCount: book.chapters.length, wordCount: 0, progress: book.chapters.length <= 1 ? 0 : book.locator.chapter / (book.chapters.length - 1), locator: book.locator }; }
  async trashBook(id: string) { return this.store.locked(`online-${id}`, async () => this.store.markTrashed(this.summary(await this.read(id)))); }
  async listBooks(): Promise<BookSummary[]> {
    await this.ready(); const books: BookSummary[] = [];
    for (const name of await fs.readdir(this.directory)) if (/^[a-f0-9]{64}\.json$/.test(name)) await this.store.locked(`online-${name.slice(0, -5)}`, async () => { if (!await this.store.isTrashed(name.slice(0, -5))) books.push(this.summary(await this.read(name.slice(0, -5)))); });
    return books;
  }
  private cachePath(book: RecordBook, chapterId: string) { idSchema.parse(chapterId); return join(this.directory, 'cache', book.id, book.revision, `${chapterId}.json`); }
  private async cached(book: RecordBook, chapterId: string): Promise<string[] | undefined> {
    try { return z.array(z.string()).min(1).max(50000).parse(JSON.parse(await fs.readFile(this.cachePath(book, chapterId), 'utf8'))); }
    catch (error) { if (missing(error)) return undefined; throw new Error('章节缓存损坏；未覆盖原缓存'); }
  }
  private async asDetail(book: RecordBook, chapterId = book.locator.chapterId): Promise<BookDetail> {
    const paragraphs = await this.cached(book, chapterId);
    return { summary: this.summary(book), bookmarks: book.bookmarks, document: { id: book.id, title: book.title, author: book.author, format: 'online', warnings: ['Legado 有界规则兼容；正文按章加载，在线进度按目录章节估算。搜索仅限当前章节，不包含其他已缓存章节，不自动下载全书。'], chapters: book.chapters.map(chapter => ({ id: chapter.id, title: chapter.title, paragraphs: chapter.id === chapterId ? paragraphs ?? [] : [], loaded: chapter.id === chapterId && !!paragraphs })) } };
  }
  async add(detail: OnlineDetail, signal: AbortSignal): Promise<BookDetail> {
    const source = await this.source(detail.sourceId, detail.revision);
    const canonicalUrl = this.url(source, detail.url, source.report.url, 'bookUrl');
    const id = hash(`online:${detail.sourceId}:${detail.revision}:${canonicalUrl}`);
    if (!['supported', 'partial'].includes(source.report.stages.content.syntax)) throw new Error('ruleContent：正文语法不可用，请查看书源字段诊断');
    if (await this.has(id)) return this.open(id, signal);
    await this.store.assertActive(id);
    const chapters = await this.toc(source, detail.tocUrl, signal, { origin: new URL(source.report.url).origin, bookUrl: detail.url, name: detail.title, author: detail.author }, ['add', id, await this.store.lifecycle(id)]);
    const book: RecordBook = { version: 1, id, sourceId: detail.sourceId, revision: detail.revision, url: canonicalUrl, tocUrl: detail.tocUrl, title: detail.title, author: detail.author, chapters, locator: { chapter: 0, paragraph: 0, chapterId: chapters[0]!.id }, bookmarks: [], addedAt: new Date().toISOString() };
    await this.store.locked('online-sources', () => this.store.locked(`online-${id}`, async () => { signal.throwIfAborted(); await this.source(source.report.id, source.report.revision, source.generation); if (!await this.has(id)) await this.write(book); }));
    await this.clearPages(source, 'toc', detail.tocUrl, ['add', id, await this.store.lifecycle(id)]);
    return this.open(id, signal);
  }
  async open(id: string, signal: AbortSignal): Promise<BookDetail> {
    const book = await this.read(id);
    await this.chapter(id, book.locator.chapterId, signal);
    return this.store.locked(`online-${id}`, async () => { const current = await this.read(id); current.lastReadAt = new Date().toISOString(); await this.write(current); return this.asDetail(current); });
  }
  async chapter(id: string, chapterId: string, signal: AbortSignal): Promise<BookDetail> {
    const lifecycle = await this.store.lifecycle(id);
    const book = await this.read(id), chapter = book.chapters.find(c => c.id === chapterId);
    if (!chapter) throw new Error('章节已不在目录中，请刷新书籍');
    if (await this.cached(book, chapterId)) return this.asDetail(book, chapterId);
    const source = await this.source(book.sourceId, book.revision);
    const paragraphs = await this.tracked(source, 'content', signal, async (rules, fetchPage, control) => {
      return this.pages(rules, fetchPage, control, source, 'content', chapter.url, [id, chapterId, lifecycle], z.array(z.string()).max(50000), async context => {
        const page: string[] = [];
        for (const value of await this.values(rules, source, 'content', 'content', context, true)) page.push(...value.split(/\n+/).map(p => p.trim()).filter(Boolean));
        if (!page.length) throw Error('ruleContent.content：正文为空');
        return page;
      }, (previous, page) => {
        const combined = [...previous, ...page];
        if (combined.length > 50000 || combined.reduce((bytes, value) => bytes + Buffer.byteLength(value), 0) > 4 * 1024 * 1024) throw new PaginationBoundaryError('章节超过 4 MiB / 50000 段总预算');
        return combined;
      });
    }, { book: { origin: new URL(source.report.url).origin, bookUrl: book.url, name: book.title, author: book.author, durChapterTitle: chapter.title }, chapter: { title: chapter.title, url: chapter.url, index: book.chapters.indexOf(chapter) } });
    await this.store.locked('online-sources', () => this.store.locked(`online-${id}`, async () => {
      signal.throwIfAborted(); await this.source(book.sourceId, book.revision, source.generation);
      const current = await this.read(id); if (await this.store.lifecycle(id) !== lifecycle) throw new Error('书籍已移入或恢复自回收站，过期请求已丢弃'); if (current.revision !== book.revision || !current.chapters.some(c => c.id === chapterId)) throw new Error('目录或书源已变化，已丢弃过期正文');
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
    await this.clearPages(source, 'content', chapter.url, [id, chapterId, lifecycle]);
    return this.asDetail(await this.read(id), chapterId);
  }
  async refresh(id: string, signal: AbortSignal): Promise<BookDetail> {
    const lifecycle = await this.store.lifecycle(id);
    const book = await this.read(id), source = await this.source(book.sourceId, book.revision), chapters = await this.toc(source, book.tocUrl, signal, { origin: new URL(source.report.url).origin, bookUrl: book.url, name: book.title, author: book.author }, ['refresh', id, lifecycle]);
    return this.store.locked('online-sources', () => this.store.locked(`online-${id}`, async () => {
      signal.throwIfAborted(); await this.source(book.sourceId, book.revision, source.generation);
      const current = await this.read(id);
      if (await this.store.lifecycle(id) !== lifecycle) throw new Error('书籍已移入或恢复自回收站，过期目录已丢弃');
      const align = (loc: RecordBook['locator']) => { const chapter = chapters.findIndex(c => c.id === loc.chapterId); if (chapter < 0) throw new Error('新目录缺少进度或书签章节；旧目录已保留'); return { ...loc, chapter }; };
      current.locator = align(current.locator); current.bookmarks = current.bookmarks.map(b => ({ ...b, locator: align(b.locator) })); current.chapters = chapters;
      await this.write(current); await this.clearPages(source, 'toc', book.tocUrl, ['refresh', id, lifecycle]); return this.asDetail(current);
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
