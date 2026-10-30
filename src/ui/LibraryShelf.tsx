import { useEffect,useMemo,useRef,useState } from 'react';
import { ArrowLeft,BookOpen,Check,CheckSquare2,ChevronDown,ChevronRight,Download,Folder,FolderInput,FolderPlus,LayoutGrid,LayoutList,MoreHorizontal,NotebookPen,Pencil,Plus,Search,Trash2,Upload,X } from 'lucide-react';
import type { BookSummary,ReaderApi } from '../shared/types';
import type { Mutation,WorkspaceSnapshot } from '../shared/workspace';
import { IconButton } from './IconButton';
import { errorText,Modal } from './study-ui';
import { filterLibraryEntries,folderPath,libraryAccessLabel,libraryEntries,libraryKey,moveDestinations,sortLibraryEntries,type LibraryEntry } from './library-entries';
import './library.css';
import { LibraryMenu } from './LibraryMenu';
import { useLibraryDrag } from './useLibraryDrag';

interface Props {
  api:ReaderApi; books:BookSummary[]; snapshot:WorkspaceSnapshot; title:string; query:string; busy:boolean;
  folderId:string|null; sort:'visited'|'name';
  onFullSearch:(query:string)=>void; onQuery:(value:string)=>void; onFolder:(id:string|null)=>void; onSort:(value:'visited'|'name')=>void;
  onLayout:(value:'cards'|'list')=>Promise<unknown>; onImport:()=>void; onImportOptions:()=>void; onDiscover?:()=>void;
  onFiles:(files:File[])=>void; onOpen:(id:string)=>void; onManage:(book:BookSummary)=>void;
  onTrash:(entries:LibraryEntry[])=>void; onNote:(id:string)=>void; onNewNote:()=>void; onChanged:()=>Promise<unknown>; onNotice:(message:string,undoId?:string)=>void;
}
type Menu={kind:'new'|'item';anchor:HTMLButtonElement;entry?:LibraryEntry};
type Edit={kind:'folder'}|{kind:'rename';entry:LibraryEntry}|{kind:'move';entries:LibraryEntry[]};

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
  return <span ref={ref} className={'library-art library-notebook'+(image&&image.id===imageId?' has-image':'')} aria-hidden="true">{image&&image.id===imageId?<img src={image.url} alt="" draggable={false}/>:<><span className="library-notebook-emblem"><NotebookPen size={20} strokeWidth={1.35}/></span><span className="library-notebook-lines"><i/><i/><i/></span></>}</span>;
}
function EntryCover({entry,api,snapshot}:{entry:LibraryEntry;api:ReaderApi;snapshot:WorkspaceSnapshot}) {
  if(entry.kind==='note')return <NoteCover entry={entry} api={api} snapshot={snapshot}/>;
  const tone=0;
  if(entry.kind==='folder')return <span className={'library-art library-folder tone-'+tone} aria-hidden="true"><Folder size={18}/></span>;
  return <span className={'library-art library-cover tone-'+tone} aria-hidden="true"><BookOpen size={23}/><span className="library-cover-lines"/>{entry.book?.cloudOnly&&<span className="library-cloud-mark" title={entry.book.cloudAvailable?'打开时下载原文':'原文件尚未上传'}><Download size={13}/></span>}</span>;
}

