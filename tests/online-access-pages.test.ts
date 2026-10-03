import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OnlineSourceService } from '../src/server/online/service.js';
import { ReaderStore } from '../src/server/store.js';
import { fixtureServer, fixtureSource } from './online/fixture.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const results = '<title>Original public library</title><main id="maintextdiv"><table><tr><td>1</td><td><a href="/book">原创山河录</a></td></tr></table></main>';
const jsd = (name = 'main') => `<script>const injected = document.createElement('script'); injected.src='/cdn-cgi/challenge-platform/scripts/jsd/${name}.js'; document.head.appendChild(injected); throw new Error('page script must never run');</script>`;
async function setup(text: string, headers: Record<string, string> = {}, status = 200) {
  const f = await fixtureServer((_req, response) => { response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers }); response.end(text); });
  cleanups.push(f.close);
  const directory = await mkdtemp(join(tmpdir(), 'reader-access-page-test-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const online = new OnlineSourceService(new ReaderStore(directory), f.client);
  const preview = await online.preview(JSON.stringify({ ...fixtureSource, ruleSearch: { bookList: '#maintextdiv tr', name: 'td.1@text', bookUrl: 'a@href' } }));
  await online.commit(preview.token);
  const id = preview.sources[0]!.id;
  await online.manage(id, true);
  return { ...f, online, id, search: () => online.search(id, '原创', 1, new AbortController().signal) };
}

describe('public pages with passive instrumentation versus access challenges', () => {
  it.each(['main', 'api'])('reads public table results with passive JSD %s without requesting or executing page scripts', async name => {
    const f = await setup(results + jsd(name));
    const found = await f.search();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ title: '原创山河录', url: 'https://reader.example.com/book' });
    expect(f.requests).toHaveLength(1);
    const [source] = await f.online.listSources();
    expect(source.stages.search.network).toBe('passed');
    expect(source.stages.content.network).toBe('untested');
  });
  it.each([
    ['challenge title', '<title>Just a moment...</title>'],
    ['attention title', '<title>Attention Required! | Cloudflare</title>'],
    ['human verification title', '<title>人机验证</title>'],
    ['user login title', '<title>用户登录</title>'],
    ['member login title', '<title>会员登录</title>'],
    ['active challenge marker', '<form id="cf-chl-widget"></form>'],
    ['active platform script', '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'],
    ['unrecognized JSD file', jsd('other')],
    ['lookalike JSD prefix', '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js-blocking"></script>'],
  ])('still rejects %s even when passive instrumentation and matching result rows coexist', async (_name, challenge) => {
    const f = await setup(challenge + results + jsd());
    await expect(f.search()).rejects.toThrow('网站要求登录或人机验证');
    expect(f.requests).toHaveLength(1);
    const [source] = await f.online.listSources();
    expect(source.stages.search.network).toBe('failed');
    expect(source.stages.content.network).toBe('untested');
  });
  it.each([200, 302, 403])('rejects a cf-mitigated challenge at HTTP %s before parsing, redirecting or retrying', async status => {
    const f = await setup(results + jsd(), { 'cf-mitigated': 'challenge', location: '/book' }, status);
    await expect(f.search()).rejects.toThrow('网站要求人机验证');
    expect(f.requests).toHaveLength(1);
  });
  it.each([401, 403])('still rejects HTTP %s with ordinary-looking result content', async status => {
    const f = await setup(results + jsd(), {}, status);
    await expect(f.search()).rejects.toThrow(`HTTP ${status}`);
    expect(f.requests).toHaveLength(1);
  });
});
