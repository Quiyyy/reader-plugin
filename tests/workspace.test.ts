import { describe,it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderService } from '../src/server/service.js';
import { ReaderStore } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace-store.js';
import { defaultAppearance,type SearchHit } from '../src/shared/workspace.js';
const using=async(work:(service:ReaderService,dir:string)=>Promise<void>)=>{const dir=await mkdtemp(join(tmpdir(),'Reader workspace '));try{await work(new ReaderService(new ReaderStore(dir)),dir);}finally{await rm(dir,{recursive:true,force:true});}};
const noteInput={title:'阅读记录',body:'我的理解',folderId:null,tags:[],sourceIds:[],imageIds:[]};
describe('learning workspace durability and boundaries',()=>{
  it('filters before limiting search and keeps note matches ahead of repeated passages',()=>using(async(s)=>{
    const folder=(await s.workspace.store.folderSave({name:'搜索课程',parentId:null})).value,child=(await s.workspace.store.folderSave({name:'子目录',parentId:folder.id})).value;
    const book=await s.store.importBook('原创检索.txt',Buffer.from('第一章\n\n'+Array.from({length:90},(_,i)=>`关键词 原创段落 ${i}`).join('\n\n')));
    await s.workspace.store.bookSave(book.summary.id,0,{folderId:child.id,tags:[]});
    const note=(await s.workspace.store.createNote({...noteInput,title:'关键词',body:'有关键词的笔记',folderId:child.id})).value;
    const outside=(await s.workspace.store.createNote({...noteInput,title:'范围之外的关键词'})).value;
    const all=await s.call('reader_workspace_search',{query:'关键词',limit:3}) as SearchHit[];expect(all[0]).toMatchObject({kind:'note',id:note.id});expect(all).toHaveLength(3);
    const filtered=await s.call('reader_workspace_search',{query:'关键词',kind:'note',folderId:folder.id,limit:1});expect(filtered).toMatchObject([{id:note.id}]);
    const root=await s.call('reader_workspace_search',{query:'关键词',kind:'note',folderId:null});expect(root).toMatchObject([{id:outside.id}]);
    const passages=await s.call('reader_workspace_search',{query:'关键词',kind:'passage',folderId:folder.id,limit:22}) as SearchHit[];expect(passages).toHaveLength(22);expect(passages.every(hit=>hit.kind==='passage'&&hit.locator)).toBe(true);
    await s.workspace.store.trash('notes',note.id,note.revision);expect(await s.call('reader_workspace_search',{query:'关键词',kind:'note',folderId:folder.id})).toEqual([]);
    expect(await s.call('reader_study_search',{query:'关键词',bookId:book.summary.id})).toEqual([]);
  }));
  it('persists partial workspace preferences without resetting unrelated choices',()=>using(async(s,dir)=>{
    await s.workspace.store.preferences({noteMode:'source',noteToolbar:true});await s.workspace.store.preferences({librarySort:'name'});
    const restarted=new WorkspaceStore(new ReaderStore(dir));expect((await restarted.snapshot()).preferences).toEqual({noteMode:'source',noteToolbar:true,librarySort:'name'});
    await expect(restarted.preferences({noteMode:'unknown'} as any)).rejects.toThrow();
  }));
  it('persists note font size without letting older appearance clients reset it',()=>using(async(s,dir)=>{
    expect((await s.workspace.store.snapshot()).appearance.noteFontSize).toBe(14);
    await s.workspace.store.appearance({...defaultAppearance,noteFontSize:18});
    const {noteFontSize:_,...legacy}=defaultAppearance;await s.workspace.store.appearance({...legacy,mode:'dark'});
    const restarted=new WorkspaceStore(new ReaderStore(dir));expect((await restarted.snapshot()).appearance).toMatchObject({noteFontSize:18,mode:'dark'});
    await expect(restarted.appearance({...defaultAppearance,noteFontSize:50})).rejects.toThrow();
  }));
  it('preserves note comments through content edits, restart and undo',()=>using(async(s,dir)=>{
    const created=await s.workspace.store.createNote(noteInput),id=created.value.id;
    const comments=[{id:crypto.randomUUID(),quote:'我的理解',text:'补充具体例子',createdAt:new Date().toISOString(),resolved:false}];
    const saved=await s.workspace.store.updateNote(id,1,{comments});
    const edited=await s.workspace.store.updateNote(id,saved.value.revision,{body:'补充后的理解'});
    const restarted=new WorkspaceStore(new ReaderStore(dir));expect((await restarted.note(id)).comments).toEqual(comments);
    await s.workspace.store.undo(edited.undoId!);expect((await restarted.note(id)).comments).toEqual(comments);expect((await restarted.note(id)).body).toBe(noteInput.body);
  }));
  it('defaults new libraries to a grid and keeps a saved layout independent of appearance',()=>using(async(s,dir)=>{
    expect((await s.workspace.store.snapshot()).layout).toBe('cards');
    await s.workspace.store.layout('list');
    await s.workspace.store.appearance({...defaultAppearance,mode:'dark'});
    const restarted=new WorkspaceStore(new ReaderStore(dir));
    expect((await restarted.snapshot()).layout).toBe('list');
    await restarted.appearance({...defaultAppearance,mode:'light',paper:'cream'});
    expect((await restarted.snapshot()).layout).toBe('list');
  }));
  it('preserves notes after restart and rejects stale concurrent edits, including after undo',()=>using(async(s,dir)=>{
    const created=await s.workspace.store.createNote(noteInput),id=created.value.id;
    const second=new WorkspaceStore(new ReaderStore(dir));expect((await second.note(id)).body).toBe('我的理解');
    const changed=await s.workspace.store.updateNote(id,1,{body:'新版本'});
    await expect(second.updateNote(id,1,{body:'过期覆盖'})).rejects.toThrow('另一个窗口');
    await s.workspace.store.undo(changed.undoId!);const restored=await second.note(id);expect(restored.body).toBe('我的理解');expect(restored.revision).toBeGreaterThan(2);
    await expect(second.updateNote(id,1,{body:'过期覆盖'})).rejects.toThrow();
  }));
  it('enforces folder depth and cycle rules and moves contents safely when removing a folder',()=>using(async(s)=>{
    const st=s.workspace.store,a=(await st.folderSave({name:'A',parentId:null})).value,b=(await st.folderSave({name:'B',parentId:a.id})).value,c=(await st.folderSave({name:'C',parentId:b.id})).value;
    await expect(st.folderSave({name:'D',parentId:c.id})).rejects.toThrow('三层');await expect(st.folderSave({...a,parentId:b.id})).rejects.toThrow('下级');
    const note=(await st.createNote({...noteInput,folderId:b.id})).value;await st.trash('folders',b.id,b.revision);expect((await st.note(note.id)).folderId).toBe(a.id);expect((await st.snapshot()).folders.find(f=>f.id===c.id)?.parentId).toBe(a.id);
  }));
  it('validates source text and separates app search from model access to full books',()=>using(async(s)=>{
    const book=await s.store.importBook('原创.txt',Buffer.from('第一章 学习\n\n只有主动回忆，才能检查理解。\n\n这个段落尚未授权给模型。'));
    const quote=book.document.chapters[0]!.paragraphs[0]!;const input={bookId:book.summary.id,quote,anchor:{kind:'text' as const,start:{chapter:0,paragraph:0,offset:0},end:{chapter:0,paragraph:0,offset:quote.length}}};
    const source=await s.workspace.createSource(input);expect((await s.workspace.resolveSource(source.id)).available).toBe(true);
    await expect(s.workspace.createSource({...input,quote:'伪造原文'})).rejects.toThrow('不一致');
    await expect(s.call('reader_read_passage',{id:book.summary.id})).rejects.toThrow('尚未允许');
    const publicHits=await s.call('reader_study_search',{query:'尚未授权'}) as unknown[];expect(publicHits).toEqual([]);
    expect((await s.call('reader_workspace_search',{query:'尚未授权'}) as unknown[]).length).toBeGreaterThan(0);
    await s.call('reader_ai_book_access',{id:book.summary.id,allowed:true});expect(await s.call('reader_read_passage',{id:book.summary.id})).toMatchObject({id:book.summary.id});
    await s.store.trashBook(book.summary.id);expect((await s.workspace.resolveSource(source.id)).available).toBe(false);expect((await s.workspace.store.source(source.id)).quote).toBe(quote);
  }));
  it('retains source references independently of note and annotation trash',()=>using(async(s)=>{
    const book=await s.store.importBook('原创.txt',Buffer.from('第一章 测试\n\n原创测试段落。'));const quote=book.document.chapters[0]!.paragraphs[0]!;const source=await s.workspace.createSource({bookId:book.summary.id,quote,anchor:{kind:'text',start:{chapter:0,paragraph:0,offset:0},end:{chapter:0,paragraph:0,offset:quote.length}}});
    const note=(await s.workspace.store.createNote({...noteInput,sourceIds:[source.id]})).value,annotation=(await s.workspace.store.annotationSave({sourceId:source.id,comment:'批注',color:'yellow'})).value;
    await s.workspace.store.trash('annotations',annotation.id,annotation.revision);await s.workspace.store.trash('notes',note.id,note.revision);expect((await s.workspace.store.source(source.id)).quote).toBe(quote);await s.workspace.store.trash('notes',note.id,2,true);expect((await s.workspace.store.note(note.id)).sourceIds).toEqual([source.id]);
  }));
  it('undoes a folder deletion with its books, and permanently deletes only trashed originals',()=>using(async(s)=>{
    const book=await s.store.importBook('分组原创.txt',Buffer.from('第一章 分组\n\n原文可删除，摘录继续保留。'));
    const folder=(await s.workspace.store.folderSave({name:'待读',parentId:null})).value;
    await s.workspace.store.bookSave(book.summary.id,0,{title:'已修改书名',folderId:folder.id,tags:['阅读']});
    expect(await s.call('reader_books_search',{query:'已修改书名'})).toMatchObject([{id:book.summary.id}]);
    const note=(await s.workspace.store.createNote({...noteInput,folderId:folder.id})).value;
    const removed=await s.call('reader_study_trash',{kind:'folders',id:folder.id,revision:folder.revision,contents:true}) as any;
    expect(await s.store.isTrashed(book.summary.id)).toBe(true);expect((await s.workspace.store.note(note.id)).trashedAt).toBeTruthy();
    await s.call('reader_study_undo',{id:removed.undoId});expect(await s.store.isTrashed(book.summary.id)).toBe(false);expect((await s.workspace.store.note(note.id)).trashedAt).toBeUndefined();
    await expect(s.call('reader_book_purge',{id:book.summary.id,trashedAt:'stale'})).rejects.toThrow();
    await s.store.trashBook(book.summary.id);const trash=await s.store.listTrash();
    await expect(s.call('reader_book_purge',{id:book.summary.id,trashedAt:'stale'})).rejects.toThrow();
    await s.call('reader_book_purge',{id:book.summary.id,trashedAt:trash.find(b=>b.summary.id===book.summary.id)!.trashedAt});
    await expect(s.store.peek(book.summary.id)).rejects.toThrow();expect((await s.workspace.store.note(note.id)).body).toBe(noteInput.body);expect((await s.workspace.store.snapshot()).books[book.summary.id]).toBeUndefined();
  }));
});
