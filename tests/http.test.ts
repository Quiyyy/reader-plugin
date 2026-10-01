import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type Server } from 'node:http';
import { ReaderStore } from '../src/server/store.js';
import { ReaderService } from '../src/server/service.js';
import { createReaderHttpServer } from '../src/server/http.js';
let server: Server; let dir: string;
afterEach(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (dir) await rm(dir, { recursive: true, force: true }); });
async function start() { dir = await mkdtemp(join(tmpdir(), 'reader-http-')); const html = join(dir, 'index.html'); await writeFile(html, '<html>Reader</html>'); server = createReaderHttpServer(new ReaderService(new ReaderStore(join(dir, 'data'))), html); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address() as { port: number }; return `http://127.0.0.1:${address.port}`; }
describe('loopback HTTP defenses', () => {
  it('rejects cross-origin, unexpected hosts, plain forms and oversized bodies', async () => {
    const base = await start();
    expect((await fetch(base, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    const invalidHost = await new Promise<number | undefined>(resolve => { const req = request(base, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.end(); });
    expect(invalidHost).toBe(403);
    expect((await fetch(base + '/api/tool', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await fetch(base + '/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(base + '/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Client': 'preview' }, body: 'x'.repeat(1024 * 1024 + 1) })).status).toBe(400);
    const result = await fetch(base + '/api/tool', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Client': 'preview' }, body: JSON.stringify({ name: 'reader_list', arguments: {} }) });
    expect(result.status).toBe(200); expect((await result.json())._meta.reader.books).toEqual([]);
    const page = await fetch(base); expect(page.headers.get('content-security-policy')).toContain("frame-src 'none'"); expect(page.headers.get('access-control-allow-origin')).toBeNull();
  });
});
