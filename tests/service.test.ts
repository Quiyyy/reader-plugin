import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderStore } from '../src/server/store.js';
import { ReaderService } from '../src/server/service.js';
import { createMcpServer, UI_URI } from '../src/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'reader-service-')); directories.push(dir); return { dir, service: new ReaderService(new ReaderStore(dir)) }; }
describe('upload service', () => {
  it('chunks and finalizes without exposing filesystem paths', async () => {
    const { service } = await setup(); const data = Buffer.from('第一章 开始\n\n这是一段原创的测试文字。\n\n第二章 继续\n\n书页仍然安静。');
    const { uploadId } = await service.call('reader_import_begin', { filename: '测试.txt', size: data.length }) as any;
    await expect(service.call('reader_import_chunk', { uploadId, index: 1, data: data.toString('base64') })).rejects.toThrow('顺序');
    await service.call('reader_import_chunk', { uploadId, index: 0, data: data.toString('base64') });
    const book = await service.call('reader_import_finish', { uploadId }) as any;
    expect(book.document.chapters.length).toBe(2);
    expect((await service.call('reader_list', {}) as any).books).toHaveLength(1);
    await expect(service.call('reader_import_finish', { uploadId })).rejects.toThrow('过期');
    await expect(service.call('reader_get', { id: '../../secrets' })).rejects.toThrow();
  });
  it('bounds file, chunks, upload concurrency and incomplete content', async () => {
    const { service } = await setup();
    await expect(service.call('reader_import_begin', { filename: 'bad.txt', size: 33 * 1024 * 1024 })).rejects.toThrow();
    await expect(service.call('reader_import_begin', { filename: 'bad.mobi', size: 1 })).rejects.toThrow('TXT');
    const a = await service.call('reader_import_begin', { filename: 'a.txt', size: 4 }) as any;
    await service.call('reader_import_begin', { filename: 'b.txt', size: 4 });
    await expect(service.call('reader_import_begin', { filename: 'c.txt', size: 4 })).rejects.toThrow('过多');
    await expect(service.call('reader_import_chunk', { uploadId: a.uploadId, index: 0, data: '%%%=' })).rejects.toThrow();
    await expect(service.call('reader_import_finish', { uploadId: a.uploadId })).rejects.toThrow('不完整');
  });
});
describe('real MCP server SDK integration', () => {
  it('publishes native entrypoints, restrictive CSP, app-only tools, and serves HTML', async () => {
    const { service, dir } = await setup(); const html = join(dir, 'ui.html'); await writeFile(html, '<!doctype html><title>Reader test</title>');
    const server = createMcpServer(service, html); const client = new Client({ name: 'reader-test-host', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
    try {
      const { tools } = await client.listTools(); const open = tools.find(tool => tool.name === 'reader_open')!; const file = tools.find(tool => tool.name === 'reader_open_file')!;
      expect((open._meta?.['openai/ui'] as any).entrypoints).toEqual([{ type: 'global' }, { type: 'thread' }]);
      expect((file._meta?.['openai/ui'] as any).entrypoints[0].extensions).toEqual(['.txt', '.epub']);
      for (const tool of tools.filter(tool => !['reader_open'].includes(tool.name))) expect((tool._meta?.ui as any).visibility).toEqual(['app']);
      const resource = await client.readResource({ uri: UI_URI });
      expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app');
      expect((resource.contents[0]._meta?.ui as any).csp.connectDomains).toEqual([]);
      expect('text' in resource.contents[0] && resource.contents[0].text).toContain('Reader test');
      const result = await client.callTool({ name: 'reader_list', arguments: {} });
      expect(result.content).toEqual([]); expect((result._meta?.reader as any).books).toEqual([]);
      expect(result.structuredContent).toBeUndefined();
    } finally { await client.close(); await server.close(); }
  });
});
