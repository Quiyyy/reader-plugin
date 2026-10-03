import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ScriptSession } from '../src/server/online/script.js';
import { RuleEvaluator } from '../src/server/online/evaluate.js';
import { searchRequest, staticHeaders } from '../src/server/online/request.js';
import { SourceRateLimiter, parseRate } from '../src/server/online/rate.js';
import { importSources } from '../src/server/online/import.js';
import { ReaderStore } from '../src/server/store.js';
import { OnlineSourceService } from '../src/server/online/service.js';
import { fixtureServer } from './online/fixture.js';
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.useRealTimers(); });
// These outer test deadlines include several cold trusted loaders/WASM
// instances. Inner 500 ms / 2 s enforcement and elapsed-time assertions remain.
const isolatedTestMs = 30_000;
const signal = () => new AbortController().signal;
const globals = { baseUrl: 'https://reader.example.com/', key: '河岸', page: 2, book: { origin: 'https://reader.example.com', name: '原创河岸', durChapterTitle: '第一章' }, chapter: { index: 0 } };
function session(ajax: (url: string) => Promise<string> = async () => '<p>原创</p>', sig = signal()) { const s = new ScriptSession(sig, ajax); cleanup.push(() => s.close()); return s; }

describe('isolated QuickJS host and lifecycle', () => {
  it('evaluates JS chains, expressions, get/put/getString and encoding with no ambient authority', async () => {
    const s = session(), r = new RuleEvaluator(s, globals);
    expect(await s.run('java.put("part", java.getString("p@text")); result + java.get("part")', '前', '<p>后</p>', globals)).toBe('前后');
    expect(await s.run('java.encodeURI(key,"gbk") + ":" + java.base64Decode(java.base64Encode(java.get("part")))', '', '', globals)).toBe('%BA%D3%B0%B6:后');
    expect(await s.run('[typeof process,typeof require,typeof fetch,typeof Deno,typeof std,typeof os,typeof globalThis["ev"+"al"],typeof (function(){}).constructor,typeof (function*(){}).constructor,typeof (async function(){}).constructor].join(":")', '', '', globals)).toBe(Array(10).fill('undefined').join(':'));
    expect(await r.url('@js:java.put("q",key); "/search?page={{page-1}}&q={{key}}"')).toBe('/search?page=1&q={{key}}');
    expect(await r.rule('p@text@js:result.toUpperCase()', '<p>read</p>')).toEqual(['READ']);
    expect(await r.rule('<js>result.replace("before","after")</js>p@text', '<p>before</p>')).toEqual(['after']);
    expect(await r.rule('/book/{{$.id}}', { id: 7 })).toEqual(['/book/7']);
    expect(await r.init('$.data', { data: { name: 'original' } })).toEqual({ name: 'original' });
    expect(await r.clean('第一章 原创\n正文', '##{{book.durChapterTitle}}.*\n', '')).toBe('正文');
    const other = session(); expect(await other.run('java.get("part")', '', '', globals)).toBe('');
  }, isolatedTestMs);
  it('awaits bounded host ajax synchronously and rejects browser requirements even if caught', async () => {
    const ajax = vi.fn(async () => '<p>原创</p>'), s = session(ajax);
    expect(await s.run('java.ajax(baseUrl) + java.ajax(baseUrl)', '', '', globals)).toBe('<p>原创</p><p>原创</p>');
    expect(ajax).toHaveBeenCalledTimes(2);
    await expect(s.run('try { java.startBrowserAwait(baseUrl) } catch(e) {} "pretend success"', '', '', globals)).rejects.toThrow('真实浏览器');
  }, isolatedTestMs);
  it.each(['while(true) {}', '/(a+)+$/.test("a".repeat(100)+"!")', '({toJSON(){while(true){}}})'])('terminates excessive CPU without blocking the parent event loop: %s', async code => {
    const s = session(); await s.run('0', '', '', globals);
    let ticks = 0; const started = Date.now(), timer = setInterval(() => ticks++, 10);
    try { await expect(s.run(code, '', '', globals)).rejects.toThrow(/interrupt|超时|终止/i); expect(ticks).toBeGreaterThan(1); expect(Date.now() - started).toBeLessThan(3500); }
    finally { clearInterval(timer); }
    expect(await session().run('1+1', '', '', globals)).toBe(2);
  }, isolatedTestMs);
  it('enforces output, variable and bulk WASM memory ceilings', async () => {
    await expect(session().run('"x".repeat(3*1024*1024)', '', '', globals)).rejects.toThrow(/输出|memory/);
    await expect(session().run('java.put("x","x".repeat(40000))', '', '', globals)).rejects.toThrow(/参数|变量/);
    // Several allocations below the soft runtime cap must still hit the hard
    // 32 MiB WebAssembly.Memory maximum (regression for upstream #271).
    await expect(session().run('let keep=[]; for(let i=0;i<80;i++) keep.push(new Uint8Array(1024*1024)); "unbounded"', '', '', globals)).rejects.toThrow(/memory|分配|退出|abort|null/i);
    expect(await session().run('40+2', '', '', globals)).toBe(42);
  }, isolatedTestMs);
  it('cancels a suspended script and refuses dynamic compilation', async () => {
    const controller = new AbortController();
    // Cancel after the guest actually reaches the suspended network call, not
    // while its trusted development loader may still be starting on Windows.
    const s = session(async () => { controller.abort(); return new Promise(() => {}); }, controller.signal);
    await expect(s.run('java.ajax(baseUrl)', '', '', globals)).rejects.toThrow('取消');
    await expect(session().run('eval("1+1")', '', '', globals)).rejects.toThrow('动态');
    await expect(session().run('import("node:fs")', '', '', globals)).rejects.toThrow('动态');
  }, isolatedTestMs);
  it('cancels trusted engine initialization before any source code is sent', async () => {
    const controller = new AbortController(), ajax = vi.fn(async () => 'must not run'), s = session(ajax, controller.signal);
    const pending = expect(s.run('java.ajax(baseUrl)', '', '', globals)).rejects.toThrow('取消');
    controller.abort(); await pending; expect(ajax).not.toHaveBeenCalled();
    expect(await session().run('6*7', '', '', globals)).toBe(42);
  }, isolatedTestMs);
  it('keeps the cumulative guest execution limit inside the worker, including across ajax suspension', async () => {
    const s = session();
    await s.run('0', '', '', globals);
    // A deliberately small remaining budget proves that the cumulative limit,
    // rather than only the 500 ms per-call interrupt, reaches the worker.
    (s as any).budget = 40;
    await expect(s.run('var t=Date.now();while(Date.now()-t<100){};42', '', '', globals)).rejects.toThrow(/interrupt|预算/i);
    const resumed = session(async () => 'ready');
    await resumed.run('0', '', '', globals);
    (resumed as any).budget = 60;
    await expect(resumed.run('var t=Date.now();while(Date.now()-t<35){};java.ajax(baseUrl);t=Date.now();while(Date.now()-t<50){};42', '', '', globals)).rejects.toThrow(/interrupt|预算/i);
    expect(await session().run('6*7', '', '', globals)).toBe(42);
  }, isolatedTestMs);
});

