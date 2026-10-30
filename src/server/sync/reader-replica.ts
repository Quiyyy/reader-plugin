import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ReaderService} from '../service.js';
import type {Bookmark,BookSummary} from '../../shared/types.js';
import {epubLocationSchema} from '../../shared/epub.js';
import {normalValue,revisionless,validateEntity,bookManifestSchema,positionSchema,syncBookmarkSchema,syncEpubMarkSchema,LocalSyncChanged,readerPreferencesSchema,assertUnchanged,type BookManifest,type SyncedPosition} from './entities.js';
import {keyboardSchema} from '../../shared/keyboard.js';
import {digest,type LocalAsset} from './protocol.js';
import type {ApplyChange,LocalReplica,ReplicaContext,SyncValue} from './engine.js';

export class ReaderReplica implements LocalReplica {
  constructor(private reader:ReaderService){}
  validate(key:string,value:SyncValue){validateEntity(key,value);}
  async manifests(context?:ReplicaContext):Promise<BookManifest[]>{
    const {reader}=this,trash=await reader.store.listTrash(),books=[...(await reader.store.list()).books,...await reader.pdf.list(),...await reader.online.listBooks(),...trash.map(entry=>entry.summary)],result:BookManifest[]=[];
    for(const summary of books){let value:BookManifest;if(summary.format==='pdf'){value={id:summary.id,title:summary.title,author:summary.author,format:'pdf',filename:summary.id+'.pdf',bytes:(await fs.stat(join(reader.store.dataDir,'pdf-v1',summary.id,'source.pdf'))).size,chapterCount:summary.chapterCount,wordCount:summary.wordCount};}
      else if(summary.format==='online')value={id:summary.id,title:summary.title,author:summary.author,format:'online',filename:summary.id+'.online',bytes:0,chapterCount:0,wordCount:0};
      else{const data=await reader.store.syncBook(summary.id);value={id:summary.id,title:summary.title,author:summary.author,format:summary.format,filename:data.filename,bytes:data.bytes,chapterCount:summary.chapterCount,wordCount:summary.wordCount,...(data.detail.document.encoding?{encoding:data.detail.document.encoding}:{})};}const deleted=trash.find(entry=>entry.summary.id===summary.id);if(deleted){if(context?.suppressedBooks?.includes(summary.id))continue;value.trashedAt=deleted.trashedAt;}result.push(bookManifestSchema.parse(value));
    }return result;
  }
  async snapshot(context:ReplicaContext):Promise<Record<string,SyncValue>>{
    const {reader}=this,result={...await reader.workspace.store.syncValues(context.options.preferences),...await reader.workspace.store.bots.syncValues()};
    if(context.options.preferences){result['preferences:reader']=normalValue(await reader.store.settings());result['preferences:keyboard']=normalValue(await reader.store.keyboard());}
    for(const manifest of await this.manifests(context)){
      const id=manifest.id;result['book:'+id]=normalValue(manifest);let updatedAt:string|undefined,location:Partial<SyncedPosition>={},marks:Bookmark[]=[];
      if(manifest.format==='pdf'){const pdf=await reader.pdf.syncRecord(id);updatedAt=pdf.lastReadAt;location={pdf:{page:pdf.page,scroll:pdf.scroll,scale:pdf.scale,rotation:pdf.rotation}};}
      else if(manifest.format==='online'){const book=await reader.online.syncRecord(id);updatedAt=book.summary.lastReadAt;location={locator:book.summary.locator};marks=book.bookmarks;}
      else{const book=await reader.store.syncBook(id);updatedAt=book.detail.summary.lastReadAt;location={locator:book.detail.summary.locator};marks=book.detail.bookmarks;
        if(manifest.format==='epub'&&book.rich){const rich=book.rich as any;if(epubLocationSchema.safeParse(rich.location).success){location.epub=rich.location;location.appearance=rich.appearance;updatedAt=rich.updatedAt??updatedAt;}for(const mark of z.array(syncEpubMarkSchema).parse(rich.bookmarks??[]))result['epub-bookmark:'+id+':'+mark.id]=normalValue(mark);}
      }
      for(const mark of marks)result['bookmark:'+id+':'+mark.id]=normalValue(syncBookmarkSchema.parse(mark));
      if(updatedAt)result['position:'+id+':'+context.deviceId]=normalValue(positionSchema.parse({bookId:id,deviceId:context.deviceId,deviceName:context.deviceName,format:manifest.format,title:manifest.title,updatedAt,...location}));
    }return result;
  }
  async assets(key:string,value:SyncValue,context:ReplicaContext):Promise<LocalAsset[]>{
    if(value===null)return [];const result:LocalAsset[]=[];
    const images=key.startsWith('note:')?(value as any).imageIds??[]:key.startsWith('source:')&&(value as any).imageId?[(value as any).imageId]:[];
    for(const id of images){const path=join(this.reader.workspace.store.directory,'images',z.string().regex(/^[a-f0-9]{64}$/).parse(id)+'.png');try{result.push({kind:'image',id,format:'png',bytes:(await fs.stat(path)).size});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;/* Already-remote assets are supplied by the engine's index. */}}
    if(key.startsWith('book:')&&context.options.books){const book=bookManifestSchema.parse(value);if(book.format!=='online')result.push({kind:'book',id:book.id,format:book.format,bytes:book.bytes});}
    return result;
  }
  async readAsset(asset:LocalAsset){z.string().regex(/^[a-f0-9]{64}$/).parse(asset.id);const root=this.reader.store.dataDir;if(asset.kind==='image')return fs.readFile(join(root,'study-v1','images',asset.id+'.png'));if(!['txt','epub','pdf'].includes(asset.format))throw Error('附件格式无效');return fs.readFile(asset.format==='pdf'?join(root,'pdf-v1',asset.id,'source.pdf'):join(root,'books',asset.id,'source.'+asset.format));}
  async installAsset(asset:LocalAsset,bytes:Buffer,manifest?:BookManifest,password?:string){
    if(asset.kind==='image'){const result=await this.reader.workspace.store.putImage(bytes.toString('base64'));if(result.id!==asset.id)throw Error('图片标识不一致');return;}
    if(!manifest||manifest.id!==asset.id||manifest.format!==asset.format)throw Error('书籍附件描述不一致');
    const result=manifest.format==='pdf'?await this.reader.pdf.importBook(manifest.filename,bytes,password):await this.reader.store.importBook(manifest.filename,bytes,manifest.encoding);if(result.summary.id!==manifest.id)throw Error('书籍内容标识不一致');if(manifest.format==='pdf')await this.reader.pdf.syncDescriptor(manifest.id,manifest.title,manifest.author);else await this.reader.store.syncDescriptor(manifest.id,manifest.title,manifest.author,manifest.filename);
  }
  async apply(changes:ApplyChange[],context:ReplicaContext):Promise<string[]>{
    if(!changes.length)return [];const applied:string[]=[];const workspace=changes.filter(change=>/^(note|folder|annotation|source|bookmeta):/.test(change.key)||change.key==='preferences:workspace');
    try{applied.push(...await this.reader.workspace.store.applySync(workspace));}catch(e){if(!(e instanceof LocalSyncChanged))throw e;}
    const bots=changes.filter(change=>change.key.startsWith('bot:')||change.key.startsWith('bot-default:'));try{applied.push(...await this.reader.workspace.store.bots.applySync(bots));}catch(e){if(!(e instanceof LocalSyncChanged))throw e;}
    for(const change of changes.filter(change=>change.key==='preferences:reader'||change.key==='preferences:keyboard')){if(change.after===null)continue;try{if(change.key==='preferences:reader')await this.reader.store.saveSettings(readerPreferencesSchema.parse(change.after),readerPreferencesSchema.parse(change.before));else await this.reader.store.saveKeyboard(keyboardSchema.parse(change.after),keyboardSchema.parse(change.before));applied.push(change.key);}catch(e){if(!(e instanceof LocalSyncChanged))throw e;}}
    for(const change of changes.filter(change=>change.key.startsWith('book:'))){
      const id=change.key.slice(5),current=(await this.manifests(context)).find(book=>book.id===id);if(digest(current??null)!==digest(change.before))continue;
      if(change.after===null){if(current&&!current.trashedAt)await this.reader.call('reader_trash',{id});applied.push(change.key);continue;}
      const desired=bookManifestSchema.parse(change.after);
      if(!current){if(await this.reader.store.isTrashed(id)){await this.reader.store.restoreBook(id);}else continue;}
      if(desired.trashedAt){const summary:BookSummary={id,title:desired.title,author:desired.author,format:desired.format,addedAt:new Date().toISOString(),progress:0,locator:{chapter:0,paragraph:0},chapterCount:desired.chapterCount,wordCount:desired.wordCount};await this.reader.store.syncLifecycle(summary,current?.trashedAt,desired.trashedAt);applied.push(change.key);continue;}
      if(current?.trashedAt)await this.reader.store.restoreBook(id);
      if(desired.format==='pdf')await this.reader.pdf.syncDescriptor(id,desired.title,desired.author);
      else if(desired.format==='txt'||desired.format==='epub')await this.reader.store.syncDescriptor(id,desired.title,desired.author,desired.filename);
      else await this.reader.online.syncDescriptor(id,desired.title,desired.author);
      applied.push(change.key);
    }
    const bookmarks=changes.filter(change=>change.key.startsWith('bookmark:'));
    for(const id of new Set(bookmarks.map(change=>change.key.split(':')[1]!))){
      const online=await this.reader.online.has(id),local=(await this.reader.store.list()).books.find(book=>book.id===id);if(!local&&!online||await this.reader.store.isTrashed(id))continue;const before=online?(await this.reader.online.syncRecord(id)).bookmarks:(await this.reader.store.peek(id)).bookmarks,next=[...before],group=bookmarks.filter(change=>change.key.split(':')[1]===id);
      try{for(const change of group){const markId=change.key.split(':')[2]!;assertUnchanged(before.find(mark=>mark.id===markId)??null,change.before);const at=next.findIndex(mark=>mark.id===markId);if(at>=0)next.splice(at,1);if(change.after!==null)next.push(syncBookmarkSchema.parse(change.after));}if(online)await this.reader.online.syncBookmarks(id,before,next);else await this.reader.store.syncBookmarks(id,before,next);applied.push(...group.map(change=>change.key));}catch(e){if(!(e instanceof LocalSyncChanged))throw e;}
    }
    const epub=changes.filter(change=>change.key.startsWith('epub-bookmark:'));
    for(const id of new Set(epub.map(change=>change.key.split(':')[1]!))){if(!(await this.reader.store.list()).books.some(book=>book.id===id))continue;const group=epub.filter(change=>change.key.split(':')[1]===id);try{await this.reader.epub.syncBookmarks(id,group);applied.push(...group.map(change=>change.key));}catch(e){if(!(e instanceof LocalSyncChanged))throw e;}}
    return applied;
  }
  async resume(value:SyncValue,signal?:AbortSignal){const position=positionSchema.parse(value),id=position.bookId;if(position.format==='pdf'&&position.pdf)await this.reader.pdf.save(id,position.pdf);else if(position.format==='epub'&&position.epub){const opened=await this.reader.epub.open(id);await this.reader.epub.save(id,position.epub,position.appearance??opened.state.appearance);}else if(position.locator){if(position.format==='online'&&position.locator.chapterId)await this.reader.online.run(randomUUID(),'sync-position:'+id,inner=>this.reader.online.chapter(id,position.locator!.chapterId!,signal?AbortSignal.any([signal,inner]):inner));await this.reader.call('reader_progress',{id,locator:position.locator});}else throw Error('此阅读位置缺少定位信息');}
}
