import { useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode } from 'react';
import { Check,ChevronDown,ChevronRight,FolderPlus,LayoutGrid,LayoutList,NotebookPen,Pencil,Plus,Search,Upload,X } from 'lucide-react';
import type { BookSummary,ReaderApi } from '../shared/types';
import type { Folder,Mutation,WorkspaceSnapshot } from '../shared/workspace';
import { IconButton } from './IconButton';
import { errorText,Modal } from './study-ui';
import { folderPath,libraryAccessLabel,libraryEntries,libraryKey,moveDestinations,sortLibraryEntries,type LibraryEntry } from './library-entries';
import './library.css';

interface Props {
  api:ReaderApi; books:BookSummary[]; snapshot:WorkspaceSnapshot; title:string; query:string; busy:boolean;
  folderId:string|null; sort:'visited'|'name';
  onQuery:(value:string)=>void; onFolder:(id:string|null)=>void; onSort:(value:'visited'|'name')=>void;
  onLayout:(value:'cards'|'list')=>Promise<unknown>; onImport:()=>void; onImportOptions:()=>void; onDiscover?:()=>void;
  onFiles:(files:File[])=>void; onOpen:(id:string)=>void; onManage:(book:BookSummary)=>void;
  onNote:(id:string)=>void; onNewNote:()=>void; onChanged:()=>Promise<unknown>; onNotice:(message:string,undoId?:string)=>void;
}
type Menu={kind:'new'|'view'|'item';anchor:HTMLButtonElement;entry?:LibraryEntry};
type Edit={kind:'folder'}|{kind:'rename';entry:LibraryEntry}|{kind:'move';entries:LibraryEntry[]};

function LibraryMenu({anchor,onClose,children}:{anchor:HTMLButtonElement;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const menu=ref.current!,rect=anchor.getBoundingClientRect(),box=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.right-box.width))+'px';
    menu.style.top=(rect.bottom+box.height+6<=innerHeight-8?rect.bottom+6:Math.max(8,rect.top-box.height-6))+'px';
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const close=()=>onClose(),scroll=(event:Event)=>{if(!(event.target instanceof Node)||!menu.contains(event.target))onClose();};
    window.addEventListener('resize',close);window.addEventListener('scroll',scroll,true);
    return()=>{window.removeEventListener('resize',close);window.removeEventListener('scroll',scroll,true);if(anchor.isConnected)anchor.focus({preventScroll:true});};
  },[anchor]);
  return <><button type="button" className="library-menu-scrim" aria-label="关闭整理菜单" onClick={onClose}/><div className="library-menu" role="menu" aria-label="整理菜单" ref={ref} onKeyDown={event=>{
    event.stopPropagation();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='Escape'){event.preventDefault();onClose();}
    else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1)+buttons.length)%buttons.length]?.focus();}
    else if(event.key==='Tab'&&(event.shiftKey&&index===0||!event.shiftKey&&index===buttons.length-1)){event.preventDefault();(event.shiftKey?buttons.at(-1):buttons[0])?.focus();}
  }}>{children}</div></>;
}
function NoteCover({entry,api,snapshot}:{entry:LibraryEntry;api:ReaderApi;snapshot:WorkspaceSnapshot}) {
  const note=entry.note!,imageId=note.imageIds[0]??snapshot.sources.find(source=>note.sourceIds.includes(source.id)&&source.imageId)?.imageId;
  const ref=useRef<HTMLSpanElement>(null),[image,setImage]=useState<{id:string;url:string}>();
  useEffect(()=>{
    let cancelled=false;setImage(undefined);if(!imageId)return;
    const load=()=>{void api.study!.asset(imageId).then(value=>{if(!cancelled)setImage({id:imageId,url:`data:${value.mimeType};base64,${value.data}`});}).catch(()=>{});};
    if(typeof IntersectionObserver==='undefined'){load();return()=>{cancelled=true;};}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();load();}},{root:ref.current?.closest('.library-shelf'),rootMargin:'120px'});
    if(ref.current)observer.observe(ref.current);return()=>{cancelled=true;observer.disconnect();};
  },[imageId,api.study]);
  const preview=note.preview.trim();
  return <span ref={ref} className={'library-art library-notebook '+(!preview&&!imageId?'blank':'')} aria-hidden="true">{image&&image.id===imageId?<img src={image.url} alt=""/>:preview?<><strong>{entry.name}</strong><span className="library-page-preview">{preview}</span></>:<span className="library-blank-label"/>}</span>;
}
function EntryCover({entry,api,snapshot}:{entry:LibraryEntry;api:ReaderApi;snapshot:WorkspaceSnapshot}) {
  if(entry.kind==='note')return <NoteCover entry={entry} api={api} snapshot={snapshot}/>;
  const tone=parseInt(entry.id.slice(0,2),16)%2;
  if(entry.kind==='folder')return <span className={'library-art library-folder tone-'+tone} aria-hidden="true"/>;
  return <span className={'library-art library-cover tone-'+tone} aria-hidden="true"><strong>{entry.name.split(/[,，]/)[0]}</strong></span>;
}

