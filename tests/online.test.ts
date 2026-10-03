import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import type { ClientRequest } from 'node:http';
import { compileRule, documentContext, extract, select, template } from '../src/server/online/rules.js';
import { importSources } from '../src/server/online/import.js';
import { publicAddress, safeUrl, SafeHttpClient } from '../src/server/online/http.js';
import { OnlineSourceService } from '../src/server/online/service.js';
import { ReaderService } from '../src/server/service.js';
import { ReaderStore } from '../src/server/store.js';
import { fixtureServer, fixtureSource } from './online/fixture.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers(); });
async function fixture(handler?: Parameters<typeof fixtureServer>[0]) { const server = await fixtureServer(handler); cleanups.push(server.close); return server; }
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'reader-online-test-')); cleanups.push(() => rm(dir, { recursive: true, force: true })); const f = await fixture(); const store = new ReaderStore(dir), online = new OnlineSourceService(store, f.client), service = new ReaderService(store, online); return { ...f, store, online, service, dir }; }
async function enable(online: OnlineSourceService, raw: any = fixtureSource) { const preview = await online.preview(JSON.stringify(raw)); await online.commit(preview.token); await online.manage(preview.sources[0]!.id, true); return preview.sources[0]!.id; }
const signal = () => new AbortController().signal;

describe('complete no-script grammar and source diagnostics', () => {
  it('interprets CSS and verified classic selector chains, index zero, text, and relative attributes', () => {
    const doc = documentContext('<html><body><div class="books"><a href="../first">First</a><a href="/second">Second</a></div><div class="books">Other</div></body></html>');
    expect(extract(compileRule('class.books.0@tag.a.1@text'), doc)).toEqual(['Second']);
    expect(extract(compileRule('@css:.books > a@href'), doc)).toEqual(['../first', '/second']);
    expect(select(compileRule('class.books', true), doc)).toHaveLength(2);
    expect(extract(compileRule('id.none@text'), doc)).toEqual([]);
  });
  it('supports restricted JSONPath without evaluation and strips active HTML from text', () => {
    const doc = documentContext('{"items":[{"title":"One"},{"title":"Two"}]}');
    expect(extract(compileRule('$.items[*].title'), doc)).toEqual(['One', 'Two']);
    expect(extract(compileRule("$['items'][0].title"), doc)).toEqual(['One']);
    expect(extract(compileRule('#body@text'), documentContext('<div id="body">A<br>B<p>C<script>SECRET</script></p><iframe>SECRET</iframe></div>'))[0]).toContain('A\nB');
    expect(extract(compileRule('#body@text'), documentContext('<div id="body">Safe<script>SECRET</script><img onerror="evil()"></div>'))).toEqual(['Safe']);
    expect(template('/s?q={{key}}&p={{page}}', '中文 /&', 2)).toBe('/s?q=%E4%B8%AD%E6%96%87%20%2F%26&p=2');
  });
  it.each(['$.x[?(@.secret)]', '$..name', '$.constructor', '$[0:2]', '@js:java.readFile("secret")', 'a:nth-child(2)@text', '{{java.get()}}', 'a@text@js:evil'])('rejects all of an unsupported rule: %s', rule => { expect(() => compileRule(rule)).toThrow(); });
  it('imports single/array JSON; separates syntax from untested network; reports every stage and unknown field', () => {
    const [source] = importSources(JSON.stringify(fixtureSource));
    expect(source.report.syntax).toBe('supported');
    expect(Object.values(source.report.stages).every(s => s.network === 'untested')).toBe(true);
    expect(source.report.enabled).toBe(false);
    const partial = importSources(JSON.stringify({ ...fixtureSource, ruleContent: { content: '@js:eval("evil()")' } }))[0];
    expect(partial.report.syntax).toBe('partial'); expect(partial.report.stages.content.syntax).toBe('blocked');
    expect(partial.report.stages.content.diagnostics[0].field).toBe('ruleContent.content');
    const blocked = importSources(JSON.stringify({ ...fixtureSource, loginUrl: '/login', header: '{"Cookie":"secret"}' }))[0];
    expect(blocked.report.syntax).toBe('blocked'); expect(blocked.report.diagnostics).toHaveLength(2);
    expect(importSources('[null]')[0].report.syntax).toBe('invalid');
    expect(() => importSources('{"__proto__": {"polluted":true}}')).toThrow('原型');
    expect(() => importSources(JSON.stringify([fixtureSource, fixtureSource]))).toThrow('重复');
    expect(() => importSources(' '.repeat(512 * 1024 + 1))).toThrow('512');
    expect(importSources(JSON.stringify({ ...fixtureSource, searchUrl: '/search, {"charset":"unsupported"}' }))[0].report.stages.search.syntax).toBe('blocked');
  });
});

