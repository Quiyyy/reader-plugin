import { describe,it,expect } from 'vitest';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReaderService } from '../src/server/service.js';
import { ReaderStore } from '../src/server/store.js';
import { filterLibraryEntries,libraryEntries,mergeWorkspaceSnapshot,moveDestinations,sortLibraryEntries } from '../src/ui/library-entries';
const noteInput={title:'整理笔记',body:'正文与引用需要完整保留。',folderId:null,tags:['保留'],sourceIds:[],imageIds:[]};
async function using(work:(service:ReaderService,dir:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'Reader library organization '));const service=new ReaderService(new ReaderStore(dir));try{await work(service,dir);}finally{await service.close();await rm(dir,{recursive:true,force:true});}}

describe('library organization',()=>{
  it('searches descendants without leaking siblings or trashed entries and restores direct children when cleared',()=>using(async(s)=>{
    const root=(await s.workspace.store.folderSave({name:'课程',parentId:null})).value;
    const child=(await s.workspace.store.folderSave({name:'资料',parentId:root.id})).value;
    const inside=(await s.workspace.store.createNote({...noteInput,title:'查询目标',folderId:child.id})).value;
    const outside=(await s.workspace.store.createNote({...noteInput,title:'查询目标',folderId:null})).value;
    const removed=(await s.workspace.store.createNote({...noteInput,title:'查询目标',folderId:child.id})).value;
    await s.workspace.store.trash('notes',removed.id,removed.revision);
    const snapshot=await s.workspace.store.snapshot(),entries=libraryEntries([],snapshot);
    expect(filterLibraryEntries(entries,snapshot,root.id,'查询目标').map(e=>e.id)).toEqual([inside.id]);
    expect(new Set(filterLibraryEntries(entries,snapshot,null,'查询目标').map(e=>e.id))).toEqual(new Set([inside.id,outside.id]));
    expect(filterLibraryEntries(entries,snapshot,root.id,'  ').map(e=>e.id)).toEqual([child.id]);
  }));
  it('merges out-of-order content and visit snapshots without losing either version',()=>using(async(s)=>{
    const base=await s.workspace.store.snapshot(),content={...base,revision:2,accessRevision:0},access={...base,revision:1,accessRevision:3,visits:{'note:example':'2026-10-29T00:00:00.000Z'}};
    const combined=mergeWorkspaceSnapshot(content,access);expect(combined.revision).toBe(2);expect(combined.accessRevision).toBe(3);expect(combined.visits).toEqual(access.visits);
    expect(mergeWorkspaceSnapshot(combined,base)).toBe(combined);
    const legacy=libraryEntries([],{...base,notes:[{...noteInput,id:'a',revision:1,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2099-01-01T00:00:00Z',preview:''}]});expect(legacy[0]?.accessedAt).toBeUndefined();
  }));
  it('records UI visits separately from content, survives restart and leaves legacy workspace data intact',()=>using(async(s,dir)=>{
    const note=(await s.workspace.store.createNote(noteInput)).value;
    const path=join(dir,'study-v1','workspace.json'),before=await readFile(path);
    const visited=await s.call('reader_library_visit',{kind:'note',id:note.id}) as any;
    expect(await readFile(path)).toEqual(before);
    expect(await s.workspace.store.note(note.id)).toEqual(note);
    const restarted=new ReaderService(new ReaderStore(dir));
    try{const snapshot=await restarted.workspace.store.snapshot();expect(snapshot.visits?.['note:'+note.id]).toBe(visited.accessedAt);expect(snapshot.accessRevision).toBe(1);expect(snapshot.revision).toBe((await s.workspace.store.snapshot()).revision);}finally{await restarted.close();}
    // An older writer can still save workspace.json without removing the access sidecar.
    const legacy=JSON.parse(before.toString());delete legacy.layout;await writeFile(path,JSON.stringify(legacy));
    expect((await s.workspace.store.snapshot()).visits?.['note:'+note.id]).toBe(visited.accessedAt);
    expect((await s.workspace.store.snapshot()).layout).toBe('cards');
    await s.workspace.store.updateNote(note.id,note.revision,{body:'编辑正文并不意味着最近访问。'});
    expect((await s.workspace.store.snapshot()).visits?.['note:'+note.id]).toBe(visited.accessedAt);
  }));
  it('moves mixed items atomically, preserves source files and metadata, and can undo after a later visit',()=>using(async(s,dir)=>{
    const book=await s.store.importBook('原始书籍.txt',Buffer.from('第一章 归档\n\n移动目录不改变原始内容。'));
    const from=(await s.workspace.store.folderSave({name:'原位置',parentId:null})).value,to=(await s.workspace.store.folderSave({name:'目标位置',parentId:null})).value;
    const meta=(await s.workspace.store.bookSave(book.summary.id,0,{title:'保留书名',folderId:from.id,tags:['标签']})).value;
    const note=(await s.workspace.store.createNote({...noteInput,folderId:from.id})).value;
    await s.call('reader_library_visit',{kind:'note',id:note.id});const visits=(await s.workspace.store.snapshot()).visits;
    const sourcePath=join(dir,'books',book.summary.id,'source.txt'),source=await readFile(sourcePath);
    const result=await s.call('reader_library_move',{items:[{kind:'book',id:book.summary.id,revision:meta.revision},{kind:'note',id:note.id,revision:note.revision}],folderId:to.id}) as any;
    const after=await s.workspace.store.snapshot();expect(after.books[book.summary.id]).toMatchObject({title:'保留书名',tags:['标签'],folderId:to.id});
    expect(await s.workspace.store.note(note.id)).toMatchObject({body:note.body,tags:note.tags,sourceIds:note.sourceIds,imageIds:note.imageIds,folderId:to.id});
    expect(after.visits).toEqual(visits);expect(await readFile(sourcePath)).toEqual(source);
    await s.call('reader_library_visit',{kind:'note',id:note.id});await s.workspace.store.undo(result.undoId);
    expect((await s.workspace.store.note(note.id)).folderId).toBe(from.id);expect((await s.workspace.store.snapshot()).books[book.summary.id]?.folderId).toBe(from.id);
  }));
  it('rejects a stale mixed move without writing any part, including cycles and duplicate folder names',()=>using(async(s,dir)=>{
    const book=await s.store.importBook('并发.txt',Buffer.from('第一章\n\n原始正文。'));
    const a=(await s.workspace.store.folderSave({name:'A',parentId:null})).value,b=(await s.workspace.store.folderSave({name:'B',parentId:a.id})).value;
    const note=(await s.workspace.store.createNote(noteInput)).value;
    const path=join(dir,'study-v1','workspace.json'),before=await readFile(path);
    await expect(s.call('reader_library_move',{items:[{kind:'book',id:book.summary.id,revision:0},{kind:'note',id:note.id,revision:0}],folderId:a.id})).rejects.toThrow('另一个窗口');expect(await readFile(path)).toEqual(before);
    await expect(s.call('reader_library_move',{items:[{kind:'note',id:note.id,revision:1},{kind:'folder',id:a.id,revision:a.revision}],folderId:b.id})).rejects.toThrow('层级');expect(await readFile(path)).toEqual(before);
    const duplicate=(await s.workspace.store.folderSave({name:'A',parentId:b.id})).value,prior=await readFile(path);
    await expect(s.call('reader_library_move',{items:[{kind:'folder',id:duplicate.id,revision:duplicate.revision}],folderId:null})).rejects.toThrow('同名');expect(await readFile(path)).toEqual(prior);
    await expect(s.call('reader_library_visit',{kind:'book',id:note.id})).rejects.toThrow();
    await expect(s.call('reader_library_move',{items:[{kind:'book',id:'f'.repeat(64),revision:0}],folderId:null})).rejects.toThrow('书籍不存在');
  }));
  it('mixes books, notebooks and folders by visits and excludes invalid move targets',()=>using(async(s)=>{
    const book=await s.store.importBook('书籍.txt',Buffer.from('第一章\n\n排序示例。'));
    const a=(await s.workspace.store.folderSave({name:'A',parentId:null})).value,b=(await s.workspace.store.folderSave({name:'B',parentId:a.id})).value,c=(await s.workspace.store.folderSave({name:'C',parentId:b.id})).value;
    const note=(await s.workspace.store.createNote(noteInput)).value;
    await s.call('reader_library_visit',{kind:'book',id:book.summary.id});await s.call('reader_library_visit',{kind:'note',id:note.id});await s.call('reader_library_visit',{kind:'folder',id:a.id});
    const snapshot=await s.workspace.store.snapshot(),entries=libraryEntries([book.summary],snapshot);
    expect(sortLibraryEntries(entries,'visited').slice(0,3).map(item=>item.kind)).toEqual(['folder','note','book']);
    expect(moveDestinations([entries.find(item=>item.id===a.id)!],snapshot.folders)).toEqual([null]);
    expect(moveDestinations([entries.find(item=>item.id===note.id)!],snapshot.folders).map(item=>item?.id??null)).toEqual([null,a.id,b.id,c.id]);
    const restored=libraryEntries([book.summary],{...snapshot,folders:snapshot.folders.map(folder=>({...folder,trashedAt:'2026-10-29T00:00:00Z'})),books:{[book.summary.id]:{folderId:a.id,tags:[],revision:1}}});
    expect(restored.find(item=>item.kind==='book')?.parentId).toBe(null);
  }));
});
