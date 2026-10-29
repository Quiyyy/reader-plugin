import {agentTools} from '../src/server/workspace-service.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
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
  it('preserves raw compatible uploads through cancel, retry, duplicate finish and restart', async () => {
    const { service, dir } = await setup();
    const bytes = Buffer.from('第一章 原创\n\n正文保持不变。\n\x03\x03\x03\n第二段正文。\x1a');
    const begin = () => service.call('reader_import_begin', { filename: 'compatibility.txt', size: bytes.length }) as Promise<any>;
    const cancelled = await begin();
    await service.call('reader_import_chunk', { uploadId: cancelled.uploadId, index: 0, data: bytes.toString('base64') });
    await service.call('reader_import_cancel', { uploadId: cancelled.uploadId });
    await expect(service.call('reader_import_finish', { uploadId: cancelled.uploadId })).rejects.toThrow('过期');
    const upload = async () => { const { uploadId } = await begin(); await service.call('reader_import_chunk', { uploadId, index: 0, data: bytes.toString('base64') }); return { uploadId, book: await service.call('reader_import_finish', { uploadId }) as any }; };
    const { uploadId, book } = await upload();
    expect(book.document.textCompatibility).toMatchObject({ paddingCharacters: 3, paddingLines: 1, terminalEof: 1 });
    await service.store.saveProgress(book.summary.id, { chapter: 0, paragraph: 2 });
    await service.store.addBookmark(book.summary.id, { chapter: 0, paragraph: 2 }, '保留');
    await expect(service.call('reader_import_finish', { uploadId })).rejects.toThrow('过期');
    const duplicate = (await upload()).book;
    expect(duplicate.summary.locator).toEqual({ chapter: 0, paragraph: 2 });
    expect(duplicate.bookmarks).toHaveLength(1);
    expect((await service.call('reader_list', {}) as any).books).toHaveLength(1);
    expect(await readFile(join(dir, 'books', book.summary.id, 'source.txt'))).toEqual(bytes);
    expect((await new ReaderStore(dir).open(book.summary.id)).document).toEqual(book.document);
  });
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
  it('serves current UI to cached older entrypoints after a server upgrade', async () => {
    const { service, dir } = await setup(), html = join(dir, 'ui.html');
    const currentHtml = '<!doctype html><title>Current Reader UI</title>';
    await writeFile(html, currentHtml);
    const server = createMcpServer(service, html), client = new Client({ name: 'cached-entrypoint-host', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
    try {
      const canonical = await client.readResource({ uri: UI_URI });
      for (const version of ['0.1.3', '0.2.8', '0.2.9']) {
        const uri = `ui://reader/v${version}/bookshelf.html`;
        const result = await client.readResource({ uri });
        expect(result.contents).toEqual([{ ...canonical.contents[0], uri }]);
        expect('text' in result.contents[0]! && result.contents[0].text).toBe(currentHtml);
      }
      expect((await client.listResources()).resources.map(resource => resource.uri)).toEqual([UI_URI]);
      const open = (await client.listTools()).tools.find(tool => tool.name === 'reader_open')!;
      expect((open._meta?.ui as any).resourceUri).toBe(UI_URI);
      for (const uri of ['ui://reader/v0.99.0/bookshelf.html', 'ui://reader/v1.0.0/bookshelf.html', 'ui://reader/v0.2.8-preview/bookshelf.html', 'ui://reader/v00.2.8/bookshelf.html', 'ui://reader/v0.2.8/other.html', 'ui://other/v0.2.8/bookshelf.html']) {
        await expect(client.readResource({ uri })).rejects.toThrow(/not found/i);
      }
    } finally { await client.close(); await server.close(); }
  });
  it('publishes native entrypoints, restrictive CSP, app-only tools, and serves HTML', async () => {
    const { service, dir } = await setup(); const html = join(dir, 'ui.html'); await writeFile(html, '<!doctype html><title>Reader test</title>');
    const server = createMcpServer(service, html); const client = new Client({ name: 'reader-test-host', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
    try {
      const { tools } = await client.listTools(); const open = tools.find(tool => tool.name === 'reader_open')!; const file = tools.find(tool => tool.name === 'reader_open_file')!;
      expect((open._meta?.['openai/ui'] as any).entrypoints).toEqual([{ type: 'global' }, { type: 'thread' }]);
      expect((file._meta?.['openai/ui'] as any).entrypoints[0].extensions).toEqual(['.txt', '.epub', '.pdf']);
      for (const tool of tools) expect((tool._meta?.ui as any).visibility).toEqual(['app']);
      const resource = await client.readResource({ uri: UI_URI });
      expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app');
      expect((resource.contents[0]._meta?.ui as any).csp.connectDomains).toEqual([]);
      expect('text' in resource.contents[0] && resource.contents[0].text).toContain('Reader test');
      const result = await client.callTool({ name: 'reader_list', arguments: {} });
      expect(result.content).toEqual([]); expect((result._meta?.reader as any).books).toEqual([]);
      expect(result.structuredContent).toBeUndefined();
      const folder = await client.callTool({ name:'reader_folder_save', arguments:{name:'协议测试',parentId:null} });
      const folders = await client.callTool({ name:'reader_folder_list', arguments:{} });
      expect((folders._meta?.reader as any)[0].id).toBe((folder._meta?.reader as any).value.id);expect(folders.structuredContent).toBeUndefined();
      const book=await service.store.importBook('协议原创.txt',Buffer.from('第一章 协议\n\n这段原文应保持读取范围。'));
      const denied=await client.callTool({name:'reader_read_passage',arguments:{id:book.summary.id}});expect(denied.isError).toBe(true);
      const quote=book.document.chapters[0]!.paragraphs[0]!;
      const image=await service.workspace.store.putImage('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=');
      const source=await service.workspace.createSource({bookId:book.summary.id,quote,imageId:image.id,anchor:{kind:'text',start:{chapter:0,paragraph:0,offset:0},end:{chapter:0,paragraph:0,offset:quote.length}}});
      const selected=await client.callTool({name:'reader_source_get',arguments:{id:source.id}});
      expect(selected.isError).not.toBe(true);expect(selected.content).toEqual([]);expect(selected.structuredContent).toBeUndefined();expect((selected._meta?.reader as any).quote).toBe(quote);expect((selected._meta?.reader as any).imageId).toBe(image.id);
    } finally { await client.close(); await server.close(); }
  });
});