describe('public-only pinned HTTP client', () => {
  function failedConnection(code: string, beforeError?: () => void): ClientRequest {
    const request = new EventEmitter() as ClientRequest;
    request.end = (() => { queueMicrotask(() => { beforeError?.(); request.emit('error', Object.assign(new Error('synthetic connection failure'), { code })); }); return request; }) as ClientRequest['end'];
    return request;
  }
  it('retries a failed public address using the same validated DNS answer and original TLS hostname', async () => {
    const f = await fixture(), pins: string[] = [], hosts: string[] = [];
    const resolve = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }]);
    const client = new SafeHttpClient({ resolve, transport: (url, options, callback) => {
      hosts.push(url.hostname);
      (options.lookup as any)(url.hostname, {}, (_error: unknown, address: string) => pins.push(address));
      expect(options.agent).toBe(false); expect(options).not.toHaveProperty('rejectUnauthorized', false);
      return pins.length === 1 ? failedConnection('ECONNRESET') : (f.client as any).dependencies.transport(url, options, callback);
    } });
    expect((await client.get('https://reader.example.com/search')).text).toContain('原创');
    expect(resolve).toHaveBeenCalledTimes(1); expect(pins).toEqual(['8.8.8.8', '1.1.1.1']);
    expect(hosts).toEqual(['reader.example.com', 'reader.example.com']);
  });
  it('deduplicates addresses and caps connection attempts at three', async () => {
    const transport = vi.fn(() => failedConnection('ECONNRESET'));
    const client = new SafeHttpClient({ resolve: async () => ['8.8.8.8', '8.8.8.8', '1.1.1.1', '9.9.9.9', '4.4.4.4'].map(address => ({ address, family: 4 })), transport });
    await expect(client.get('https://reader.example.com')).rejects.toThrow('连接失败'); expect(transport).toHaveBeenCalledTimes(3);
  });
  it('does not retry TLS verification failures, cancellation or HTTP denial on other addresses', async () => {
    const resolve = async () => [{ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 }];
    const tls = vi.fn(() => failedConnection('CERT_HAS_EXPIRED'));
    await expect(new SafeHttpClient({ resolve, transport: tls }).get('https://reader.example.com')).rejects.toThrow('连接失败'); expect(tls).toHaveBeenCalledTimes(1);
    const abort = new AbortController(), cancelled = vi.fn(() => failedConnection('ECONNRESET', () => abort.abort()));
    await expect(new SafeHttpClient({ resolve, transport: cancelled }).get('https://reader.example.com', abort.signal)).rejects.toThrow(); expect(cancelled).toHaveBeenCalledTimes(1);
    const f = await fixture((_req, response) => { response.writeHead(403); response.end('Denied'); });
    const denied = vi.fn((url, options, callback) => (f.client as any).dependencies.transport(url, options, callback));
    await expect(new SafeHttpClient({ resolve, transport: denied }).get('https://reader.example.com')).rejects.toThrow('HTTP 403'); expect(denied).toHaveBeenCalledTimes(1);
  });
  it('keeps one total timeout across public-address retries', async () => {
    vi.useFakeTimers();
    const transport = vi.fn((_url, options) => {
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        const timer = setTimeout(() => request.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET' })), 6000);
        options.signal.addEventListener('abort', () => { clearTimeout(timer); request.emit('error', Object.assign(new Error('abort'), { code: 'ABORT_ERR' })); }, { once: true });
        return request;
      }) as ClientRequest['end'];
      return request;
    });
    const client = new SafeHttpClient({ resolve: async () => ['8.8.8.8', '1.1.1.1', '9.9.9.9'].map(address => ({ address, family: 4 })), transport });
    const rejected = expect(client.get('https://reader.example.com')).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(10001); await rejected; expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each(['127.0.0.1', '0.0.0.0', '10.2.3.4', '172.16.1.1', '192.168.0.1', '169.254.169.254', '100.100.100.200', '198.18.0.1', '192.0.0.1', '192.0.2.1', '224.1.1.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2001:db8::1', '2001::1'])('blocks non-public address %s', address => { expect(publicAddress(address)).toBe(false); });
  it.each(['http://2130706433/', 'http://0177.0.0.1/', 'http://0x7f000001/', 'http://[::ffff:7f00:1]/', 'http://localhost/', 'http://metadata.google.internal/', 'file:///etc/passwd', 'https://user:pass@example.com', 'http://example.com:22', 'http://example.com\\@127.0.0.1'])('blocks unsafe URL %s', url => { expect(() => safeUrl(url)).toThrow(); });
  it('allows global IPv4/IPv6 and rejects any mixed private DNS answer before transport', async () => {
    expect(publicAddress('8.8.8.8')).toBe(true); expect(publicAddress('2606:4700:4700::1111')).toBe(true);
    const transport = vi.fn();
    const http = new SafeHttpClient({ resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }], transport });
    await expect(http.get('https://example.com')).rejects.toThrow('DNS'); expect(transport).not.toHaveBeenCalled();
  });
  it('pins approved lookup addresses, keeps Host/SNI hostname, uses no cookies, auth, or environment proxy', async () => {
    const f = await fixture(); await f.client.get('https://reader.example.com/search');
    const opts = f.options[0];
    const found: any = await new Promise(resolve => (opts.lookup as any)('reader.example.com', { all: true }, (_error: any, addresses: any) => resolve(addresses)));
    expect(found).toEqual([{ address: '93.184.216.34', family: 4 }]); expect(opts.agent).toBe(false);
    expect(Object.keys(opts.headers!)).toEqual(['Accept', 'Accept-Encoding', 'User-Agent']);
  });
  it('rechecks each redirect and rejects rebinding, cross-origin, and private targets', async () => {
    const f = await fixture((_req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1/private' }); res.end(); });
    await expect(f.client.get('https://reader.example.com/start')).rejects.toThrow('非公网'); expect(f.requests).toHaveLength(1);
    const g = await fixture((_req, res) => { res.writeHead(302, { Location: 'https://other.example.com/end' }); res.end(); });
    await expect(g.client.get('https://reader.example.com/start')).rejects.toThrow('跨域');
    const transport = vi.fn((url, opts, callback) => {
      // Reuse test fixture transport, then make the second DNS answer private.
      return (f.client as any).dependencies.transport(url, opts, callback);
    });
    let calls = 0;
    const same = await fixture((_req, res) => { res.writeHead(302, { Location: '/next' }); res.end(); });
    const http = new SafeHttpClient({ resolve: async () => [{ address: ++calls === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }], transport: (same.client as any).dependencies.transport });
    await expect(http.get('https://reader.example.com/start')).rejects.toThrow('DNS'); expect(calls).toBe(2);
  });
  it('bounds bytes, rejects compression, handles GBK, aborts slow streams and DNS', async () => {
    const f = await fixture((req, res) => {
      if (req.url === '/big') { res.setHeader('Content-Length', 3 * 1024 * 1024); res.end('big'); }
      else if (req.url === '/zip') { res.setHeader('Content-Encoding', 'gzip'); res.end('compressed bomb'); }
      else if (req.url === '/gbk') { res.setHeader('Content-Type', 'text/plain;charset=gbk'); res.end(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])); }
      else if (req.url === '/chunk') { res.end(Buffer.alloc(2 * 1024 * 1024 + 1)); }
      else { res.writeHead(200); res.write('slow'); }
    });
    await expect(f.client.get('https://reader.example.com/big')).rejects.toThrow('2 MiB');
    await expect(f.client.get('https://reader.example.com/zip')).rejects.toThrow('压缩');
    await expect(f.client.get('https://reader.example.com/chunk')).rejects.toThrow('2 MiB');
    expect((await f.client.get('https://reader.example.com/gbk')).text).toBe('中文');
    const controller = new AbortController(); const result = f.client.get('https://reader.example.com/slow', controller.signal); controller.abort(); await expect(result).rejects.toThrow();
    vi.useFakeTimers(); const pending = new SafeHttpClient({ resolve: () => new Promise(() => {}) }).get('https://reader.example.com'); const rejected = expect(pending).rejects.toThrow('超时'); await vi.advanceTimersByTimeAsync(10001); await rejected;
  });
  it('caps concurrency/queue and releases cancelled slots; bounds redirect loops', async () => {
    const f = await fixture((req, res) => { if (req.url === '/ok') res.end('ok'); else if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); } else res.write('waiting'); });
    const controllers = Array.from({ length: 21 }, () => new AbortController());
    const pending = controllers.map((controller, i) => f.client.get(`https://reader.example.com/slow?i=${i}`, controller.signal).then(() => 'passed', error => error.message));
    await vi.waitFor(() => expect(f.requests).toHaveLength(4));
    expect(await pending[20]).toContain('队列');
    controllers.forEach(c => c.abort()); await Promise.all(pending);
    expect((await f.client.get('https://reader.example.com/ok')).text).toBe('ok');
    await expect(f.client.get('https://reader.example.com/loop')).rejects.toThrow('循环');
  });
});

