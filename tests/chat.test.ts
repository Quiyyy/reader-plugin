import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatService } from '../src/server/chat-service.js';
import type { CodexTransport } from '../src/server/codex-client.js';
import { ReaderService } from '../src/server/service.js';
import { ReaderStore } from '../src/server/store.js';

class Transport implements CodexTransport {
  requests: { method: string; params: any }[] = [];
  listener?: (method: string, params: any) => void;
  onRequest?: (method: string, params: any) => Promise<any>;
  holdTurn?: Promise<void>;
  async request(method: string, params: any = {}) {
    this.requests.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'config/read') return { config: { mcp_servers: { existing: { command: 'unused' } }, plugins: { existing: {} } } };
    if (method === 'thread/start') return { thread: { id: 'test-thread' } };
    if (method === 'turn/start') { await this.holdTurn; return { turn: { id: 'test-turn' } }; }
    return {};
  }
  onEvent(listener: (method: string, params: any) => void) { this.listener = listener; return () => { this.listener = undefined; }; }
  emit(method: string, params: any = {}) { this.listener?.(method, { threadId: 'test-thread', ...params }); }
  tool(tool: string, args: unknown) { return this.onRequest!('item/tool/call', { threadId: 'test-thread', callId: randomUUID(), tool, arguments: args }); }
  close() {}
}
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'Reader chat '));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const reader = new ReaderService(new ReaderStore(dir)), transport = new Transport(), chat = new ChatService(reader.workspace, transport);
  cleanup.push(() => chat.close()); cleanup.push(() => reader.close());
  const book = await reader.store.importBook('原创.txt', Buffer.from('第一章 验证\n\n只在授权后读取的完整段落。'));
  const paragraph = book.document.chapters[0]!.paragraphs.findIndex(p => p.includes('只在授权'));
  const quote = book.document.chapters[0]!.paragraphs[paragraph]!;
  const source = await reader.workspace.createSource({ bookId: book.summary.id, quote, anchor: { kind: 'text', start: { chapter: 0, paragraph, offset: 0 }, end: { chapter: 0, paragraph, offset: quote.length } } });
  return { reader, transport, chat, book, source };
}
async function started(transport: Transport, count = 1) { await expect.poll(() => transport.requests.filter(r => r.method === 'turn/start').length).toBe(count); }

describe('documented Codex transport and reading scope', () => {
  it('enforces the current turn scope even when full-book access was granted elsewhere', async () => {
    const { reader, transport, chat, book, source } = await setup();
    await reader.workspace.store.allowBook(book.summary.id, true);
    const session = await chat.create(book.summary.id);
    await chat.send({ id: session.id, messageId: randomUUID(), text: '解释选区', sourceIds: [source.id], allowBook: false }); await started(transport);
    expect(await transport.tool('reader_source_get', { id: source.id })).toMatchObject({ success: true });
    await expect(transport.tool('reader_read_passage', { id: book.summary.id })).rejects.toThrow('仅允许所选');
    await expect(transport.tool('reader_book_toc', { id: book.summary.id })).rejects.toThrow('启用本书');
    const hits = await transport.tool('reader_study_search', { query: '授权后读取' });
    expect(JSON.parse(hits.contentItems[0].text)).toEqual([]);
    const options = transport.requests.find(r => r.method === 'thread/start')!.params;
    expect(options.config.mcp_servers.existing).toMatchObject({ enabled: false });
    expect(options.sandbox).toBe('read-only');
    transport.emit('turn/completed', { turn: { status: 'completed' } });
    await expect.poll(async () => (await chat.get(session.id)).status).toBe('idle');
    await chat.send({ id: session.id, messageId: randomUUID(), text: '现在读取本书', sourceIds: [], allowBook: true }); await started(transport, 2);
    expect(await transport.tool('reader_read_passage', { id: book.summary.id })).toMatchObject({ success: true });
    expect(transport.requests.some(r => r.method === 'thread/resume')).toBe(true);
  });

  it('persists streamed replies and sources, and retries an unsaved completion without hanging', async () => {
    const { reader, transport, chat, source } = await setup();
    const session = await chat.create();
    await chat.send({ id: session.id, messageId: randomUUID(), text: '解释', sourceIds: [source.id] }); await started(transport);
    transport.emit('item/agentMessage/delta', { itemId: 'answer', delta: '主动回忆。' });
    await expect.poll(async () => (await chat.get(session.id)).messages.at(-1)?.text).toBe('主动回忆。');
    const write = vi.spyOn(chat as any, 'write').mockRejectedValueOnce(Error('disk full'));
    transport.emit('turn/completed', { turn: { status: 'completed' } });
    await expect.poll(async () => (await chat.get(session.id)).status).toBe('error');
    expect((await chat.get(session.id)).error).toContain('尚未保存'); write.mockRestore();
    await chat.draft(session.id, '下一次追问', [source.id], false);
    const reopened = new ChatService(reader.workspace, new Transport()); cleanup.push(() => reopened.close());
    expect((await reopened.get(session.id)).messages.at(-1)).toMatchObject({ text: '主动回忆。', sourceIds: [source.id] });
    expect((await reopened.get(session.id)).draft).toBe('下一次追问');
  });

  it('interrupts a turn even when cancellation precedes the turn/start response', async () => {
    const { transport, chat } = await setup();
    let release!: () => void; transport.holdTurn = new Promise<void>(resolve => { release = resolve; });
    const session = await chat.create();
    await chat.send({ id: session.id, messageId: randomUUID(), text: '短问题', sourceIds: [] }); await started(transport);
    await chat.stop(session.id); release();
    await expect.poll(() => transport.requests.some(r => r.method === 'turn/interrupt')).toBe(true);
    expect((await chat.get(session.id)).status).toBe('interrupted');
  });
});