export function LibraryShelf(props:Props) {
  const {api,books,snapshot,folderId,query,busy}=props,study=api.study!,layout=snapshot.layout??'cards';
  const [menu,setMenu]=useState<Menu>(),[edit,setEdit]=useState<Edit>(),[name,setName]=useState(''),[destination,setDestination]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState(''),[selecting,setSelecting]=useState(false),[selected,setSelected]=useState<Set<string>>(new Set());
  const operation=useRef(false);
  const entries=useMemo(()=>libraryEntries(books,snapshot),[books,snapshot]);
  const path=useMemo(()=>folderPath(folderId,snapshot.folders),[folderId,snapshot.folders]);
  const visible=useMemo(()=>sortLibraryEntries(entries.filter(entry=>entry.parentId===folderId&&(!query.trim()||(entry.name+' '+(entry.book?.author??'')+' '+(entry.book?snapshot.books[entry.id]?.tags.join(' ')??'':entry.note?.tags.join(' ')??'')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))),props.sort),[entries,folderId,query,props.sort,snapshot.books]);
  const selectedEntries=visible.filter(entry=>selected.has(libraryKey(entry)));
  const targets=useMemo(()=>edit?.kind==='move'?moveDestinations(edit.entries,snapshot.folders):[],[edit,snapshot.folders]);
  const disabled=busy||working;
  useEffect(()=>{setSelected(new Set());setSelecting(false);setMenu(undefined);},[folderId,query]);
  useEffect(()=>{if(folderId&&!snapshot.folders.some(folder=>folder.id===folderId&&!folder.trashedAt))props.onFolder(null);},[folderId,snapshot.folders]);
  useEffect(()=>{const keys=new Set(visible.map(libraryKey));setSelected(previous=>{const next=new Set([...previous].filter(key=>keys.has(key)));return next.size===previous.size?previous:next;});},[visible]);
  const openEdit=(next:Edit)=>{setMenu(undefined);setError('');setEdit(next);setName(next.kind==='rename'?next.entry.name:'');setDestination(folderId??'');};
  const run=async(work:()=>Promise<Mutation<unknown>>,message:string)=>{
    if(disabled||operation.current)return;operation.current=true;setWorking(true);setError('');let saved=false;
    try{const result=await work();saved=true;setEdit(undefined);setSelected(new Set());setSelecting(false);props.onNotice(message,result.undoId);await props.onChanged();}
    catch(reason){setError((saved?'已保存，但刷新失败：':'')+errorText(reason));}
    finally{operation.current=false;setWorking(false);}
  };
  const saveName=()=>{
    const title=name.trim();if(!edit||!title)return;
    if(edit.kind==='folder')return run(()=>study.call('reader_folder_save',{name:title,parentId:folderId}),'已创建文件夹');
    if(edit.kind!=='rename')return;const entry=edit.entry;
    return run(()=>entry.kind==='folder'?study.call('reader_folder_save',{id:entry.id,revision:entry.revision,name:title,parentId:entry.folder!.parentId}):entry.kind==='note'?study.call('reader_note_update',{id:entry.id,revision:entry.revision,patch:{title}}):study.call('reader_book_metadata',{id:entry.id,revision:entry.revision,metadata:{title,folderId:entry.parentId,tags:snapshot.books[entry.id]?.tags??[]}}),'已重命名');
  };
  const activate=(entry:LibraryEntry)=>{if(selecting){setSelected(previous=>{const next=new Set(previous),key=libraryKey(entry);if(next.has(key))next.delete(key);else next.add(key);return next;});return;}if(entry.kind==='folder')props.onFolder(entry.id);else if(entry.kind==='book')props.onOpen(entry.id);else props.onNote(entry.id);};
  const changeLayout=async(value:'cards'|'list')=>{setMenu(undefined);setWorking(true);try{await props.onLayout(value);}catch(reason){setError(errorText(reason));}finally{setWorking(false);}};
  return <main className="library-shelf" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!disabled)props.onFiles([...event.dataTransfer.files]);}}>
    {!!path.length&&<nav className="library-path" aria-label="文件夹路径"><button type="button" onClick={()=>props.onFolder(null)}>{props.title}</button>{path.slice(0,-1).map(folder=><span key={folder.id}><ChevronRight size={12}/><button type="button" onClick={()=>props.onFolder(folder.id)}>{folder.name}</button></span>)}</nav>}
    <header className="study-page-head library-heading"><h1>{path.at(-1)?.name??props.title}</h1><button type="button" className="primary-button library-new" aria-label="新建" aria-haspopup="menu" disabled={disabled} onClick={event=>setMenu({kind:'new',anchor:event.currentTarget})}><Plus size={17}/>新建</button></header>
    <div className="library-toolbar">{selecting?<button type="button" className="text-button" disabled={disabled||!selectedEntries.length} onClick={()=>openEdit({kind:'move',entries:selectedEntries})}>移动</button>:<select aria-label="书架排序" value={props.sort} onChange={event=>props.onSort(event.target.value as 'visited'|'name')}><option value="visited">最近访问</option><option value="name">名称</option></select>}<div className="library-tools"><label className="library-search"><Search size={16}/><input type="search" value={query} onChange={event=>props.onQuery(event.target.value)} placeholder="搜索" aria-label="搜索书籍、笔记和文件夹"/></label><IconButton label="视图选项" aria-haspopup="menu" disabled={disabled} onClick={event=>setMenu({kind:'view',anchor:event.currentTarget})}>{layout==='cards'?<LayoutGrid size={18}/>:<LayoutList size={18}/>}</IconButton><button type="button" className="text-button" disabled={disabled} onClick={()=>{setSelecting(!selecting);setSelected(new Set());}}>{selecting?'完成':'选择'}</button></div></div>
    {error&&!edit&&<div className="error-notice" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={()=>setError('')}><X size={15}/></IconButton></div>}
    <div className={'library-grid book-grid '+layout} role="list" aria-label="文件夹、书籍和笔记本">{visible.map(entry=>{
      const checked=selected.has(libraryKey(entry)),label=selecting?`选择${entry.kind==='folder'?'文件夹':entry.kind==='note'?'笔记本':'书籍'} ${entry.name}`:entry.kind==='book'?`打开 ${entry.name}，${entry.book!.author||'佚名'}`:`打开${entry.kind==='folder'?'文件夹':'笔记本'} ${entry.name}`;
      return <article className={'library-entry '+entry.kind+(checked?' selected':'')} role="listitem" key={libraryKey(entry)} data-entry-id={libraryKey(entry)} data-book-id={entry.book?.id} data-note-id={entry.note?.id} data-folder-id={entry.folder?.id}><button type="button" className={'library-open '+(entry.kind==='book'?'book-card':'')} aria-label={label} aria-pressed={selecting?checked:undefined} disabled={disabled} onClick={()=>activate(entry)}><EntryCover entry={entry} api={api} snapshot={snapshot}/>{selecting&&<span className="library-selection" aria-hidden="true">{checked&&<Check size={16}/>}</span>}</button><button type="button" className="library-caption" aria-label={'管理 '+entry.name} aria-haspopup="menu" title={entry.name} disabled={disabled} onClick={event=>setMenu({kind:'item',anchor:event.currentTarget,entry})}><span>{entry.name}</span><ChevronDown size={12}/></button><time className="library-access" dateTime={entry.accessedAt} title={entry.accessedAt?new Date(entry.accessedAt).toLocaleString('zh-CN'):'尚未记录访问'}>{libraryAccessLabel(entry.accessedAt)}</time></article>;
    })}</div>
    {!visible.length&&<div className="library-empty">{query?'没有匹配内容':folderId?'空文件夹':'暂无内容'}</div>}
    {menu&&<LibraryMenu anchor={menu.anchor} onClose={()=>setMenu(undefined)}>{menu.kind==='new'?<>
      <button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onNewNote();}}><NotebookPen size={16}/>笔记本</button>
      <button role="menuitem" type="button" onClick={()=>openEdit({kind:'folder'})}><FolderPlus size={16}/>文件夹</button>
      <button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onImport();}}><Upload size={16}/>导入书籍</button>
      {props.onDiscover&&<button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onDiscover!();}}><Search size={16}/>在线找书</button>}
      <button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onImportOptions();}}>导入选项</button>
    </>:menu.kind==='view'?<><button role="menuitemradio" aria-checked={layout==='cards'} type="button" onClick={()=>void changeLayout('cards')}><LayoutGrid size={16}/>网格视图{layout==='cards'&&<Check size={15}/>}</button><button role="menuitemradio" aria-checked={layout==='list'} type="button" onClick={()=>void changeLayout('list')}><LayoutList size={16}/>列表视图{layout==='list'&&<Check size={15}/>}</button></>:<>
      <button role="menuitem" type="button" onClick={()=>openEdit({kind:'rename',entry:menu.entry!})}><Pencil size={16}/>重命名</button>
      <button role="menuitem" type="button" onClick={()=>openEdit({kind:'move',entries:[menu.entry!]})}><FolderPlus size={16}/>移动</button>
      {menu.entry?.book&&<button role="menuitem" type="button" onClick={()=>{props.onManage(menu.entry!.book!);setMenu(undefined);}}>书籍信息</button>}
    </>}</LibraryMenu>}
    {edit&&<Modal title={edit.kind==='folder'?'新建文件夹':edit.kind==='move'?'移动到':'重命名'} error={error} onClose={()=>{if(!working)setEdit(undefined);}}>{edit.kind==='move'?<form onSubmit={event=>{event.preventDefault();void run(()=>study.call('reader_library_move',{items:edit.entries.map(({kind,id,revision})=>({kind,id,revision})),folderId:destination||null}),'已移动');}}><label>文件夹<select aria-label="目标文件夹" value={destination} disabled={working} onChange={event=>setDestination(event.target.value)}>{targets.map(folder=><option key={folder?.id??'root'} value={folder?.id??''}>{folder?folderPath(folder.id,snapshot.folders).map(item=>item.name).join(' / '):props.title}</option>)}</select></label><div className="dialog-actions"><button type="button" disabled={working} onClick={()=>setEdit(undefined)}>取消</button><button type="submit" className="primary-button" disabled={working||!targets.some(folder=>(folder?.id??'')===destination)||edit.entries.every(entry=>entry.parentId===(destination||null))}>{working?'移动中…':'移动'}</button></div></form>:<form onSubmit={event=>{event.preventDefault();void saveName();}}><label>名称<input aria-label="名称" value={name} maxLength={edit.kind==='folder'||edit.kind==='rename'&&edit.entry.kind==='folder'?80:240} required autoFocus disabled={working} onChange={event=>setName(event.target.value)}/></label><div className="dialog-actions"><button type="button" disabled={working} onClick={()=>setEdit(undefined)}>取消</button><button type="submit" className="primary-button" disabled={working||!name.trim()}>{working?'保存中…':'完成'}</button></div></form>}</Modal>}
  </main>;
}
