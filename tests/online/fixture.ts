import { createServer, request, type RequestListener, type RequestOptions } from 'node:http';
import { SafeHttpClient } from '../../src/server/online/http.js';

export { fixtureSource } from './source.js';
export async function fixtureServer(handler?: RequestListener) {
  const requests: string[] = [], options: RequestOptions[] = [];
  let inserted = false;
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (handler) return handler(req, res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const path = new URL(req.url!, 'http://fixture.local').pathname;
    if (path === '/search') res.end('<div class="book"><a href="/book">原创河岸故事</a><span class="author">Reader 测试作者</span></div>');
    else if (path === '/book') res.end('<h1>原创河岸故事</h1><div class="author">Reader 测试作者</div><div class="intro">这是合成的原创测试文本，不来自外部书库。</div><a class="toc" href="/toc">目录</a>');
    else if (path === '/toc') res.end(`<div class="chapters">${inserted ? '<a href="/chapter/zero">新增序章</a>' : ''}<a href="/chapter/one">第一章 河岸</a><a href="/chapter/two">第二章 灯光</a></div>`);
    else if (path.startsWith('/chapter/')) res.end(`<div id="content"><p>${path.endsWith('two') ? '夜色里亮起一盏灯。' : '河水缓慢流过石桥。'}</p><p>这是原创测试段落。</p><script>window.PWNED=true</script><img src="http://127.0.0.1/private" onerror="window.PWNED=true"><p>&lt;img onerror=alert(1)&gt;</p></div>`);
    else { res.statusCode = 404; res.end('Missing fixture'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture failed');
  const client = new SafeHttpClient({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    // EXPLICIT TEST-ONLY CONNECTION EXCEPTION. Production still validates and
    // pins public DNS. This transport connects solely to this controlled server.
    transport: (url, config, response) => {
      options.push(config);
      return request({ ...config, hostname: '127.0.0.1', port: address.port, path: url.pathname + url.search, protocol: 'http:', headers: { ...config.headers, Host: url.host } }, response);
    },
  });
  return { client, requests, options, insertChapter: () => { inserted = true; }, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
