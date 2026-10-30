import {preferencesSchema,type WorkspacePreferences} from '../shared/preferences.js';
import {workspaceValues,syncWorkspaceKinds,workspacePreferencesSchema,assertUnchanged,validateEntity} from './sync/entities.js';
import type {ApplyChange} from './sync/engine.js';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite, ReaderStore } from './store.js';
import { NoteBotStore } from './note-bots.js';
import { annotationSchema, appearanceSchema, bookMetadataSchema, defaultAppearance, entityIdSchema, folderSchema, noteSchema, sourceSchema, type Annotation, type Appearance, type BookMetadata, type Folder, type LibraryMoveItem, type LibraryTarget, type Mutation, type Note, type SourceRef, type WorkspaceSnapshot } from '../shared/workspace.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const missing=(e:unknown)=>(e as NodeJS.ErrnoException)?.code==='ENOENT';
const deltaSchema=z.object({kind:z.enum(['notes','folders','annotations','books']),id:z.string(),before:z.unknown().nullable(),after:z.string()});
const stateSchema=z.object({version:z.literal(1),preferences:preferencesSchema.optional(),layout:z.enum(['cards','list']).default('cards'),revision:z.number().int().nonnegative(),folders:z.array(folderSchema).max(2000),notes:z.array(noteSchema).max(2000),annotations:z.array(annotationSchema).max(20000),sources:z.array(sourceSchema).max(20000),books:z.record(z.string(),bookMetadataSchema),appearance:appearanceSchema,aiBooks:z.array(z.string()).max(10000),undo:z.array(z.object({id:entityIdSchema,changes:z.array(deltaSchema),at:z.string(),libraryBooks:z.array(z.object({id:z.string(),lifecycle:z.string()})).optional()})).max(20)});
type State=z.infer<typeof stateSchema>;
type Kind='notes'|'folders'|'annotations'|'books';
type Mutable=Note|Folder|Annotation|BookMetadata;
const accessSchema=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),visits:z.record(z.string(),z.string().datetime())});
export class ConflictError extends Error { constructor(){super('内容已被另一个窗口或 Codex 修改，请先查看最新版本；当前草稿仍可保留。');} }
export class WorkspaceStore {
  readonly directory:string;
  readonly bots:NoteBotStore;
  constructor(readonly store:ReaderStore){this.directory=join(store.dataDir,'study-v1');this.bots=new NoteBotStore(store);}
  private async read():Promise<State>{try{const path=join(this.directory,'workspace.json');if((await fs.stat(path)).size>48*1024*1024)throw Error('工作台存储超过容量限制，请先导出整理');return stateSchema.parse(JSON.parse(await fs.readFile(path,'utf8')));}catch(e){if(missing(e)){let appearance={...defaultAppearance};try{const settings=await this.store.settings();appearance={...appearance,mode:settings.theme==='sepia'?'light':settings.theme,paper:settings.theme==='sepia'?'cream':'white',fontSize:settings.fontSize};}catch{}return {version:1,layout:'cards',revision:0,folders:[],notes:[],annotations:[],sources:[],books:{},appearance,aiBooks:[],undo:[]};}throw e;}}
  private async mutate<T>(work:(state:State)=>T,undoable=true):Promise<Mutation<T>>{
    return this.store.locked('study',async()=>{const state=await this.read(),before=structuredClone(state);const value=work(state);for(const folder of state.folders.filter(f=>!f.trashedAt)){const seen=new Set<string>();let at:Folder|undefined=folder;while(at){if(seen.has(at.id)||seen.size>=3)throw Error('文件夹层级存在冲突');seen.add(at.id);if(at.parentId){const parent=state.folders.find(f=>f.id===at!.parentId&&!f.trashedAt);if(!parent)throw Error('文件夹仍有内容，无法撤销或删除');at=parent;}else at=undefined;}}for(const note of state.notes.filter(n=>!n.trashedAt))if(note.folderId&&!state.folders.some(f=>f.id===note.folderId&&!f.trashedAt))throw Error('笔记的文件夹已变化');for(const book of Object.values(state.books))if(book.folderId&&!state.folders.some(f=>f.id===book.folderId))throw Error('文件夹仍有书籍，无法撤销或删除');state.revision++;
      let undoId:string|undefined;
      if(undoable){const changes:z.infer<typeof deltaSchema>[]=[];for(const kind of ['notes','folders','annotations','books'] as const){const old=kind==='books'?before.books:Object.fromEntries(before[kind].map(x=>[x.id,x]));const now=kind==='books'?state.books:Object.fromEntries(state[kind].map(x=>[x.id,x]));for(const id of new Set([...Object.keys(old),...Object.keys(now)]))if(hash(old[id]??null)!==hash(now[id]??null))changes.push({kind,id,before:old[id]??null,after:hash(now[id]??null)});}if(changes.length){undoId=randomUUID();state.undo.push({id:undoId,changes,at:new Date().toISOString()});state.undo=state.undo.slice(-20);while(Buffer.byteLength(JSON.stringify(state.undo))>8*1024*1024&&state.undo.length>1)state.undo.shift();}}
      const encoded=JSON.stringify(stateSchema.parse(state));if(Buffer.byteLength(encoded)>48*1024*1024)throw Error('工作台容量已满，请先导出部分笔记');await fs.mkdir(this.directory,{recursive:true,mode:0o700});await atomicWrite(join(this.directory,'workspace.json'),encoded);return {value,...(undoId?{undoId}:{}),revision:state.revision};});
  }
  private async readAccess(){try{const path=join(this.directory,'library-access.json');if((await fs.stat(path)).size>4*1024*1024)throw Error('最近访问记录超过容量限制');return accessSchema.parse(JSON.parse(await fs.readFile(path,'utf8')));}catch(error){if(missing(error))return {version:1 as const,revision:0,visits:{} as Record<string,string>};throw error;}}
  async visit(target:LibraryTarget){
    return this.store.locked('study-access',async()=>{
      if(target.kind!=='book'){const state=await this.read();const rows=target.kind==='note'?state.notes:state.folders;if(!rows.some(item=>item.id===target.id&&!item.trashedAt))throw Error('条目不存在或已在回收站');}
      const access=await this.readAccess(),latest=Object.values(access.visits).reduce((value,time)=>Math.max(value,Date.parse(time)),0);
      const accessedAt=new Date(Math.max(Date.now(),latest+1)).toISOString();access.visits[target.kind+':'+target.id]=accessedAt;access.revision++;
      const entries=Object.entries(access.visits);if(entries.length>20000)access.visits=Object.fromEntries(entries.sort((a,b)=>b[1].localeCompare(a[1])).slice(0,20000));
      await fs.mkdir(this.directory,{recursive:true,mode:0o700});await atomicWrite(join(this.directory,'library-access.json'),JSON.stringify(access));
      return {accessedAt,accessRevision:access.revision};
    });
  }
  async move(items:LibraryMoveItem[],folderId:string|null){
    return this.mutate(state=>{
      this.folder(state,folderId);const keys=new Set<string>(),now=new Date().toISOString();
      for(const item of items){
        const key=item.kind+':'+item.id;if(keys.has(key))throw Error('移动列表包含重复条目');keys.add(key);
        if(item.kind==='book'){
          const previous=state.books[item.id];if((previous?.revision??0)!==item.revision)throw new ConflictError();
          state.books[item.id]={...(previous??{tags:[]}),folderId,revision:item.revision+1};
        }else if(item.kind==='note'){
          const note=state.notes.find(note=>note.id===item.id&&!note.trashedAt);if(!note)throw Error('笔记不存在或已在回收站');if(note.revision!==item.revision)throw new ConflictError();
          note.folderId=folderId;note.revision++;note.updatedAt=now;
        }else{
          const folder=state.folders.find(folder=>folder.id===item.id&&!folder.trashedAt);if(!folder)throw Error('文件夹不存在或已在回收站');if(folder.revision!==item.revision)throw new ConflictError();
          folder.parentId=folderId;folder.revision++;
        }
      }
      for(const item of items.filter(item=>item.kind==='folder')){const moved=state.folders.find(folder=>folder.id===item.id)!;if(state.folders.some(folder=>!folder.trashedAt&&folder.id!==moved.id&&folder.parentId===folderId&&folder.name===moved.name))throw Error('目标位置已存在同名文件夹');}
      return {moved:items.length};
    });
  }
  async snapshot():Promise<WorkspaceSnapshot>{const [{preferences,layout,revision,folders,notes,annotations,sources,books,appearance,aiBooks},access]=await Promise.all([this.read(),this.readAccess()]);return {preferences,layout,revision,accessRevision:access.revision,visits:access.visits,folders,notes:notes.map(({body,...note})=>({...note,preview:body.slice(0,180)})),annotations,sources,books,appearance,aiBooks};}
  async note(id:string):Promise<Note>{entityIdSchema.parse(id);const note=(await this.read()).notes.find(x=>x.id===id);if(!note)throw Error('笔记不存在');return note;}
  async source(id:string):Promise<SourceRef>{entityIdSchema.parse(id);const source=(await this.read()).sources.find(x=>x.id===id);if(!source)throw Error('引用不存在');return source;}
  async addSource(value:Omit<SourceRef,'id'|'createdAt'>):Promise<SourceRef>{return (await this.mutate(state=>{const same=state.sources.find(s=>s.bookId===value.bookId&&hash(s.anchor)===hash(value.anchor)&&s.quote===value.quote&&s.imageId===value.imageId);if(same)return same;const source=sourceSchema.parse({...value,id:randomUUID(),createdAt:new Date().toISOString()});state.sources.push(source);return source;},false)).value;}
  private folder(state:State,id:string|null){if(id&&!state.folders.some(x=>x.id===id&&!x.trashedAt))throw Error('文件夹不存在或已在回收站');}
  private references(state:State,ids:string[]){if(new Set(ids).size!==ids.length||ids.some(id=>!state.sources.some(s=>s.id===id)))throw Error('引用列表无效');}
  async createNote(input:Pick<Note,'title'|'body'|'folderId'|'tags'|'sourceIds'|'imageIds'|'imageAnnotations'> & {relatedBookId?:string;id?:string}){return this.mutate(state=>{const id=input.id??randomUUID();const existing=state.notes.find(n=>n.id===id);if(existing)return existing;this.folder(state,input.folderId);this.references(state,input.sourceIds);if(input.imageAnnotations?.some(item=>!input.imageIds.includes(item.imageId)))throw Error('标注图片不在笔记中');const now=new Date().toISOString(),note=noteSchema.parse({...input,id,revision:1,createdAt:now,updatedAt:now});state.notes.unshift(note);return note;});}
  async updateNote(id:string,revision:number,patch:Partial<Pick<Note,'title'|'body'|'folderId'|'tags'|'sourceIds'|'imageIds'|'imageAnnotations'|'comments'|'space'>>){return this.mutate(state=>{const index=state.notes.findIndex(n=>n.id===id&&!n.trashedAt),note=state.notes[index];if(!note)throw Error('笔记不存在或已在回收站');if(note.revision!==revision)throw new ConflictError();this.folder(state,patch.folderId??note.folderId);this.references(state,patch.sourceIds??note.sourceIds);if(patch.imageAnnotations?.some(item=>!(patch.imageIds??note.imageIds).includes(item.imageId)))throw Error('标注图片不在笔记中');const next=noteSchema.parse({...note,...patch,imageAnnotations:(patch.imageAnnotations??note.imageAnnotations??[]).filter(item=>(patch.imageIds??note.imageIds).includes(item.imageId)),revision:revision+1,updatedAt:new Date().toISOString()});state.notes[index]=next;return next;});}
  async folderSave(input:{id?:string;revision?:number;name:string;parentId:string|null}){return this.mutate(state=>{this.folder(state,input.parentId);const existing=input.id?state.folders.find(f=>f.id===input.id&&!f.trashedAt):undefined;if(input.id&&!existing)throw Error('文件夹不存在');if(existing&&existing.revision!==input.revision)throw new ConflictError();const id=input.id??randomUUID();if(state.folders.some(f=>f.id!==id&&!f.trashedAt&&f.parentId===input.parentId&&f.name===input.name.trim()))throw Error('同一位置已存在该名称');const next=folderSchema.parse({id,name:input.name,parentId:input.parentId,revision:(existing?.revision??0)+1});const list=state.folders.filter(f=>f.id!==id).concat(next);for(const folder of list.filter(f=>!f.trashedAt)){const visited=new Set<string>();let at:Folder|undefined=folder;while(at){if(visited.has(at.id))throw Error('不能把文件夹移到自己的下级');visited.add(at.id);if(visited.size>3)throw Error('文件夹最多三层');at=at.parentId?list.find(f=>f.id===at!.parentId&&!f.trashedAt):undefined;}}state.folders=list;return next;});}
  async bookSave(id:string,revision:number,patch:Omit<BookMetadata,'revision'>){return this.mutate(state=>{const previous=state.books[id];if((previous?.revision??0)!==revision)throw new ConflictError();this.folder(state,patch.folderId);const next=bookMetadataSchema.parse({...patch,revision:revision+1});state.books[id]=next;return next;});}
  async annotationSave(input:{id?:string;revision?:number;sourceId:string;comment:string;color:Annotation['color']}){return this.mutate(state=>{this.references(state,[input.sourceId]);const previous=input.id?state.annotations.find(a=>a.id===input.id&&!a.trashedAt):undefined;if(input.id&&!previous)throw Error('批注不存在');if(previous&&previous.revision!==input.revision)throw new ConflictError();const now=new Date().toISOString();const next=annotationSchema.parse({...input,id:input.id??randomUUID(),revision:(previous?.revision??0)+1,createdAt:previous?.createdAt??now,updatedAt:now});state.annotations=state.annotations.filter(x=>x.id!==next.id).concat(next);return next;});}
  async trash(kind:'notes'|'annotations'|'folders',id:string,revision:number,restore=false,contents=false){return this.mutate(state=>{const item=state[kind].find(x=>x.id===id);if(!item)throw Error('条目不存在');if(item.revision!==revision)throw new ConflictError();const now=new Date().toISOString();if(kind==='folders'&&!restore){const target=item as Folder;if(contents){const ids=new Set([id]);for(let i=0;i<3;i++)for(const f of state.folders)if(f.parentId&&ids.has(f.parentId))ids.add(f.id);for(const f of state.folders)if(ids.has(f.id)&&f.id!==id){f.trashedAt=now;f.revision++;}for(const n of state.notes)if(n.folderId&&ids.has(n.folderId)&&!n.trashedAt){n.trashedAt=now;n.revision++;}}else{for(const f of state.folders)if(f.parentId===id){f.parentId=target.parentId;f.revision++;}for(const n of state.notes)if(n.folderId===id){n.folderId=target.parentId;n.revision++;}for(const b of Object.values(state.books))if(b.folderId===id){b.folderId=target.parentId;b.revision++;}}}if(restore){delete item.trashedAt;if('folderId' in item&&item.folderId&&!state.folders.some(f=>f.id===item.folderId&&!f.trashedAt))item.folderId=null;if('parentId' in item&&item.parentId&&!state.folders.some(f=>f.id===item.parentId&&!f.trashedAt))item.parentId=null;}else item.trashedAt=now;item.revision++;return item;});}
  async purge(kind:'notes'|'annotations'|'folders',id:string,revision:number){return this.mutate(state=>{const item=state[kind].find(x=>x.id===id);if(!item?.trashedAt)throw Error('请先移入回收站');if(item.revision!==revision)throw new ConflictError();if(kind==='folders'&&(state.folders.some(f=>f.parentId===id)||state.notes.some(n=>n.folderId===id)||Object.values(state.books).some(b=>b.folderId===id)))throw Error('请先清理或移出文件夹内容');(state[kind] as Mutable[])=(state[kind] as Mutable[]).filter(x=>'id' in x&&x.id!==id);state.undo=state.undo.filter(u=>!u.changes.some(c=>c.kind===kind&&c.id===id));return {deleted:true};},false);}
  async attachBookUndo(id:string,books:{id:string;lifecycle:string}[]){return this.mutate(state=>{const entry=state.undo.find(x=>x.id===id);if(entry)entry.libraryBooks=books;return {saved:true};},false);}
  async undoBookList(id:string){return (await this.read()).undo.find(x=>x.id===id)?.libraryBooks??[];}
  async undo(id:string){return this.mutate(state=>{const entry=state.undo.find(x=>x.id===id);if(!entry)throw Error('这项修改已无法撤销');for(const change of entry.changes){const current=change.kind==='books'?state.books[change.id]:state[change.kind].find(x=>x.id===change.id);if(hash(current??null)!==change.after)throw new ConflictError();}for(const change of entry.changes){if(change.kind==='books'){if(change.before===null)delete state.books[change.id];else state.books[change.id]={...bookMetadataSchema.parse(change.before),revision:(state.books[change.id]?.revision??0)+1};}else{const rows=state[change.kind] as Mutable[];const next=rows.filter(x=>'id' in x&&x.id!==change.id);if(change.before)next.push({...change.before as Mutable,revision:(rows.find(x=>'id' in x&&x.id===change.id)?.revision??0)+1});(state[change.kind] as Mutable[])=next;}}state.undo=state.undo.filter(x=>x.id!==id);return {restored:true};},false);}
  async preferences(patch:WorkspacePreferences){return this.mutate(state=>state.preferences={...state.preferences,...preferencesSchema.parse(patch)},false);}
  async syncValues(preferences:boolean){return workspaceValues(await this.read(),preferences);}
  async applySync(changes:ApplyChange[]){
    if(!changes.length)return [];
    return (await this.mutate(state=>{
      const current=workspaceValues(state,true);for(const change of changes){validateEntity(change.key,change.after);assertUnchanged(current[change.key]??null,change.before);}
      for(const {key,after} of changes){const [kind,id]=key.split(':');if(key==='preferences:workspace'){if(after!==null){const value=workspacePreferencesSchema.parse(after);Object.assign(state,value);}continue;}
        const descriptor=syncWorkspaceKinds[kind as keyof typeof syncWorkspaceKinds];if(!descriptor)throw Error('工作台同步类型无效');
        if(kind==='bookmeta'){if(after===null)delete state.books[id!];else state.books[id!]={...bookMetadataSchema.parse(after),revision:(state.books[id!]?.revision??0)+1};}
        else{const rows=(state as any)[descriptor.collection] as any[],previous=rows.find(item=>item.id===id);(state as any)[descriptor.collection]=rows.filter(item=>item.id!==id);if(after!==null){const parsed=descriptor.schema.parse(after);(state as any)[descriptor.collection].push({...parsed,...('revision' in parsed?{revision:(previous?.revision??0)+1}:{})});}}
      }
      for(const note of state.notes){this.references(state,note.sourceIds);if(note.imageAnnotations?.some(item=>!note.imageIds.includes(item.imageId)))throw Error('同步笔记的图片引用无效');}
      for(const annotation of state.annotations)if(!state.sources.some(source=>source.id===annotation.sourceId))throw Error('同步批注的引用尚未到达');
      return changes.map(change=>change.key);
    },false)).value;
  }
  async layout(layout:'cards'|'list'){return this.mutate(state=>state.layout=layout,false);}
  async appearance(value:Appearance){return this.mutate(state=>state.appearance=appearanceSchema.parse({...value,noteFontSize:value.noteFontSize??state.appearance.noteFontSize??14}),false);}
  async allowBook(id:string,allowed:boolean){return this.mutate(state=>{state.aiBooks=state.aiBooks.filter(x=>x!==id);if(allowed)state.aiBooks.push(id);return {allowed};},false);}
  async forgetBook(id:string){return this.mutate(state=>{delete state.books[id];state.aiBooks=state.aiBooks.filter(book=>book!==id);state.undo=state.undo.filter(item=>!item.changes.some(change=>change.kind==='books'&&change.id===id)&&!item.libraryBooks?.some(book=>book.id===id));return {deleted:true};},false);}
  async canReadBook(id:string){return (await this.read()).aiBooks.includes(id);}
  async putImage(data:string){const bytes=Buffer.from(data,'base64');if(bytes.length<24||bytes.length>4*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR')throw Error('请选择不超过 4 MiB 的 PNG 图片');const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);if(!w||!h||w>4096||h>4096||w*h>12_000_000)throw Error('图片尺寸超过上限');const id=createHash('sha256').update(bytes).digest('hex'),dir=join(this.directory,'images');await fs.mkdir(dir,{recursive:true,mode:0o700});await atomicWrite(join(dir,id+'.png'),bytes);return {id};}
  async image(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw Error('图片标识无效');const bytes=await fs.readFile(join(this.directory,'images',id+'.png'));if(bytes.length>4*1024*1024)throw Error('图片过大');return {data:bytes.toString('base64'),mimeType:'image/png'};}
}