describe('request encoding and per-source limits', () => {
  it('encodes actual GBK/GB18030 request bytes and rejects sensitive headers', () => {
    expect(searchRequest("/s,{'method':'POST','body':'q={{key}}&submit=搜索','charset':'gbk','headers':{'Accept':'text/html'}}", '中文', 1)).toMatchObject({ body: 'q=%D6%D0%CE%C4&submit=%CB%D1%CB%F7', charset: 'gbk', headers: { accept: 'text/html' } });
    expect(searchRequest("/s?q={{key}},{'charset':'gb18030'}", '𠀀', 1).url).toBe('/s?q=%952%826');
    expect(() => searchRequest("/s?q={{key}},{'charset':'gbk'}", '😀', 1)).toThrow('无法表示');
    for (const header of ['Cookie', 'Authorization', 'Host', 'Proxy-Authorization', 'X-Api-Key', 'Accept-Encoding']) expect(() => staticHeaders({ [header]: 'secret' })).toThrow('不允许');
    expect(() => staticHeaders({ Referer: 'good\r\nevil' })).toThrow();
  });
  it('applies numeric and a/b rolling limits, isolates sources, and cancels queued waits', async () => {
    vi.useFakeTimers(); const rates = new SourceRateLimiter(), controller = new AbortController();
    await rates.wait('A', parseRate('2/1000'), signal()); await rates.wait('A', parseRate('2/1000'), signal());
    let done = false; const queued = rates.wait('A', parseRate('2/1000'), signal()).then(() => { done = true; });
    await rates.wait('B', parseRate(1000), signal()); await vi.advanceTimersByTimeAsync(999); expect(done).toBe(false); await vi.advanceTimersByTimeAsync(1); await queued;
    const rejected = expect(rates.wait('B', parseRate('10000'), controller.signal)).rejects.toThrow(); controller.abort(); await rejected;
    expect(() => parseRate('100/0')).toThrow(); expect(() => parseRate('-1')).toThrow();
  });
});