describe('online source service and durable lazy reading', () => {
  it('requires preview, defaults disabled, deduplicates imports, and detects concurrent changes', async () => {
    const { online } = await setup(); const preview = await online.preview(JSON.stringify(fixtureSource));
    expect(await online.listSources()).toEqual([]); await online.commit(preview.token);
    await expect(online.search(preview.sources[0].id, 'book', 1, signal())).rejects.toThrow('未启用');
    const next = await online.preview(JSON.stringify(fixtureSource)); expect(next.changes[0].kind).toBe('unchanged');
    await online.manage(preview.sources[0].id, true); await expect(online.commit(next.token)).rejects.toThrow('变化');
    const update = await online.preview(JSON.stringify({ ...fixtureSource, bookSourceName: 'New name' })); expect(update.changes[0].kind).toBe('replace'); await online.commit(update.token); expect((await online.listSources())[0].enabled).toBe(false);
  });
  it('search → detail → toc → lazy chapter; restart, stable progress/bookmarks, insert/refresh and cached offline reading', async () => {
    const { online, requests, store, dir, insertChapter, service } = await setup(); const sourceId = await enable(online);
    const found = await online.search(sourceId, '中文', 1, signal()); expect(found[0].title).toBe('原创河岸故事');
    expect(requests[0]).toContain('%E4%B8%AD%E6%96%87');
    const detail = await online.detail(found[0], signal()), book = await online.add(detail, signal());
    expect(book.document.format).toBe('online'); expect(book.document.chapters[1].paragraphs).toEqual([]); expect(requests.some(url => url.endsWith('/two'))).toBe(false);
    expect(book.document.chapters[0].paragraphs.join('')).not.toContain('window.PWNED');
    const second = await online.chapter(book.summary.id, book.document.chapters[1].id, signal());
    const locator = { chapter: 1, chapterId: second.document.chapters[1].id, paragraph: 1 };
    await online.saveProgress(book.summary.id, locator); await online.addBookmark(book.summary.id, locator, 'stable');
    insertChapter(); const refreshed = await online.refresh(book.summary.id, signal());
    expect(refreshed.summary.locator).toEqual({ ...locator, chapter: 2 }); expect(refreshed.bookmarks[0].locator.chapter).toBe(2);
    await online.manage(sourceId, false);
    const restarted = new OnlineSourceService(new ReaderStore(dir));
    const opened = await restarted.open(book.summary.id, signal()); expect(opened.summary.locator.chapterId).toBe(locator.chapterId); expect(opened.document.chapters[2].paragraphs[1]).toBe('这是原创测试段落。');
    expect(opened.bookmarks).toHaveLength(1); await expect(restarted.chapter(book.summary.id, refreshed.document.chapters[0].id, signal())).rejects.toThrow('未启用');
    const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import { ReaderStore } from './src/server/store.ts'; import { OnlineSourceService } from './src/server/online/service.ts'; const book = await new OnlineSourceService(new ReaderStore(process.argv[1])).open(process.argv[2], new AbortController().signal); console.log(JSON.stringify({ locator: book.summary.locator, bookmarks: book.bookmarks.length, text: book.document.chapters[2].paragraphs[1] }));", dir, book.summary.id], { timeout: 15000, maxBuffer: 1024 * 1024 });
    expect(JSON.parse(child.stdout)).toEqual({ locator: { ...locator, chapter: 2 }, bookmarks: 1, text: '这是原创测试段落。' });
    const local = await store.importBook('Regression.txt', Buffer.from('Chapter One\n\nLocal text.'));
    expect((await service.call('reader_list', {}) as any).books).toHaveLength(2); expect((await store.open(local.summary.id)).document.format).toBe('txt');
    const record = JSON.parse(await readFile(join(dir, 'books', local.summary.id, 'record.json'), 'utf8')); expect(record.version).toBe(1); expect(record.summary.locator.chapterId).toBeUndefined();
    const reports = await online.listSources(); expect(Object.values(reports[0].stages).every(s => s.network === 'passed')).toBe(true);
  }, 20000); // Includes a real fresh Node + tsx process on shared CI runners.
  it('reports failing field without claiming later stages passed, and never runs blocked content', async () => {
    const { online } = await setup(); const sourceId = await enable(online, { ...fixtureSource, ruleSearch: { ...fixtureSource.ruleSearch, name: '.missing@text' }, ruleContent: { content: '@js:eval("evil")' } });
    await expect(online.search(sourceId, 'q', 1, signal())).rejects.toThrow('ruleSearch.name');
    const report = (await online.listSources())[0]; expect(report.stages.search.network).toBe('failed'); expect(report.stages.detail.network).toBe('untested'); expect(report.stages.content.syntax).toBe('blocked');
  });
  it('returns an empty successful search for no matches and the final page, then allows another query', async () => {
    const { online, requests } = await setup(), sourceId = await enable(online);
    expect(await online.search(sourceId, '不存在的书', 1, signal())).toEqual([]);
    expect((await online.listSources())[0].stages.search).toMatchObject({ network: 'passed', lastError: undefined });
    expect(await online.search(sourceId, '原创', 1, signal())).toHaveLength(1);
    expect(await online.search(sourceId, '原创', 2, signal())).toEqual([]);
    const report = (await online.listSources())[0];
    expect(report.stages.search).toMatchObject({ network: 'passed', lastError: undefined });
    expect(report.stages.detail.network).toBe('untested');
    expect(requests).toHaveLength(3);
    expect(await online.search(sourceId, '原创', 1, signal())).toHaveLength(1);
  });
  it('distinguishes empty JSON arrays from missing/wrong list structure and malformed responses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reader-empty-json-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    let body = '{"books":[]}';
    const server = await fixture((_req, res) => res.end(body));
    const online = new OnlineSourceService(new ReaderStore(dir), server.client);
    const sourceId = await enable(online, { ...fixtureSource, ruleSearch: { bookList: '$.books[*]', name: '$.title', bookUrl: '$.url' } });
    expect(await online.search(sourceId, 'none', 1, signal())).toEqual([]);
    expect((await online.listSources())[0].stages.search.network).toBe('passed');
    for (const [invalid, reason] of [['{"error":"wrong schema"}', '缺少字段'], ['{"books":null}', '需要数组'], ['{"books":{}}', '需要数组'], ['<p>not JSON</p>', '需要 JSON 响应'], ['{"books":', '响应解析失败']] as const) {
      body = invalid;
      await expect(online.search(sourceId, 'none', 1, signal())).rejects.toThrow(`ruleSearch.bookList：`);
      const report = (await online.listSources())[0].stages.search;
      expect(report.network).toBe('failed'); expect(report.lastError).toContain(reason);
    }
    body = '{"books":[]}';
    expect(await online.search(sourceId, 'none', 2, signal())).toEqual([]);
    expect((await online.listSources())[0].stages.search).toMatchObject({ network: 'passed', lastError: undefined });
    const indexedId = await enable(online, { ...fixtureSource, bookSourceUrl: 'https://reader.example.com/indexed', ruleSearch: { bookList: '$.books[0]', name: '$.title', bookUrl: '$.url' } });
    expect(await online.search(indexedId, 'none', 1, signal())).toEqual([]);
    expect((await online.listSources()).find(source => source.id === indexedId)!.stages.search.network).toBe('passed');
  });
  it('keeps invalid list selectors blocked instead of converting them to empty search results', async () => {
    const { online, requests } = await setup();
    const sourceId = await enable(online, { ...fixtureSource, ruleSearch: { ...fixtureSource.ruleSearch, bookList: 'div[' } });
    await expect(online.search(sourceId, 'q', 1, signal())).rejects.toThrow('ruleSearch：该阶段语法');
    expect((await online.listSources())[0].stages.search).toMatchObject({ syntax: 'blocked', network: 'untested' });
    expect(requests).toEqual([]);
  });
  it('deduplicates in-flight jobs; last subscriber cancellation aborts; stale results cannot complete', async () => {
    const { online } = await setup(); let resolve!: (value: string) => void; let received!: AbortSignal;
    const work = vi.fn((s: AbortSignal) => { received = s; return new Promise<string>(done => { resolve = done; }); });
    const a = randomUUID(), b = randomUUID(), first = online.run(a, 'same', work), second = online.run(b, 'same', work);
    await Promise.resolve(); online.cancel(a); expect(received.aborted).toBe(false); resolve('done');
    await expect(first).rejects.toThrow('取消'); expect(await second).toBe('done'); expect(work).toHaveBeenCalledTimes(1);
    const c = randomUUID(), pending = online.run(c, 'cancel', s => new Promise((_resolve, reject) => s.addEventListener('abort', () => reject(s.reason))));
    await Promise.resolve(); online.cancel(c); await expect(pending).rejects.toThrow('取消');
  });
  it('supports JSON search and two-page toc/content; rejects cycles/limits without replacing a good directory or cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reader-pages-test-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    let mode = 'normal';
    const f = await fixture((req, res) => {
      const url = req.url!;
      if (url.startsWith('/search')) { res.setHeader('Content-Type', 'application/json'); res.end('{"books":[{"title":"JSON story","url":"/book"}]}'); }
      else if (url === '/book') res.end('<a class="toc" href="/toc">TOC</a>');
      else if (url.startsWith('/toc')) {
        const page = Number(new URL(url, 'https://reader.example.com').searchParams.get('p') ?? '1');
        const next = mode === 'cycle' ? '/toc' : mode === 'limit' ? `/toc?p=${page + 1}` : page === 1 ? '/toc?p=2' : '';
        res.end(`<div class="chapters"><a href="/chapter/${page}">Chapter ${page}</a></div>${next ? `<a class="next" href="${next}">Next</a>` : ''}`);
      } else if (url === '/chapter/1') res.end('<div id="content">First page.</div><a class="next" href="/part2">Next</a>');
      else if (url === '/part2') res.end('<div id="content">Second page.</div>');
      else { res.statusCode = 403; res.end('Access denied'); }
    });
    const online = new OnlineSourceService(new ReaderStore(dir), f.client);
    const sourceId = await enable(online, { ...fixtureSource, ruleSearch: { bookList: '$.books[*]', name: '$.title', bookUrl: '$.url' }, ruleBookInfo: { tocUrl: 'a.toc@href' } });
    const found = await online.search(sourceId, 'test', 1, signal()), detail = await online.detail(found[0], signal()), book = await online.add(detail, signal());
    expect(book.document.chapters).toHaveLength(2); expect(book.document.chapters[0].paragraphs).toEqual(['First page.', 'Second page.']);
    const cacheFile = join(dir, 'online-v1', 'cache', book.summary.id, detail.revision, `${book.document.chapters[0].id}.json`), cached = await readFile(cacheFile, 'utf8');
    await expect(online.chapter(book.summary.id, book.document.chapters[1].id, signal())).rejects.toThrow('HTTP 403');
    expect(await readFile(cacheFile, 'utf8')).toBe(cached);
    mode = 'cycle'; await expect(online.refresh(book.summary.id, signal())).rejects.toThrow('循环');
    mode = 'limit'; await expect(online.refresh(book.summary.id, signal())).rejects.toThrow('超过 5');
    expect((await online.open(book.summary.id, signal())).document.chapters).toHaveLength(2);
  });
  it('invalidates a response after source disable/re-enable and isolates new source revision books', async () => {
    const { online, requests } = await setup(); const sourceId = await enable(online);
    const result = (await online.search(sourceId, 'book', 1, signal()))[0], detail = await online.detail(result, signal()), oldBook = await online.add(detail, signal());
    const source = await online.source(sourceId);
    await online.manage(sourceId, false); await online.manage(sourceId, true);
    await expect(online.source(sourceId, source.report.revision, source.generation)).rejects.toThrow('过期');
    const update = await online.preview(JSON.stringify({ ...fixtureSource, bookSourceName: 'Revision 2' })); await online.commit(update.token); await online.manage(sourceId, true);
    await expect(online.detail(result, signal())).rejects.toThrow('版本');
    const newResult = (await online.search(sourceId, 'book', 1, signal()))[0], newDetail = await online.detail(newResult, signal()), newBook = await online.add(newDetail, signal());
    expect(newBook.summary.id).not.toBe(oldBook.summary.id);
    const before = requests.length; expect((await online.open(oldBook.summary.id, signal())).document.chapters[0].loaded).toBe(true); expect(requests.length).toBe(before);
    await expect(online.chapter(oldBook.summary.id, oldBook.document.chapters[1].id, signal())).rejects.toThrow('版本');
  });
  it('never exposes fixture network exceptions via strict RPC schemas', async () => {
    const { service } = await setup();
    await expect(service.call('reader_online_preview_url', { url: 'http://127.0.0.1', requestId: randomUUID(), allowPrivate: true })).rejects.toThrow();
    await expect(service.call('reader_online_search', { sourceId: 'a'.repeat(64), key: 'q', page: 6, requestId: randomUUID() })).rejects.toThrow();
    await expect(service.call('constructor', {})).rejects.toThrow('未知');
  });
  it('reports malicious document complexity as a failed stage and keeps the same service usable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reader-bounded-service-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    let hostile = true;
    const server = await fixture((_req, res) => res.end(hostile ? '<div>'.repeat(5000) + 'hello' + '</div>'.repeat(5000) : '<div class="book"><a href="/book">Healthy</a><span class="author">Test</span></div>'));
    const store = new ReaderStore(dir), online = new OnlineSourceService(store, server.client), service = new ReaderService(store, online);
    const sourceId = await enable(online);
    await expect(service.call('reader_online_search', { sourceId, key: 'test', page: 1, requestId: randomUUID() })).rejects.toThrow('深度');
    expect((await online.listSources())[0].stages.search.network).toBe('failed');
    expect((await service.call('reader_list', {}) as any).books).toEqual([]);
    hostile = false;
    expect((await service.call('reader_online_search', { sourceId, key: 'test', page: 1, requestId: randomUUID() }) as any)[0].title).toBe('Healthy');
    expect((await online.listSources())[0].stages.search.network).toBe('passed');
  });
});
