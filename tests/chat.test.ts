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
  holdStart?: Promise<void>;
  holdClose?: Promise<void>;
  closed = false;
  threadId = 'test-thread';
  modelPages:Record<string,any>={start:{data:[{model:'model-default',displayName:'Default model',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'high'}]},{model:'model-fast',displayName:'Fast model',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null}};
  async request(method: string, params: any = {}) {
    if (this.closed) throw Error('Codex 连接已关闭');
    this.requests.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt' } };
    if (method === 'config/read') return { config: { model:'model-default',model_reasoning_effort:'high',mcp_servers: { existing: { command: 'unused' } }, plugins: { existing: {} } } };
    if (method === 'model/list') return this.modelPages[params.cursor??'start'];
    if (method === 'thread/start') { await this.holdStart; if (this.closed) throw Error('Codex 连接已关闭'); return { thread: { id: this.threadId } }; }
    if (method === 'thread/resume') { this.threadId = params.threadId; return { thread: { id: this.threadId } }; }
    if (method === 'turn/start') { await this.holdTurn; if (this.closed) throw Error('Codex 连接已关闭'); return { turn: { id: 'test-turn' } }; }
    return {};
  }
  onEvent(listener: (method: string, params: any) => void) { this.listener = listener; return () => { this.listener = undefined; }; }
  emit(method: string, params: any = {}) { this.listener?.(method, { threadId: this.threadId, ...params }); }
  tool(tool: string, args: unknown) { return this.onRequest!('item/tool/call', { threadId: this.threadId, callId: randomUUID(), tool, arguments: args }); }
  async close() { await this.holdClose; this.closed = true; }
}
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'Reader chat '));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const reader = new ReaderService(new ReaderStore(dir)), transport = new Transport(), transports: Transport[] = [];
  const chat = new ChatService(reader.workspace, () => { const next = transports.length ? new Transport() : transport; next.threadId = transports.length ? 'thread-' + transports.length : 'test-thread'; transports.push(next); return next; });
  cleanup.push(() => chat.close()); cleanup.push(() => reader.close());
  const book = await reader.store.importBook('原创.txt', Buffer.from('第一章 验证\n\n只在授权后读取的完整段落。'));
  const paragraph = book.document.chapters[0]!.paragraphs.findIndex(p => p.includes('只在授权'));
  const quote = book.document.chapters[0]!.paragraphs[paragraph]!;
  const source = await reader.workspace.createSource({ bookId: book.summary.id, quote, anchor: { kind: 'text', start: { chapter: 0, paragraph, offset: 0 }, end: { chapter: 0, paragraph, offset: quote.length } } });
  return { reader, transport, transports, chat, book, source };
}
async function started(transport: Transport, count = 1) { await expect.poll(() => transport.requests.filter(r => r.method === 'turn/start').length).toBe(count); }

