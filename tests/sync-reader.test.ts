import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReaderStore} from '../src/server/store.js';
import {ReaderService} from '../src/server/service.js';
import {MemoryCloud,MemoryCredentials} from './sync-fixtures';
import {defaultAppearance} from '../src/shared/workspace.js';
import {pdfFixture} from './pdf-fixture';
// @ts-expect-error Original fixture shared with the development inspector.
import {epubFixture} from '../scripts/epub-fixture.mjs';
const options={books:true,preferences:false};
const noteInput={title:'原创同步笔记',body:'只用原创测试内容。',folderId:null,tags:[],sourceIds:[],imageIds:[]};
async function pair(work:(a:ReaderService,b:ReaderService,cloud:MemoryCloud,root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'Reader two real libraries ')),cloud=new MemoryCloud(),ca=new MemoryCredentials(),cb=new MemoryCredentials();ca.connect();cb.connect();const a=new ReaderService(new ReaderStore(join(root,'a')),undefined,{credentials:ca,provider:()=>cloud}),b=new ReaderService(new ReaderStore(join(root,'b')),undefined,{credentials:cb,provider:()=>cloud});try{await work(a,b,cloud,root);}finally{await a.close();await b.close();await rm(root,{recursive:true,force:true});}}
async function run(reader:ReaderService){await reader.sync.run();const status=await reader.sync.settled();expect(status.error).toBeUndefined();return status;}
async function connect(a:ReaderService,b:ReaderService,books=true){const created=await a.sync.create('原创验收书库','电脑 A',{...options,books});await run(a);await b.sync.join(created.recoveryKey,'电脑 B',{...options,books});await run(b);return created;}
// Real PDF workers and durable writes to two libraries exceed the 5 s unit
// default on shared CI machines. Keep a bounded integration-test budget.
describe('Reader cloud integration with two isolated libraries',{timeout:60000},()=>{
  it('restores EPUB anchors, bookmarks and PDF viewport from verified original files',()=>pair(async(a,b,cloud,root)=>{
    const epubBytes=await epubFixture(),epub=await a.store.importBook('原创云端.epub',epubBytes),opened=await a.epub.open(epub.summary.id);
    const location=opened.state.location!;expect(location).toBeDefined();await a.epub.save(epub.summary.id,location,{style:'comfort',flow:'scroll',fontSize:18});await a.epub.bookmark(epub.summary.id,location,'原书锚点');
    const pdfBytes=pdfFixture(),pdf=await a.pdf.importBook('原创云端.pdf',pdfBytes);await a.pdf.save(pdf.summary.id,{page:1,scroll:.45,scale:1.2,rotation:90});
    await connect(a,b);expect(await b.sync.localBook(epub.summary.id)).toBe(false);expect(await b.sync.localBook(pdf.summary.id)).toBe(false);
    await b.sync.ensureBook(epub.summary.id);const restored=await b.epub.open(epub.summary.id);expect(restored.state.location).toEqual(location);expect(restored.state.bookmarks[0]!.label).toBe('原书锚点');
    await b.sync.ensureBook(pdf.summary.id);expect(await b.pdf.peek(pdf.summary.id)).toMatchObject({page:1,scroll:.45,scale:1.2,rotation:90});expect(await readFile(join(root,'b','pdf-v1',pdf.summary.id,'source.pdf'))).toEqual(pdfBytes);
    await run(b);await run(a);expect((await a.sync.status()).conflicts).toHaveLength(0);
    await b.pdf.save(pdf.summary.id,{page:1,scroll:.1,scale:1,rotation:0});await run(b);await run(a);expect((await a.pdf.peek(pdf.summary.id)).scroll).toBe(.45);const other=(await a.sync.positions(pdf.summary.id)).find(position=>!position.thisDevice)!;await a.sync.resume(other.key,other.versionId);expect((await a.pdf.peek(pdf.summary.id)).scroll).toBe(.1);
  }));
  it('synchronises notes, folders, bots and bookmarks; downloads a book only when opened',()=>pair(async(a,b,cloud,root)=>{
    const book=await a.store.importBook('原创同步.txt',Buffer.from('第一章 原创\n\n第一段。\n\n第二段可定位的原创文字。'));
    const folder=await a.workspace.store.folderSave({name:'学习',parentId:null});await a.workspace.store.bookSave(book.summary.id,0,{folderId:folder.value.id,tags:[]});
    const image=await a.workspace.store.putImage('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY/sAAAAASUVORK5CYII=');
    const note=await a.workspace.store.createNote({...noteInput,folderId:folder.value.id,imageIds:[image.id]});const bots=await a.workspace.store.bots.list();await a.workspace.store.bots.save(bots.revision,{...bots.bots[0]!,name:'原创写作助手'},true);
    await a.store.addBookmark(book.summary.id,{chapter:0,paragraph:2},'原创书签');await a.store.saveProgress(book.summary.id,{chapter:0,paragraph:2});await a.workspace.store.allowBook(book.summary.id,true);await a.workspace.store.appearance({...defaultAppearance,mode:'dark'});
    await connect(a,b);const state=await b.workspace.store.snapshot();expect((await b.workspace.store.note(note.value.id)).body).toBe(noteInput.body);expect(state.folders[0]!.name).toBe('学习');expect(state.aiBooks).toEqual([]);expect(state.appearance.mode).toBe('system');expect((await b.workspace.store.bots.list()).bots[0]!.name).toBe('原创写作助手');
    const library=await b.call('reader_list',{}) as any;expect(library.books[0]).toMatchObject({id:book.summary.id,cloudOnly:true,cloudAvailable:true});await expect(readFile(join(root,'b','books',book.summary.id,'source.txt'))).rejects.toThrow();
    const opened=await b.call('reader_get',{id:book.summary.id}) as any;expect(opened.document.chapters[0].paragraphs).toContain('第二段可定位的原创文字。');expect(opened.bookmarks).toHaveLength(1);expect(opened.summary.locator.paragraph).toBe(2);
    const downloaded=await b.call('reader_image_get',{id:image.id}) as any;expect(downloaded.data).toContain('iVBOR');await run(b);await run(a);expect((await a.sync.status()).conflicts).toHaveLength(0);
    for(const file of cloud.files.values()){expect(file.bytes.includes(Buffer.from(noteInput.body))).toBe(false);expect(file.bytes.includes(Buffer.from('fixture-refresh-token'))).toBe(false);}
  }));
  it('preserves two real note revisions after concurrent offline edits and can keep both',()=>pair(async(a,b)=>{
    const note=await a.workspace.store.createNote(noteInput);await connect(a,b);const second=await b.workspace.store.note(note.value.id);await a.workspace.store.updateNote(note.value.id,note.value.revision,{body:'电脑 A 离线修改'});await b.workspace.store.updateNote(second.id,second.revision,{body:'电脑 B 离线修改'});await run(a);await run(b);await run(a);const conflict=await a.sync.conflict('note:'+note.value.id);expect(conflict.versions.map(v=>v.text).sort()).toEqual(['电脑 A 离线修改','电脑 B 离线修改']);await a.sync.resolve({key:conflict.key,expectedHeads:conflict.versions.map(v=>v.id),keepBoth:true});await run(a);await run(b);const notes=await b.workspace.store.snapshot();expect(notes.notes).toHaveLength(2);expect((await b.sync.status()).conflicts).toHaveLength(0);
  }));
  it('propagates a recoverable book deletion and restoration without deleting original bytes',()=>pair(async(a,b,cloud,root)=>{
    const book=await a.store.importBook('回收同步.txt',Buffer.from('第一章 原创\n\n需要保留的原始文件。'));await connect(a,b);await b.call('reader_get',{id:book.summary.id});await run(b);await run(a);await a.call('reader_trash',{id:book.summary.id});await run(a);await run(b);expect(await b.store.isTrashed(book.summary.id)).toBe(true);expect(await readFile(join(root,'b','books',book.summary.id,'source.txt'),'utf8')).toContain('需要保留');await b.call('reader_restore',{id:book.summary.id});await run(b);await run(a);expect(await a.store.isTrashed(book.summary.id)).toBe(false);
  }));
  it('leaves the local note intact if the remote vault disappears',()=>pair(async(a,b,cloud)=>{const note=await a.workspace.store.createNote(noteInput);await connect(a,b);const vault=[...cloud.files.values()].find(file=>file.file.appProperties?.kind==='vault')!;cloud.files.delete(vault.file.id);await b.sync.run();const status=await b.sync.settled();expect(status.phase).toBe('error');expect((await b.workspace.store.note(note.value.id)).body).toBe(noteInput.body);}));
  it('uploads original books when that scope is enabled later without requiring a content edit',()=>pair(async(a,b)=>{const book=await a.store.importBook('按需原文.txt',Buffer.from('第一章 原创\n\n稍后开启原始文件同步。'));await connect(a,b,false);expect((await b.sync.cloudBooks())[0]!.cloudAvailable).toBe(false);await a.sync.settings({options});await run(a);await run(b);expect((await b.sync.cloudBooks())[0]!.cloudAvailable).toBe(true);await b.sync.ensureBook(book.summary.id);expect((await b.store.peek(book.summary.id)).document.title).toBe(book.document.title);}));
});