export function LibraryShelf(props:Props) {
  const {api,books,snapshot,folderId,query,busy}=props,study=api.study!,layout=snapshot.layout??'cards';
  const [menu,setMenu]=useState<Menu>(),[edit,setEdit]=useState<Edit>(),[name,setName]=useState(''),[destination,setDestination]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState(''),[selecting,setSelecting]=useState(false),[selected,setSelected]=useState<Set<string>>(new Set());
  const operation=useRef(false),shelf=useRef<HTMLElement>(null);
  const entries=useMemo(()=>libraryEntries(books,snapshot),[books,snapshot]);
  const path=useMemo(()=>folderPath(folderId,snapshot.folders),[folderId,snapshot.folders]);
  const visible=useMemo(()=>sortLibraryEntries(filterLibraryEntries(entries,snapshot,folderId,query),props.sort),[entries,folderId,query,props.sort,snapshot]);
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
  const drag=useLibraryDrag({root:shelf,folders:snapshot.folders,disabled,folderId,query,selected:selectedEntries,onMove:(items,target)=>{setMenu(undefined);void run(()=>study.call('reader_library_move',{items:items.map(({kind,id,revision})=>({kind,id,revision})),folderId:target}),'已移动');}});
  const activate=(entry:LibraryEntry)=>{if(drag.suppressClick())return;if(selecting){setSelected(previous=>{const next=new Set(previous),key=libraryKey(entry);if(next.has(key))next.delete(key);else next.add(key);return next;});return;}if(entry.kind==='folder')props.onFolder(entry.id);else if(entry.kind==='book')props.onOpen(entry.id);else props.onNote(entry.id);};
  const changeLayout=async(value:'cards'|'list')=>{if(disabled||operation.current||value===layout)return;operation.current=true;setMenu(undefined);setWorking(true);try{await props.onLayout(value);}catch(reason){setError(errorText(reason));}finally{operation.current=false;setWorking(false);}};
  return <main className={'library-shelf'+(drag.count?' is-dragging':'')} ref={shelf} onPointerDownCapture={drag.resumeClick} onKeyDownCapture={event=>{if(event.key==='Enter'||event.key===' ')drag.resumeClick();if(event.key==='Escape'&&selecting&&!edit&&!menu){event.preventDefault();setSelecting(false);setSelected(new Set());}}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}else drag.surface.onDragOver(event);}} onDragLeave={drag.surface.onDragLeave} onDrop={event=>{event.preventDefault();if(!drag.surface.onDrop(event)&&!disabled&&event.dataTransfer.files.length)props.onFiles([...event.dataTransfer.files]);}}>
    <div className="library-header">
      <header className="library-heading">
        <div className="library-location">{!!path.length&&<IconButton label="返回上一级" className={drag.isOver(path.at(-2)?.id??null)?'drop-over':''} {...drag.target(path.at(-2)?.id??null)} disabled={disabled} onClick={()=>props.onFolder(path.at(-2)?.id??null)}><ArrowLeft size={17}/></IconButton>}
          <nav className="library-path" aria-label="文件夹路径">
            {!!path.length&&<><button type="button" className={drag.isOver(null)?'drop-over':''} {...drag.target(null)} onClick={()=>props.onFolder(null)}>{props.title}</button><ChevronRight size={13}/></>}
            {path.slice(0,-1).map(folder=><span key={folder.id}><button type="button" className={drag.isOver(folder.id)?'drop-over':''} {...drag.target(folder.id)} onClick={()=>props.onFolder(folder.id)}>{folder.name}</button><ChevronRight size={13}/></span>)}
            <h1 title={path.at(-1)?.name??props.title}>{path.at(-1)?.name??props.title}</h1>
          </nav>
        </div>
        <button type="button" className="primary-button library-new" aria-label="新建" aria-haspopup="menu" disabled={disabled} onClick={event=>setMenu({kind:'new',anchor:event.currentTarget})}><Plus size={16}/>新建</button>
      </header>
      <div className={'library-toolbar'+(selecting?' is-selecting':'')}>
        {selecting?<div className="library-selection-actions"><button type="button" className="library-action" disabled={disabled||!visible.length} onClick={()=>setSelected(new Set(selectedEntries.length===visible.length?[]:visible.map(libraryKey)))}>{selectedEntries.length===visible.length?'取消全选':'全选'}</button><span role="status">已选 {selectedEntries.length} 项</span><button type="button" className="library-action" disabled={disabled||!selectedEntries.length} onClick={()=>openEdit({kind:'move',entries:selectedEntries})}><FolderInput size={16}/>移动</button><IconButton label="移到回收站" disabled={disabled||!selectedEntries.length} onClick={()=>props.onTrash(selectedEntries)}><Trash2 size={16}/></IconButton></div>:<label className="library-search"><Search size={15}/><input type="search" value={query} onChange={event=>props.onQuery(event.target.value)} placeholder="搜索" aria-label="搜索书籍、笔记和文件夹" title="按 Enter 搜索全部内容" onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&query.trim()){event.preventDefault();props.onFullSearch(query);}}}/>{!!query.trim()&&<IconButton label="搜索全部内容" onClick={()=>props.onFullSearch(query)}><Search size={14}/></IconButton>}{query&&<button type="button" aria-label="清除搜索" onClick={()=>props.onQuery('')}><X size={14}/></button>}</label>}
        <div className="library-tools">
          {!selecting&&<><label className="library-sort"><select aria-label="书架排序" value={props.sort} onChange={event=>props.onSort(event.target.value as 'visited'|'name')}><option value="visited">最近访问</option><option value="name">名称</option></select><ChevronDown size={13}/></label><div className="library-view-switch" role="group" aria-label="书库视图"><IconButton label="网格视图" active={layout==='cards'} disabled={disabled} onClick={()=>void changeLayout('cards')}><LayoutGrid size={16}/></IconButton><IconButton label="列表视图" active={layout==='list'} disabled={disabled} onClick={()=>void changeLayout('list')}><LayoutList size={16}/></IconButton></div></>}
          <button type="button" className="library-action library-select" disabled={disabled} aria-pressed={selecting} onClick={()=>{setSelecting(!selecting);setSelected(new Set());}}>{selecting?<X size={15}/>:<CheckSquare2 size={15}/>}<span>{selecting?'完成':'选择'}</span></button>
        </div>
      </div>
    </div>
    {error&&!edit&&<div className="error-notice" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={()=>setError('')}><X size={15}/></IconButton></div>}
    <div className={'library-grid book-grid '+layout} role="list" aria-label="文件夹、书籍和笔记">{visible.map(entry=>{
      const checked=selected.has(libraryKey(entry)),label=selecting?`选择${entry.kind==='folder'?'文件夹':entry.kind==='note'?'笔记':'书籍'} ${entry.name}`:entry.kind==='book'?`打开 ${entry.name}，${entry.book!.author||'佚名'}`:`打开${entry.kind==='folder'?'文件夹':'笔记'} ${entry.name}`;
      return <article className={'library-entry '+entry.kind+(checked?' selected':'')+(drag.isDragging(entry)?' drag-source':'')+(entry.kind==='folder'&&drag.isOver(entry.id)?' drop-over':'')+(entry.kind==='folder'&&drag.canDrop(entry.id)?' drop-available':'')} {...(entry.kind==='folder'?drag.target(entry.id):{})} role="listitem" key={libraryKey(entry)} data-entry-id={libraryKey(entry)} data-book-id={entry.book?.id} data-note-id={entry.note?.id} data-folder-id={entry.folder?.id}>
        <button type="button" className={'library-open '+(entry.kind==='book'?'book-card':'')} {...drag.source(entry)} aria-label={label} aria-pressed={selecting?checked:undefined} disabled={disabled} onClick={()=>activate(entry)}><EntryCover entry={entry} api={api} snapshot={snapshot}/>{selecting&&<span className="library-selection" aria-hidden="true">{checked&&<Check size={14}/>}</span>}</button>
        <div className="library-caption-row"><button type="button" className="library-caption" title={entry.name} disabled={disabled} onClick={()=>activate(entry)}><span>{entry.name}</span></button><IconButton className="library-item-menu" label={'管理 '+entry.name} aria-haspopup="menu" disabled={disabled} onClick={event=>setMenu({kind:'item',anchor:event.currentTarget,entry})}><MoreHorizontal size={17}/></IconButton></div>
        {query.trim()&&entry.parentId!==folderId&&<span className="library-result-path" title={folderPath(entry.parentId,snapshot.folders).map(f=>f.name).join(' / ')}>{folderPath(entry.parentId,snapshot.folders).map(f=>f.name).join(' / ')||props.title}</span>}
        {entry.accessedAt&&<time className="library-access" dateTime={entry.accessedAt} title={new Date(entry.accessedAt).toLocaleString('zh-CN')}>{libraryAccessLabel(entry.accessedAt)}</time>}
      </article>;
    })}</div>
    {!visible.length&&<div className="library-empty"><span className="library-empty-icon">{query?<Search size={23}/>:<FolderPlus size={25}/>}</span><p>{query?'没有匹配内容':folderId?'文件夹是空的':'书库是空的'}</p><button type="button" className="library-action" disabled={disabled} onClick={event=>query?props.onQuery(''):setMenu({kind:'new',anchor:event.currentTarget})}>{query?'显示全部':<><Plus size={15}/>添加内容</>}</button></div>}
    {drag.count>0&&<div className="library-drag-status" role="status"><FolderInput size={16}/>{drag.count>1?`移动 ${drag.count} 项`:'拖到文件夹或上方路径'}</div>}
    {menu&&<LibraryMenu anchor={menu.anchor} onClose={()=>setMenu(undefined)}>{menu.kind==='new'?<>
      <button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onNewNote();}}><NotebookPen size={16}/>笔记</button>
      <button role="menuitem" type="button" onClick={()=>openEdit({kind:'folder'})}><FolderPlus size={16}/>文件夹</button>
      <button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onImport();}}><Upload size={16}/>导入书籍</button>
      {props.onDiscover&&<button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onDiscover!();}}><Search size={16}/>在线找书</button>}
      <button role="menuitem" type="button" onClick={()=>{setMenu(undefined);props.onImportOptions();}}>导入选项</button>
    </>:<>
      <button role="menuitem" type="button" onClick={()=>openEdit({kind:'rename',entry:menu.entry!})}><Pencil size={16}/>重命名</button>
      <button role="menuitem" type="button" onClick={()=>openEdit({kind:'move',entries:[menu.entry!]})}><FolderPlus size={16}/>移动</button>
      <button role="menuitem" type="button" className="library-menu-danger" onClick={()=>{props.onTrash([menu.entry!]);setMenu(undefined);}}><Trash2 size={16}/>移到回收站</button>
      {menu.entry?.book&&<button role="menuitem" type="button" onClick={()=>{props.onManage(menu.entry!.book!);setMenu(undefined);}}>书籍信息</button>}
    </>}</LibraryMenu>}
    {edit&&<Modal title={edit.kind==='folder'?'新建文件夹':edit.kind==='move'?'移动到':'重命名'} error={error} onClose={()=>{if(!working)setEdit(undefined);}}>{edit.kind==='move'?<form onSubmit={event=>{event.preventDefault();void run(()=>study.call('reader_library_move',{items:edit.entries.map(({kind,id,revision})=>({kind,id,revision})),folderId:destination||null}),'已移动');}}><label>文件夹<select aria-label="目标文件夹" value={destination} disabled={working} onChange={event=>setDestination(event.target.value)}>{targets.map(folder=><option key={folder?.id??'root'} value={folder?.id??''}>{folder?folderPath(folder.id,snapshot.folders).map(item=>item.name).join(' / '):props.title}</option>)}</select></label><div className="dialog-actions"><button type="button" disabled={working} onClick={()=>setEdit(undefined)}>取消</button><button type="submit" className="primary-button" disabled={working||!targets.some(folder=>(folder?.id??'')===destination)||edit.entries.every(entry=>entry.parentId===(destination||null))}>{working?'移动中…':'移动'}</button></div></form>:<form onSubmit={event=>{event.preventDefault();void saveName();}}><label>名称<input aria-label="名称" value={name} maxLength={edit.kind==='folder'||edit.kind==='rename'&&edit.entry.kind==='folder'?80:240} required autoFocus disabled={working} onChange={event=>setName(event.target.value)}/></label><div className="dialog-actions"><button type="button" disabled={working} onClick={()=>setEdit(undefined)}>取消</button><button type="submit" className="primary-button" disabled={working||!name.trim()}>{working?'保存中…':'完成'}</button></div></form>}</Modal>}
  </main>;
}
