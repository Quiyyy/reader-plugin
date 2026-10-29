import type { BookSummary } from '../shared/types';
import type { Folder,LibraryMoveItem,LibraryTarget,NoteSummary,WorkspaceSnapshot } from '../shared/workspace';

export interface LibraryEntry extends LibraryMoveItem {
  name:string;
  parentId:string|null;
  accessedAt?:string;
  book?:BookSummary;
  note?:NoteSummary;
  folder?:Folder;
}
export const libraryKey=(entry:LibraryTarget)=>entry.kind+':'+entry.id;
export function mergeWorkspaceSnapshot(previous:WorkspaceSnapshot,next:WorkspaceSnapshot):WorkspaceSnapshot {
  const before=previous.accessRevision??0,after=next.accessRevision??0;
  if(next.revision<=previous.revision&&after<=before)return previous;
  if(next.revision>=previous.revision&&after>=before)return next;
  return {...(next.revision>previous.revision?next:previous),visits:after>before?next.visits:previous.visits,accessRevision:Math.max(before,after)};
}

export function libraryEntries(books:BookSummary[],snapshot:WorkspaceSnapshot):LibraryEntry[] {
  const folders=snapshot.folders.filter(folder=>!folder.trashedAt),active=new Set(folders.map(folder=>folder.id));
  const parent=(id:string|null|undefined)=>id&&active.has(id)?id:null;
  const accessed=(kind:LibraryTarget['kind'],id:string)=>snapshot.visits?.[kind+':'+id];
  return [
    ...folders.map(folder=>({kind:'folder' as const,id:folder.id,name:folder.name,parentId:parent(folder.parentId),revision:folder.revision,accessedAt:accessed('folder',folder.id),folder})),
    ...books.map(book=>{const meta=snapshot.books[book.id];return {kind:'book' as const,id:book.id,name:meta?.title||book.title,parentId:parent(meta?.folderId),revision:meta?.revision??0,accessedAt:accessed('book',book.id)??book.lastReadAt,book};}),
    ...snapshot.notes.filter(note=>!note.trashedAt).map(note=>({kind:'note' as const,id:note.id,name:note.title||'未命名笔记本',parentId:parent(note.folderId),revision:note.revision,accessedAt:accessed('note',note.id),note})),
  ];
}
export function folderPath(id:string|null,folders:Folder[]):Folder[] {
  const byId=new Map(folders.filter(folder=>!folder.trashedAt).map(folder=>[folder.id,folder])),seen=new Set<string>(),path:Folder[]=[];
  let current=id?byId.get(id):undefined;
  while(current&&!seen.has(current.id)){seen.add(current.id);path.unshift(current);current=current.parentId?byId.get(current.parentId):undefined;}
  return path;
}
export function moveDestinations(entries:LibraryEntry[],folders:Folder[]):Array<Folder|null> {
  const active=folders.filter(folder=>!folder.trashedAt),paths=new Map(active.map(folder=>[folder.id,folderPath(folder.id,active)]));
  const heights=new Map<string,number>();
  for(const path of paths.values())path.forEach((folder,index)=>heights.set(folder.id,Math.max(heights.get(folder.id)??1,path.length-index)));
  return [null,...active].filter(target=>{
    const path=target?paths.get(target.id)??[]:[];
    return entries.every(entry=>entry.kind!=='folder'||!path.some(folder=>folder.id===entry.id)&&path.length+(heights.get(entry.id)??1)<=3);
  });
}
export function sortLibraryEntries(entries:LibraryEntry[],sort:'visited'|'name') {
  return [...entries].sort((a,b)=>(sort==='visited'?(b.accessedAt??'').localeCompare(a.accessedAt??''):0)||a.name.localeCompare(b.name,'zh-CN')||libraryKey(a).localeCompare(libraryKey(b)));
}
export function libraryAccessLabel(value?:string) {
  if(!value)return '—';
  const date=new Date(value),elapsed=Math.max(0,Date.now()-date.getTime());
  if(!Number.isFinite(date.getTime()))return '—';
  if(elapsed<60000)return '刚刚';
  if(elapsed<3600000)return Math.floor(elapsed/60000)+'分钟前';
  if(elapsed<86400000)return Math.floor(elapsed/3600000)+'小时前';
  if(elapsed<2*86400000)return '昨天';
  return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(date);
}
