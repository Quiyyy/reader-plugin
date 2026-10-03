import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ClientRequest } from 'node:http';
import { compileRule, documentContext, extract, select } from '../src/server/online/rules.js';
import { searchRequest } from '../src/server/online/request.js';
import { inspectSource } from '../src/server/online/import.js';
import { SafeHttpClient } from '../src/server/online/http.js';
import { OnlineSourceService } from '../src/server/online/service.js';
import { ReaderStore } from '../src/server/store.js';
import { fixtureServer, fixtureSource } from './online/fixture.js';
import { declarativeSource } from './online/declarative.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const signal = () => new AbortController().signal;
async function fixture(handler?: Parameters<typeof fixtureServer>[0]) { const f = await fixtureServer(handler); cleanups.push(f.close); return f; }
const read = (rule: string, html: string) => extract(compileRule(rule), documentContext(html));

describe('bounded declarative syntax', () => {
  it('extracts current-node attributes, sanitized html and direct text nodes', () => {
    const doc = documentContext('<a href="/chapter" title="name">甲<br>乙<script>secret</script><span>丙</span>丁</a>');
    const [a] = select(compileRule('a', true), doc);
    expect(extract(compileRule('href'), a)).toEqual(['/chapter']);
    expect(extract(compileRule('html'), a)).toEqual(['甲\n乙丙丁']);
    expect(extract(compileRule('textNodes'), a)).toEqual(['甲\n乙\n丁']);
    expect(read('img@alt', '<img alt="封面标题" onerror="alert(1)">')).toEqual(['封面标题']);
    expect(read('script@html', '<script>secret</script>')).toEqual([]);
  });
  it('handles local negative indexes, exclusion, direct children and literal own text', () => {
    const html = '<div class="rows"><p>A</p><p>B<span>nested</span></p><p>C</p></div><div class="rows"><p>D</p><p>E</p></div>';
    expect(read('class.rows@tag.p.-1@text', html)).toEqual(['C', 'E']);
    expect(read('.rows@p!0@text', html)).toEqual(['Bnested', 'C', 'E']);
    expect(read('class.rows.0@tag.p.!-1@text', html)).toEqual(['A', 'Bnested']);
    expect(read('.rows@children[0]@text', html)).toEqual(['A', 'D']);
    expect(read('.rows@children[-1]@text', html)).toEqual(['C', 'E']);
    expect(read('text.B@text', html)).toEqual(['Bnested']);
    expect(read('div@tag.span.-1@text.下一页.0@href', '<div><span>上页</span><span><a href="/next">下一页</a></span></div>')).toEqual(['/next']);
    expect(read('p.99@text', html)).toEqual([]);
  });
  it('recognizes narrow XPath predicates and CSS attribute predicates', () => {
    const html = '<html><head><meta property="reader:title" content="原创故事"><meta name="author" content="作者"></head><body><div class="pager"><span><a href="/next">下一页</a></span><a href="/wrong">下一页</a></div><a class="more" href="#">末页</a><a class="more" href="/last">有效</a></body></html>';
    expect(read("//meta[@property='reader:title']/@content", html)).toEqual(['原创故事']);
    expect(read('//meta[@name="author"]/@content', html)).toEqual(['作者']);
    expect(read("//div[@class='pager']/span/a[text()='下一页']/@href", html)).toEqual(['/next']);
    expect(read(".more:not([href='#'])@href", html)).toEqual(['/last']);
    expect(read('[property$=title]@content', html)).toEqual(['原创故事']);
    expect(read('[content="原创故事"]@content', html)).toEqual(['原创故事']);
  });
  it.each(['@css:', 'a:nth-child(2)@text', '//div[last()]/a/@href', '//div/following-sibling::a/@href', 'a,b@href', 'class.items.-1:0@text', 'a:not(:hover)@text', 'a@href##$##,{"webView":true}', 'a@text##(a)\\1', 'a@text##a(?=b)', 'a@text##x##y##z', '@js:1', '{{java.get()}}', '$..data'])('rejects unsupported whole rule %s', rule => {
    expect(() => compileRule(rule)).toThrow();
  });
  it('cleans text with RE2 and bounds zero-width, amplification, work and input', () => {
    expect(read('p@text##《|》', '<p>《原创》</p>')).toEqual(['原创']);
    expect(read('a@href##old##new', '<a href="/old/chapter">x</a>')).toEqual(['/new/chapter']);
    expect(read('p@text##$##!', '<p>😀甲</p>')).toEqual(['😀甲!']);
    expect(read('p@text##^|$##!', '<p>😀甲</p>')).toEqual(['!😀甲!']);
    expect(read('p@text##(?:)##!', '<p>😀甲</p>')).toEqual(['!😀!甲!']);
    expect(read('p@text##😀##星', '<p>😀甲😀乙</p>')).toEqual(['星甲星乙']);
    expect(read('p@text##甲|乙##!', '<p>😀甲😀乙</p>')).toEqual(['😀!😀!']);
    expect(read('p@text##(a+)+$', '<p>' + 'a'.repeat(10000) + '!</p>')[0]).toHaveLength(10001);
    expect(() => read('p@text##a', '<p>' + 'a'.repeat(513) + '</p>')).toThrow(/512/);
    expect(() => read('p@text##x', '<p>' + 'a'.repeat(131073) + '</p>')).toThrow(/128 Ki/);
    expect(() => read('p@text##.', '<p>' + 'a'.repeat(120000) + '</p>')).toThrow(/同步工作预算/);
    expect(() => compileRule('text##' + 'x'.repeat(513))).toThrow(/512/);
    expect(() => compileRule('text##(ab){1000}')).toThrow(/计数/);
    expect(() => compileRule('text##' + '('.repeat(17) + 'a' + ')'.repeat(17))).toThrow(/超限/);
  });
  it('does not block used stages for scripts in ignored metadata, but preserves active blockers', () => {
    const report = inspectSource(declarativeSource).report;
    expect(Object.values(report.stages).map(s => s.syntax)).toEqual(['partial', 'partial', 'partial', 'partial']);
    expect(Object.values(report.stages).every(s => s.network === 'untested')).toBe(true);
    expect(report.enabled).toBe(false);
    expect(report.diagnostics.find(d => d.field === 'enabledCookieJar')?.reason).toContain('不存储或发送');
    expect(inspectSource({ ...declarativeSource, ruleContent: { content: '@js:eval("active()")' } }).report.stages.content.syntax).toBe('blocked');
    for (const key of ['header', 'jsLib', 'concurrentRate', 'unknown']) expect(inspectSource({ ...fixtureSource, [key]: 'unhandled' }).report.syntax).toBe('blocked');
    expect(inspectSource({ ...fixtureSource, ruleToc: { ...fixtureSource.ruleToc, isVip: '@js:active()' } }).report.stages.toc.syntax).toBe('blocked');
  });
});

