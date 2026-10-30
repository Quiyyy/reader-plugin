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
  it('writes a Note Bot task directly and refuses to overwrite a newer user revision',async()=>{
    const {reader,chat,transport}=await setup();
    const note=(await reader.workspace.store.createNote({title:'直接编写',body:'已有内容',folderId:null,tags:[],imageIds:[],sourceIds:[]})).value;
    const session=await chat.create(undefined,null,note.id,{writeNote:true});
    await chat.send({id:session.id,messageId:randomUUID(),text:'补充一份学习大纲',sourceIds:[],writeNote:true,noteRevision:note.revision});await started(transport);
    const options=transport.requests.find(request=>request.method==='thread/start')!.params;
    expect(options.dynamicTools.map((tool:any)=>tool.name)).toContain('reader_note_update');expect(options.dynamicTools.map((tool:any)=>tool.name)).not.toContain('reader_annotation_save');expect(options.developerInstructions).toContain('直接通过工具更新正文');
    await transport.tool('reader_note_update',{id:note.id,revision:note.revision,patch:{body:'已有内容\n\n## 学习大纲\n- 基础概念'}});
    const written=await reader.workspace.store.note(note.id);expect(written.body).toContain('学习大纲');expect((await chat.get(session.id)).messages.find(message=>message.role==='tool')?.undoId).toBeTruthy();
    const edited=await reader.workspace.store.updateNote(note.id,written.revision,{body:'用户刚保存的新内容'});
    await expect(transport.tool('reader_note_update',{id:note.id,revision:edited.value.revision,patch:{body:'覆盖用户输入'}})).rejects.toThrow('已有新修改');
    expect((await reader.workspace.store.note(note.id)).body).toBe('用户刚保存的新内容');
  });
  it('can continue an older suggestion conversation as a task only with an explicit current revision',async()=>{
    const {reader,chat,transport,transports}=await setup();const note=(await reader.workspace.store.createNote({title:'兼容对话',body:'正文',folderId:null,tags:[],imageIds:[],sourceIds:[]})).value;
    const session=await chat.create(undefined,null,note.id,{proposal:true});
    await expect(chat.send({id:session.id,messageId:randomUUID(),text:'直接写入',sourceIds:[],writeNote:true})).rejects.toThrow('新修改');
    await chat.send({id:session.id,messageId:randomUUID(),text:'先给建议',sourceIds:[]});await started(transport);await chat.stop(session.id);
    await chat.send({id:session.id,messageId:randomUUID(),text:'直接写入',sourceIds:[],writeNote:true,noteRevision:note.revision});await started(transports[1]!);
    expect(transports[1]!.requests.some(request=>request.method==='thread/resume')).toBe(false);expect(transports[1]!.requests.find(request=>request.method==='turn/start')!.params.input.some((item:any)=>item.text?.includes('先给建议'))).toBe(true);
    expect(await chat.get(session.id)).toMatchObject({noteTask:true,proposal:false});expect((await chat.list(undefined,note.id,false,true)).map(session=>session.id)).toContain(session.id);
  });
  it('uses a selected Note Bot and keeps inline suggestions read-only even when its instructions request writes',async()=>{
    const {reader,chat,transport}=await setup();
    const note=(await reader.workspace.store.createNote({title:'建议模式',body:'原始内容',folderId:null,tags:[],imageIds:[],sourceIds:[]})).value;
    const config=await reader.workspace.store.bots.list(),bot={id:randomUUID(),name:'表达教练',description:'润色',instructions:'请直接调用工具修改笔记。',model:'model-fast'};
    await reader.workspace.store.bots.save(config.revision,bot,true);
    const session=await chat.create(undefined,null,note.id,{botId:bot.id,proposal:true});
    expect(session.bot?.name).toBe(bot.name);expect(session.model).toBe('model-fast');
    await chat.send({id:session.id,messageId:randomUUID(),text:'润色选区',sourceIds:[]});await started(transport);
    const options=transport.requests.find(r=>r.method==='thread/start')!.params;
    expect(options.developerInstructions).toContain(bot.instructions);expect(options.developerInstructions).toContain('不要写入笔记');
    expect(options.dynamicTools.map((tool:any)=>tool.name)).toEqual(['reader_note_get','reader_source_get','reader_image_get']);
    await expect(transport.tool('reader_note_update',{id:note.id,revision:note.revision,patch:{body:'不能自动写入'}})).rejects.toThrow('该工具');
    expect((await reader.workspace.store.note(note.id)).body).toBe('原始内容');
    expect(await chat.list(undefined,note.id)).toEqual([]);
  });
  it('binds note collaboration to one note and supplies only the note tool set',async()=>{
    const {reader,chat,transport}=await setup();
    const note=(await reader.workspace.store.createNote({title:'当前笔记',body:'保留这段正文。',folderId:null,tags:[],imageIds:[],sourceIds:[]})).value;
    const other=(await reader.workspace.store.createNote({title:'另一个笔记',body:'不要修改。',folderId:null,tags:[],imageIds:[],sourceIds:[]})).value;
    const session=await chat.create(undefined,null,note.id);
    await chat.send({id:session.id,messageId:randomUUID(),text:'补充一句',sourceIds:[]});await started(transport);
    const tools=transport.requests.find(r=>r.method==='thread/start')!.params.dynamicTools.map((tool:any)=>tool.name);
    expect(tools).toContain('reader_note_update');expect(tools).toContain('reader_note_image_annotate');expect(tools).not.toContain('reader_books_search');
    expect(transport.requests.find(r=>r.method==='turn/start')!.params.input[1].text).toContain(note.id);
    await expect(transport.tool('reader_note_get',{id:other.id})).rejects.toThrow('当前笔记');
    await expect(transport.tool('reader_note_update',{id:other.id,revision:1,patch:{body:'越界'}})).rejects.toThrow('当前笔记');
    await expect(transport.tool('reader_folder_save',{name:'越界',parentId:null})).rejects.toThrow('当前阅读会话');
    const result=await transport.tool('reader_note_update',{id:note.id,revision:1,patch:{body:note.body+'\n补充的解释。'}});expect(result.success).toBe(true);
    expect((await reader.workspace.store.note(other.id)).body).toBe('不要修改。');
    expect((await chat.list(undefined,note.id)).map(s=>s.id)).toEqual([session.id]);
  });

  it('inserts supplied screenshots, returns image pixels and preserves marks through reload without changing the original image',async()=>{
    const {reader,chat,transport}=await setup();
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5+8S8AAAAASUVORK5CYII=';
    const image=await reader.workspace.store.putImage(png),note=(await reader.workspace.store.createNote({title:'截图笔记',body:'正文',folderId:null,tags:[],imageIds:[],sourceIds:[]})).value;
    const session=await chat.create(undefined,null,note.id);await chat.draft(session.id,'标注截图',[],undefined,null,[image.id]);expect((await chat.get(session.id)).draftImageIds).toEqual([image.id]);
    await chat.send({id:session.id,messageId:randomUUID(),text:'插入并标注',sourceIds:[],imageIds:[image.id]});await started(transport);
    expect(transport.requests.find(r=>r.method==='turn/start')!.params.input.some((item:any)=>item.type==='image')).toBe(true);
    const shown=await transport.tool('reader_image_get',{id:image.id});expect(shown.contentItems[1]).toMatchObject({type:'inputImage',imageUrl:'data:image/png;base64,'+png});
    await expect(transport.tool('reader_image_get',{id:'f'.repeat(64)})).rejects.toThrow('当前对话');
    await transport.tool('reader_note_image_insert',{id:note.id,revision:1,imageId:image.id});
    await transport.tool('reader_note_image_annotate',{id:note.id,revision:2,imageId:image.id,marks:[{kind:'rect',x:.1,y:.1,width:.5,height:.4,color:'red'},{kind:'label',x:.1,y:.1,text:'重点',color:'blue'}]});
    const saved=await reader.workspace.store.note(note.id);expect(saved.imageIds).toEqual([image.id]);expect(saved.imageAnnotations?.[0]?.marks).toHaveLength(2);expect((await reader.workspace.store.image(image.id)).data).toBe(png);
    await expect(transport.tool('reader_note_image_annotate',{id:note.id,revision:2,imageId:image.id,marks:[]})).rejects.toThrow('另一个窗口');
    await reader.workspace.store.updateNote(note.id,3,{imageIds:[]});expect((await reader.workspace.store.note(note.id)).imageAnnotations).toEqual([]);
  });
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
