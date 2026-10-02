import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import type { ReaderService } from './service.js';
const MAX_BODY = 1024 * 1024;
function json(response: ServerResponse, code: number, value: unknown) { response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); }
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY) throw new Error('请求过大');
  for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw new Error('请求过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createReaderHttpServer(service: ReaderService, htmlPath: string) {
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    const address = server.address();
    const port = address && typeof address !== 'string' ? address.port : 0;
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const host = request.headers.host ?? '';
    const origin = request.headers.origin;
    if (!allowedHosts.has(host) || (origin && origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') { json(response, 403, { error: '仅允许本机同源访问' }); return; }
    try {
      const pathname = new URL(request.url ?? '/', `http://${host}`).pathname;
      if (request.method === 'GET' && pathname === '/') {
        response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(await readFile(htmlPath)); return;
      }
      if (request.method === 'GET' && pathname === '/health') { json(response, 200, { status: 'ok', mode: 'loopback-preview', version: '0.1.3' }); return; }
      if (request.method === 'POST' && (pathname === '/api/tool' || pathname === '/mcp')) {
        if (!request.headers['content-type']?.startsWith('application/json')) { json(response, 415, { error: '需要 application/json' }); return; }
        const body = await readBody(request);
        if (pathname === '/api/tool') {
          if (request.headers['x-reader-client'] !== 'preview') { json(response, 403, { error: '缺少 Reader 客户端标识' }); return; }
          if (!body || typeof body !== 'object' || !('name' in body) || typeof body.name !== 'string' || !('arguments' in body)) throw new Error('无效请求');
          const data = await service.call(body.name, body.arguments);
          json(response, 200, { content: [], _meta: { reader: data } }); return;
        }
        const mcp = createMcpServer(service, htmlPath);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        response.on('close', () => { void transport.close(); void mcp.close(); });
        await mcp.connect(transport);
        await transport.handleRequest(request, response, body); return;
      }
      json(response, 404, { error: '未找到资源' });
    } catch (error) {
      if (!response.headersSent) json(response, 400, { error: error instanceof Error ? error.message : 'Reader 操作失败' });
      else response.end();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