describe('literal search form requests', () => {
  it('parses quoted literal options without evaluating code and safely encodes keywords', () => {
    expect(searchRequest("/find,{'method':'post','body':'keyword={{key}}&page={{page}}','charset':'UTF-8'}", '中文 &/=', 2)).toEqual({ url: '/find', method: 'POST', body: 'keyword=%E4%B8%AD%E6%96%87%20%26%2F%3D&page=2', charset: 'utf-8', headers: {} });
    expect(searchRequest('/find?q={{key}}', '甲', 1)).toEqual({ url: '/find?q=%E7%94%B2', method: 'GET', body: undefined, charset: 'utf-8', headers: {} });
    expect(searchRequest('/find,{"method":"GET"}', '甲', 1).method).toBe('GET');
  });
  it.each([
    "/find,{'method': getMethod()}", "/find,{'webView':'true'}", "/find,{'header':'Cookie: secret'}", "/find,{'method':'delete'}",
    "/find,{'method':'post','body':'q={{java.get()}}'}",
    "/find,{'method':'GET','body':'q={{key}}'}", "/find,{'method':'GET','method':'POST'}",
    "/find,{'__proto__':'x'}", "/find,{'method':'GET'};attack()",
  ])('rejects active or ambiguous request configuration %s', value => expect(() => searchRequest(value, '甲', 1)).toThrow());
  it.each([301, 302, 303, 307, 308])('applies redirect method semantics for %i without cookies', async status => {
    const seen: { method?: string; body: string; cookie?: string }[] = [];
    const f = await fixture(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      seen.push({ method: req.method, body, cookie: req.headers.cookie });
      if (req.url === '/start') { res.writeHead(status, { Location: '/end', 'Set-Cookie': 'session=ignored' }); res.end(); }
      else res.end('<p>done</p>');
    });
    await f.client.post('https://reader.example.com/start', 'keyword=%E7%94%B2', signal());
    expect(seen).toEqual([{ method: 'POST', body: 'keyword=%E7%94%B2', cookie: undefined }, { method: status >= 307 ? 'POST' : 'GET', body: status >= 307 ? 'keyword=%E7%94%B2' : '', cookie: undefined }]);
  });
  it('keeps POST DNS pinning and prevents cross-origin forwarding, private DNS and retries', async () => {
    const f = await fixture((_req, res) => { res.writeHead(307, { Location: 'https://other.example.com/end' }); res.end(); });
    await expect(f.client.post('https://reader.example.com/start', 'q=x')).rejects.toThrow('跨域');
    expect(f.requests).toHaveLength(1);
    const denied = vi.fn();
    await expect(new SafeHttpClient({ resolve: async () => [{ address: '127.0.0.1', family: 4 }], transport: denied }).post('https://reader.example.com/', 'q=x')).rejects.toThrow('DNS');
    expect(denied).not.toHaveBeenCalled();
    const transport = vi.fn((_url, options) => {
      expect(options.method).toBe('POST'); expect(options.agent).toBe(false);
      expect(options.headers).not.toHaveProperty('Cookie'); expect(options.headers).not.toHaveProperty('Authorization');
      (options.lookup as any)('reader.example.com', {}, (_error: unknown, address: string) => expect(address).toBe('8.8.8.8'));
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => { queueMicrotask(() => request.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET' }))); return request; }) as ClientRequest['end'];
      return request;
    });
    await expect(new SafeHttpClient({ resolve: async () => ['8.8.8.8', '1.1.1.1'].map(address => ({ address, family: 4 })), transport }).post('https://reader.example.com/', 'q=x')).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

it('runs original declarative source through search, detail, paginated toc/body, restart and offline cache', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reader-declarative-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const f = await fixture(), online = new OnlineSourceService(new ReaderStore(dir), f.client);
  const preview = await online.preview(JSON.stringify(declarativeSource));
  expect(f.requests).toEqual([]);
  await online.commit(preview.token); await online.manage(preview.sources[0].id, true);
  const results = await online.search(preview.sources[0].id, '原创', 1, signal());
  expect(results[0]).toMatchObject({ title: '原创纸桥', author: '样例作者' });
  const detail = await online.detail(results[0], signal());
  expect(detail.intro).toBe('原创的两章短文。');
  const book = await online.add(detail, signal());
  expect(book.document.chapters).toHaveLength(2);
  expect(book.document.chapters[0].paragraphs).toEqual(['折好的纸桥横跨浅浅的水洼。', '纸桥的另一端留着一片叶子。']);
  expect(f.requests).toEqual(['/grammar/search', '/grammar/book', '/grammar/toc', '/grammar/toc-2', '/grammar/one', '/grammar/one-2']);
  const locator = { chapter: 0, paragraph: 1, chapterId: book.document.chapters[0].id };
  await online.saveProgress(book.summary.id, locator); await online.addBookmark(book.summary.id, locator, '原创书签');
  expect(Object.values((await online.listSources())[0].stages).every(s => s.network === 'passed')).toBe(true);
  const requests = f.requests.length; f.setOffline(true);
  const restarted = new OnlineSourceService(new ReaderStore(dir), f.client);
  const restored = await restarted.open(book.summary.id, signal());
  expect(restored.summary.locator).toEqual(locator); expect(restored.bookmarks[0].label).toBe('原创书签');
  expect(restored.document.chapters[0].paragraphs).toHaveLength(2); expect(f.requests).toHaveLength(requests);
});