it('runs an original JS/GBK source through pagination and persisted book/chapter variables', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-script-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const raw = { bookSourceName: '原创隔离链路', bookSourceUrl: 'https://reader.example.com', loginUrl: '/unused-login', concurrentRate: '2/10', header: "{'Accept':'text/html,application/json','User-Agent':'Original-Reader-Test'}", searchUrl: `@js:java.put('nonce',java.ajax('/nonce')); "/search,{'method':'POST','charset':'gbk','body':'q={{key}}&p={{page-1}}'}"`, ruleSearch: { bookList: '$.data', name: '$.name', author: '$.author', bookUrl: `$.id@js:java.put('id',result); '/book/'+result` }, ruleBookInfo: { init: '$.book', name: '$.name', author: '$.author', intro: '$.intro', tocUrl: `@js:if(java.get('id')!=='7') throw Error('lost book variable'); '/toc/1'` }, ruleToc: { chapterList: '$.chapters', chapterName: '$.name', chapterUrl: `$.url@js:java.put('chapter',result); result`, nextTocUrl: '$.next' }, ruleContent: { content: `<js>if(!java.get('nonce')||java.get('chapter')!==chapter.url.replace(book.origin,'')) throw Error('lost chapter state'); result;</js>#content@text`, nextContentUrl: 'a.next@href' } };
  let body = '';
  const f = await fixtureServer(async (req, res) => {
    if (req.url === '/source.json') { res.end(JSON.stringify(raw)); return; }
    if (req.url === '/nonce') { res.end('original-token'); return; }
    if (req.url === '/search') { for await (const chunk of req) body += chunk; res.end(JSON.stringify({ data: [{ id: '7', name: '原创河岸', author: 'Reader' }] })); return; }
    if (req.url === '/book/7') { res.end(JSON.stringify({ book: { name: '原创河岸', author: 'Reader', intro: '公开原创夹具' } })); return; }
    if (req.url === '/toc/1') { res.end(JSON.stringify({ chapters: [{ name: '河岸', url: '/chapter/one' }], next: '/toc/2' })); return; }
    if (req.url === '/toc/2') { res.end(JSON.stringify({ chapters: [{ name: '灯光', url: '/chapter/two' }], next: '' })); return; }
    res.end(`<div id="content"><p>原创${req.url}</p><p>第二段文字。</p></div>${req.url === '/chapter/one' ? '<a class="next" href="/chapter/one-2">下页</a>' : ''}`);
  }); cleanup.push(f.close);
  const online = new OnlineSourceService(new ReaderStore(dir), f.client);
  const preview = await online.previewUrl('https://reader.example.com/source.json', signal());
  expect(Object.values(preview.sources[0].stages).every(s => ['supported','partial'].includes(s.syntax))).toBe(true);
  await online.commit(preview.token); const id = preview.sources[0].id; await online.manage(id, true);
  const results = await online.search(id, '中文', 2, signal()); expect(body).toBe('q=%D6%D0%CE%C4&p=1');
  const detail = await online.detail(results[0], signal()), book = await online.add(detail, signal());
  expect(book.document.chapters).toHaveLength(2); expect(book.document.chapters[0].paragraphs).toHaveLength(4);
  const second = book.document.chapters[1].id; await online.chapter(book.summary.id, second, signal());
  const locator = { chapter: 1, paragraph: 1, chapterId: second };
  await online.saveProgress(book.summary.id, locator); await online.addBookmark(book.summary.id, locator, '保留位置');
  const state = JSON.parse(await readFile(join(dir,'online-v1',`variables-${id}-${results[0].revision}.json`),'utf8'));
  expect(state['book:https://reader.example.com/book/7'].id).toBe('7'); expect(state['chapter:https://reader.example.com/chapter/one'].chapter).toBe('/chapter/one');
  f.setOffline(true); const restarted = new OnlineSourceService(new ReaderStore(dir), f.client), reopened = await restarted.open(book.summary.id, signal());
  expect(reopened.summary.progress).toBeGreaterThan(0); expect(reopened.bookmarks).toHaveLength(1); expect(reopened.document.chapters[1].paragraphs).toContain('第二段文字。');
  const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import {ReaderStore} from './src/server/store.ts';
    import {OnlineSourceService} from './src/server/online/service.ts';
    const service=new OnlineSourceService(new ReaderStore(process.argv[1]));
    const book=await service.open(process.argv[2],new AbortController().signal);
    console.log(JSON.stringify({progress:book.summary.progress,locator:book.summary.locator,bookmarks:book.bookmarks.length,text:book.document.chapters[1].paragraphs}));
  `, dir, book.summary.id], { timeout: 10000 });
  expect(JSON.parse(child.stdout)).toMatchObject({ progress: 1, locator, bookmarks: 1, text: expect.arrayContaining(['第二段文字。']) });
  expect(importSources(JSON.stringify({ ...raw, readerAllowedOrigins: ['http://127.0.0.1'] }))[0].report.syntax).toBe('blocked');
}, 30000);

it('keeps ajax under pinned DNS, explicit origins, cancellation and network quotas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-network-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const f = await fixtureServer(); cleanup.push(f.close);
  const online = new OnlineSourceService(new ReaderStore(dir), f.client);
  const { fixtureSource } = await import('./online/source.js');
  async function use(code: string, extra: Record<string, unknown> = {}) {
    const raw = { ...fixtureSource, ...extra, searchUrl: '@js:' + code };
    const preview = await online.preview(JSON.stringify(raw)); await online.commit(preview.token); await online.manage(preview.sources[0].id, true);
    return online.search(preview.sources[0].id, '河岸', 1, signal());
  }
  await expect(use('try {java.ajax("http://127.0.0.1/private")} catch(e) {} "/search"')).rejects.toThrow(/私网|非公网/);
  expect(f.requests).toHaveLength(0);
  await expect(use('java.ajax("https://extra.example.com/search"); "/search"')).rejects.toThrow('明确域集合');
  expect(f.requests).toHaveLength(0);
  expect(await use('java.ajax("https://extra.example.com/search"); "/search"', { readerAllowedOrigins: ['https://extra.example.com'] })).toHaveLength(1);
  expect(f.options.every(o => o.agent === false && !('rejectUnauthorized' in o))).toBe(true);
  const start = f.requests.length;
  await expect(use('for(let i=0;i<30;i++) java.ajax("/search"); "/search"')).rejects.toThrow('20');
  expect(f.requests.length - start).toBe(20);
  expect((await online.listSources())[0].stages.search.network).toBe('failed');
}, 30000);

it('extracts reversed classic ranges, fallback/combined fields and safe capture cleanup', async () => {
  const r = new RuleEvaluator(session(), globals);
  expect(await r.rule('tag.a[-1:0]@text', '<a>A</a><a>B</a><a>C</a>')).toEqual(['C','B','A']);
  expect(await r.rule('.absent@text||p@text', '<p>Original</p>')).toEqual(['Original']);
  expect(await r.rule('p@text&&span@text', '<p>A</p><span>B</span>')).toEqual(['A','B']);
  expect(await r.rule('p@text##(Original){2}##$1', '<p>OriginalOriginal</p>')).toEqual(['Original']);
  expect(await r.rule('@css:a.more,.pager>a@href', '<a class="more" href="/one">A</a><div class="pager"><a href="/two">B</a></div>')).toEqual(['/one','/two']);
  expect(await r.rule('<js>if(false) java.startBrowserAwait(baseUrl); result;</js>p@text', '<p>Public</p>')).toEqual(['Public']);
}, isolatedTestMs);