describe('documented Codex transport and reading scope', () => {
  it('allows the current book by default, including old restricted drafts, without widening to other books',async()=>{
    const {reader,transport,chat,book}=await setup();
    const session=await chat.create(book.summary.id);expect(session.allowBook).toBe(true);
    await chat.draft(session.id,'旧草稿',[],false);
    await chat.send({id:session.id,messageId:randomUUID(),text:'总结本章',sourceIds:[]});await started(transport);
    expect(await transport.tool('reader_read_passage',{id:book.summary.id})).toMatchObject({success:true});
    const other=await reader.store.importBook('另一本.txt',Buffer.from('第一章 其他\n\n不属于当前对话的正文。'));
    await expect(transport.tool('reader_read_passage',{id:other.summary.id})).rejects.toThrow();
    expect((await chat.get(session.id)).allowBook).toBe(true);
  });

  it('paginates the real catalog, omits hidden entries and closes the discovery connection',async()=>{
    const {transport,chat}=await setup();
    transport.modelPages.start.nextCursor='next';
    transport.modelPages.next={data:[{model:'hidden-model',displayName:'Hidden',hidden:true},{model:'model-extra',displayName:'Extra',inputModalities:['text'],supportedReasoningEfforts:[]}],nextCursor:null};
    const catalog=await chat.models();
    expect(catalog.models.map(model=>model.id)).toEqual(['model-default','model-fast','model-extra']);
    expect(catalog.defaultModel).toBe('model-default');expect(transport.closed).toBe(true);
    expect(transport.requests.filter(r=>r.method==='model/list').map(r=>r.params.cursor)).toEqual([undefined,'next']);
  });

  it('persists a model choice and applies it to new and resumed turns, including returning to the configured default',async()=>{
    const {reader,transport,transports,chat}=await setup(),session=await chat.create();
    await chat.draft(session.id,'问题',[],undefined,'model-fast');
    const restored=new ChatService(reader.workspace,()=>new Transport());cleanup.push(()=>restored.close());
    expect((await restored.get(session.id)).model).toBe('model-fast');
    await chat.send({id:session.id,messageId:randomUUID(),text:'解释',sourceIds:[]});await started(transport);
    expect(transport.requests.find(r=>r.method==='thread/start')?.params.model).toBe('model-fast');
    expect(transport.requests.find(r=>r.method==='turn/start')?.params).toMatchObject({model:'model-fast',effort:'low'});
    await expect(chat.draft(session.id,'不应覆盖',[],undefined,'model-default')).rejects.toThrow('回复结束');
    expect((await chat.get(session.id)).model).toBe('model-fast');
    transport.emit('turn/completed',{turn:{status:'completed'}});await expect.poll(async()=>(await chat.get(session.id)).status).toBe('idle');
    await chat.draft(session.id,'追问',[],undefined,null);
    await chat.send({id:session.id,messageId:randomUUID(),text:'继续',sourceIds:[]});await started(transports[1]!);
    expect(transports[1]!.requests.find(r=>r.method==='thread/resume')?.params.model).toBe('model-default');
    expect(transports[1]!.requests.find(r=>r.method==='turn/start')?.params).toMatchObject({model:'model-default',effort:'high'});
  });
  it('enforces the current turn scope even when full-book access was granted elsewhere', async () => {
    const { reader, transport, transports, chat, book, source } = await setup();
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
    expect(transport.closed).toBe(true);
    await chat.send({ id: session.id, messageId: randomUUID(), text: '现在读取本书', sourceIds: [], allowBook: true }); const resumed = transports[1]!; await started(resumed);
    expect(await resumed.tool('reader_read_passage', { id: book.summary.id })).toMatchObject({ success: true });
    expect(resumed.requests.find(r => r.method === 'thread/resume')?.params.threadId).toBe('test-thread');
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
    expect((await chat.get(session.id)).error).toContain('尚未保存'); expect(transport.closed).toBe(true); write.mockRestore();
    await chat.draft(session.id, '下一次追问', [source.id], false);
    const reopened = new ChatService(reader.workspace, () => new Transport()); cleanup.push(() => reopened.close());
    expect((await reopened.get(session.id)).messages.at(-1)).toMatchObject({ text: '主动回忆。', sourceIds: [source.id] });
    expect((await reopened.get(session.id)).draft).toBe('下一次追问');
  });

  it('releases the owner even when cancellation precedes the turn/start response', async () => {
    const { transport, chat } = await setup();
    let release!: () => void; transport.holdTurn = new Promise<void>(resolve => { release = resolve; });
    const session = await chat.create();
    await chat.send({ id: session.id, messageId: randomUUID(), text: '短问题', sourceIds: [] }); await started(transport);
    await chat.stop(session.id); release();
    expect(transport.closed).toBe(true);
    expect((await chat.get(session.id)).status).toBe('interrupted');
  });

  it('waits for ownership release before reporting idle or allowing a follow-up', async () => {
    const { reader, transport, chat } = await setup();
    const observer = new ChatService(reader.workspace, () => new Transport()); cleanup.push(() => observer.close());
    const session = await chat.create();
    await chat.send({ id: session.id, messageId: randomUUID(), text: '解释', sourceIds: [] }); await started(transport);
    let release!: () => void; transport.holdClose = new Promise<void>(resolve => { release = resolve; });
    transport.emit('turn/completed', { turn: { status: 'completed' } });
    try {
      await expect.poll(() => transport.listener).toBeUndefined();
      expect((await chat.get(session.id)).status).toBe('running');
      await chat.draft(session.id, '释放完成后追问');
      expect((await observer.get(session.id)).status).toBe('running');
      await expect(observer.send({ id: session.id, messageId: randomUUID(), text: '另一个窗口', sourceIds: [] })).rejects.toThrow('另一个 Reader 窗口');
      await expect(chat.send({ id: session.id, messageId: randomUUID(), text: '追问', sourceIds: [] })).rejects.toThrow('正在回复');
    } finally { release(); }
    await expect.poll(async () => (await chat.get(session.id)).status).toBe('idle');
    expect(transport.closed).toBe(true);
  });

  it('cancels a pending thread/start without leaving an owner or starting a turn', async () => {
    const { transport, chat } = await setup();
    let release!: () => void; transport.holdStart = new Promise<void>(resolve => { release = resolve; });
    const session = await chat.create();
    await chat.send({ id: session.id, messageId: randomUUID(), text: '解释', sourceIds: [] });
    await expect.poll(() => transport.requests.some(r => r.method === 'thread/start')).toBe(true);
    await chat.stop(session.id); release();
    expect(transport.closed).toBe(true);
    expect(transport.requests.some(r => r.method === 'turn/start')).toBe(false);
    expect((await chat.get(session.id)).status).toBe('interrupted');
  });

  it('releases a completed topic without interrupting another active topic', async () => {
    const { transport, transports, chat } = await setup();
    const first = await chat.create(), second = await chat.create();
    await chat.send({ id: first.id, messageId: randomUUID(), text: '第一个话题', sourceIds: [] }); await started(transport);
    await chat.send({ id: second.id, messageId: randomUUID(), text: '第二个话题', sourceIds: [] });
    const other = transports[1]!; await started(other);
    transport.emit('turn/completed', { turn: { status: 'completed' } });
    await expect.poll(async () => (await chat.get(first.id)).status).toBe('idle');
    expect(transport.closed).toBe(true); expect(other.closed).toBe(false);
    expect((await chat.get(second.id)).status).toBe('running');
    other.emit('item/agentMessage/delta', { itemId: 'other-answer', delta: '继续回答。' });
    await expect.poll(async () => (await chat.get(second.id)).messages.at(-1)?.text).toBe('继续回答。');
    await chat.stop(second.id);
    expect(other.requests.some(r => r.method === 'turn/interrupt')).toBe(true);
    expect(other.closed).toBe(true);
  });

  it.each(['error', 'reader/disconnected'])('releases the owner on %s', async method => {
    const { transport, chat } = await setup();
    const session = await chat.create();
    await chat.send({ id: session.id, messageId: randomUUID(), text: '解释', sourceIds: [] }); await started(transport);
    transport.emit(method, { error: { message: '连接失败' }, message: '连接失败', willRetry: false });
    await expect.poll(async () => (await chat.get(session.id)).status).toBe('error');
    expect(transport.closed).toBe(true);
    expect((await chat.get(session.id)).messages[0]?.text).toBe('解释');
  });

  it('does not retain a process for status checks and shuts down all active topics', async () => {
    const { transport, transports, chat } = await setup();
    expect((await chat.status()).authenticated).toBe(true); expect(transport.closed).toBe(true);
    const first = await chat.create(), second = await chat.create();
    await chat.send({ id: first.id, messageId: randomUUID(), text: '第一个话题', sourceIds: [] }); await started(transports[1]!);
    await chat.send({ id: second.id, messageId: randomUUID(), text: '第二个话题', sourceIds: [] }); await started(transports[2]!);
    await chat.close();
    expect(transports.every(client => client.closed)).toBe(true);
    await expect(chat.send({ id: first.id, messageId: randomUUID(), text: '关闭后不再启动', sourceIds: [] })).rejects.toThrow('正在关闭');
  });
});
