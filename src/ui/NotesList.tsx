import { NoteBotIcon } from './NoteBotIcon';
import { useMemo,useRef,useState } from 'react';
import { Bot,FolderInput,MoreHorizontal,Pencil,Plus,Search,Trash2 } from 'lucide-react';
import type { ReaderApi } from '../shared/types';
import type { Mutation,WorkspaceSnapshot } from '../shared/workspace';
import { IconButton } from './IconButton';
import { LibraryMenu } from './LibraryMenu';
import { folderPath,libraryEntries,type LibraryEntry } from './library-entries';
import { NoteListItem } from './NoteListItem';
import { NoteBotManager } from './NoteBotManager';
import { errorText,Modal } from './study-ui';

export function NotesList({onFullSearch,api,snapshot,onNew,onOpen,onTrash,onChanged,onNotice}:{onFullSearch:(query:string)=>void;api:ReaderApi;snapshot:WorkspaceSnapshot;onNew:()=>void;onOpen:(id:string)=>void;onTrash:(entries:LibraryEntry[])=>void;onChanged:()=>Promise<unknown>;onNotice:(text:string,undoId?:string)=>void}) {
  const [query,setQuery]=useState(''),[menu,setMenu]=useState<{anchor:HTMLButtonElement;entry:LibraryEntry}>(),[edit,setEdit]=useState<{kind:'rename'|'move';entry:LibraryEntry}>(),[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [botManager,setBotManager]=useState(false),[botsVisited,setBotsVisited]=useState(false);
  const lock=useRef(false),entries=useMemo(()=>libraryEntries([],snapshot).filter(entry=>entry.kind==='note').sort((a,b)=>b.note!.updatedAt.localeCompare(a.note!.updatedAt)),[snapshot]);
  const text=query.trim().toLocaleLowerCase(),visible=entries.filter(entry=>!text||(entry.name+' '+entry.note!.preview).toLocaleLowerCase().includes(text));
  const begin=(kind:'rename'|'move')=>{setEdit({kind,entry:menu!.entry});setValue(kind==='rename'?menu!.entry.note!.title:menu!.entry.parentId??'');setMenu(undefined);setError('');};
  const save=async()=>{if(!edit||lock.current)return;lock.current=true;setBusy(true);setError('');try{
    const {entry,kind}=edit;const result=await api.study!.call<Mutation<unknown>>(kind==='rename'?'reader_note_update':'reader_library_move',kind==='rename'?{id:entry.id,revision:entry.revision,patch:{title:value.trim()}}:{items:[{kind:'note',id:entry.id,revision:entry.revision}],folderId:value||null});
    await onChanged();setEdit(undefined);onNotice(kind==='rename'?'已重命名':'已移动',result.undoId);
  }catch(reason){setError(errorText(reason));}finally{lock.current=false;setBusy(false);}};
  return <><aside className="study-notes-list" hidden={botManager}><header className="quick-notes-header"><h1>全部笔记</h1><div><IconButton label="管理 Note Bots" onClick={()=>{setBotsVisited(true);setBotManager(true);}}><NoteBotIcon size={18}/></IconButton><button type="button" className="primary-button quick-note-new" aria-label="新建笔记" onClick={onNew}><Plus size={15}/>新建</button></div></header>
    <label className="library-search notes-search"><Search size={15}/><input type="search" aria-label="搜索笔记标题或摘要" placeholder="搜索" value={query} onChange={e=>setQuery(e.target.value)} title="按 Enter 搜索笔记全文" onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&query.trim()){event.preventDefault();onFullSearch(query);}}}/>{!!query.trim()&&<IconButton label="搜索笔记全文" onClick={()=>onFullSearch(query)}><Search size={14}/></IconButton>}</label>
    {error&&!edit&&<p role="alert">{error}</p>}
    {visible.map(entry=><div className="study-note-list-entry" key={entry.id}><NoteListItem note={entry.note!} api={api.study!} sources={snapshot.sources} onOpen={onOpen}/><IconButton label={'管理笔记 '+entry.name} aria-haspopup="menu" onClick={event=>setMenu({anchor:event.currentTarget,entry})}><MoreHorizontal size={17}/></IconButton></div>)}
    {!visible.length&&<p className="panel-empty">{text?'没有匹配内容':'还没有笔记'}</p>}
    {menu&&<LibraryMenu anchor={menu.anchor} onClose={()=>setMenu(undefined)}><button type="button" role="menuitem" onClick={()=>begin('rename')}><Pencil size={16}/>重命名</button><button type="button" role="menuitem" onClick={()=>begin('move')}><FolderInput size={16}/>移动</button><button type="button" role="menuitem" onClick={()=>{onTrash([menu.entry]);setMenu(undefined);}}><Trash2 size={16}/>移到回收站</button></LibraryMenu>}
    {edit&&<Modal title={edit.kind==='rename'?'重命名':'移动到'} error={error} onClose={()=>{if(!lock.current)setEdit(undefined);}}><form onSubmit={e=>{e.preventDefault();void save();}}>{edit.kind==='rename'?<label>名称<input aria-label="笔记名称" value={value} maxLength={240} required autoFocus disabled={busy} onChange={e=>setValue(e.target.value)}/></label>:<label>文件夹<select aria-label="目标文件夹" value={value} disabled={busy} onChange={e=>setValue(e.target.value)}><option value="">书库</option>{snapshot.folders.filter(f=>!f.trashedAt).map(f=><option key={f.id} value={f.id}>{folderPath(f.id,snapshot.folders).map(p=>p.name).join(' / ')}</option>)}</select></label>}<div className="dialog-actions"><button type="button" disabled={busy} onClick={()=>setEdit(undefined)}>取消</button><button type="submit" className="primary-button" disabled={busy||edit.kind==='rename'&&!value.trim()}>完成</button></div></form></Modal>}
  </aside>{botsVisited&&<NoteBotManager api={api.study!} active={botManager} onClose={()=>setBotManager(false)} onChanged={()=>{}}/>}</>;
}
