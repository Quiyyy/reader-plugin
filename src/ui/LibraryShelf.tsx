import { useEffect,useState } from 'react';
import { ArrowRight,BookOpen,Check,ChevronDown,ChevronRight,LayoutGrid,LayoutList,MoreHorizontal,NotebookPen,Plus,Search } from 'lucide-react';
import type { BookSummary,ReaderApi } from '../shared/types';
import type { NoteSummary,WorkspaceSnapshot } from '../shared/workspace';
import { IconButton } from './IconButton';
import { NoteListItem } from './NoteListItem';
import { progressLabel,readingState,readingStates } from './library-presentation';

interface Props {
  api:ReaderApi; books:BookSummary[]; total:number; snapshot:WorkspaceSnapshot; notes:NoteSummary[];
  title:string; query:string; busy:boolean;
  onQuery:(value:string)=>void; onLayout:(value:'cards'|'list')=>void;
  onAdd:()=>void; onFiles:(files:File[])=>void;
  onOpen:(id:string)=>void; onManage:(book:BookSummary)=>void;
  onNote:(id:string)=>void; onNewNote:()=>void; onNotes:()=>void;
}

function BookCover({book}:{book:BookSummary}) {
  return <span className={'study-cover tone-'+(parseInt(book.id.slice(0,2),16)%4)} aria-hidden="true"><BookOpen size={19} strokeWidth={1.3}/></span>;
}
function Progress({book}:{book:BookSummary}) {
  return <span className="study-book-progress"><span>{readingState(book)==='finished'&&<Check size={12}/>} {progressLabel(book)}</span><span className="study-progress-track" aria-hidden="true"><i style={{width:`${Math.min(100,Math.max(0,book.progress*100))}%`}}/></span></span>;
}
function ReadingPosition({book,api}:{book:BookSummary;api:ReaderApi}) {
  const [section,setSection]=useState<{id:string;title:string}>();
  useEffect(()=>{
    let cancelled=false;setSection(undefined);
    // Rich EPUB locations are independent of the legacy paragraph locator.
    // Read the saved section; opening this metadata does not save or move it.
    if(book.format==='epub'&&api.epub)void api.epub.open(book.id).then(value=>{
      const resource=value.state.location?.resource??value.legacyLocation?.resource;
      const current=value.package.sections.find(item=>item.path===resource)??(!book.lastReadAt?value.package.sections[0]:undefined);
      if(!cancelled&&current)setSection({id:book.id,title:current.title});
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[api.epub,book.id,book.format,book.lastReadAt]);
  const label=book.format==='epub'?(section?.id===book.id?section.title:''):`第 ${book.locator.chapter+1} ${book.format==='pdf'?'页':'章'}`;
  return label?<span className="study-continue-position" title={label}>{label}</span>:null;
}

export function LibraryShelf(props:Props) {
  const {api,books,total,snapshot,notes,title,query,busy}=props;
  const layout=snapshot.layout??'list';
  const [collapsed,setCollapsed]=useState<string[]>([]);
  const recentNotes=[...notes].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,4);
  const resume=books.find(book=>readingState(book)==='reading')??books[0];
  return <div className="study-library-workspace" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();props.onFiles([...e.dataTransfer.files]);}}>
    <main className="study-library">
      <header className="study-page-head"><h1>{title}</h1><button className={total?'secondary-button study-add-books':'primary-button study-add-books'} aria-label="添加书籍" disabled={busy} onClick={props.onAdd}><Plus size={16}/>添加书籍</button></header>
      {resume&&<section className="study-continue" aria-label="最近阅读"><BookCover book={resume}/><div className="study-continue-info"><h2 title={resume.title}>{resume.title}</h2><ReadingPosition book={resume} api={api}/><Progress book={resume}/></div><button className="primary-button study-continue-action" disabled={busy} onClick={()=>props.onOpen(resume.id)}>{readingState(resume)==='later'?'开始阅读':readingState(resume)==='finished'?'再次阅读':'继续阅读'}<ArrowRight size={16}/></button></section>}
      <div className="study-library-filter"><label><Search size={16}/><input type="search" aria-label="搜索书名或作者" placeholder="搜索书籍" value={query} onChange={e=>props.onQuery(e.target.value)}/></label><div className="study-layout-switch" aria-label="书库视图"><IconButton label="切换列表" active={layout==='list'} onClick={()=>props.onLayout('list')}><LayoutList size={16}/></IconButton><IconButton label="切换卡片" active={layout==='cards'} onClick={()=>props.onLayout('cards')}><LayoutGrid size={16}/></IconButton></div></div>
      {!books.length?<div className="study-empty"><BookOpen size={32}/><h2>{total?'没有匹配书籍':'暂无书籍'}</h2>{query&&<button className="text-button" onClick={()=>props.onQuery('')}>清除搜索</button>}</div>:readingStates.map(state=>{
        const group=books.filter(book=>readingState(book)===state.id),closed=collapsed.includes(state.id);
        if(!group.length)return null;
        return <section className="study-book-group" aria-label={state.label} key={state.id}><h2><button aria-expanded={!closed} aria-controls={'book-group-'+state.id} onClick={()=>setCollapsed(previous=>closed?previous.filter(id=>id!==state.id):[...previous,state.id])}>{closed?<ChevronRight size={14}/>:<ChevronDown size={14}/>}<span>{state.label}</span></button></h2>{!closed&&<div id={'book-group-'+state.id} className={'study-book-grid book-grid '+layout}>{group.map(book=><article className="study-book-card" data-book-id={book.id} key={book.id}><button className="book-card" aria-label={`打开 ${book.title}，${book.author||'佚名'}`} disabled={busy} onClick={()=>props.onOpen(book.id)}><BookCover book={book}/><span className="study-book-info"><strong title={book.title}>{book.title}</strong><Progress book={book}/></span></button><IconButton label={'管理 '+book.title} onClick={()=>props.onManage(book)}><MoreHorizontal size={16}/></IconButton></article>)}</div>}</section>;
      })}
    </main>
    <aside className="study-library-notes" aria-label="最近的笔记"><header><h2>最近的笔记</h2><IconButton label="新建笔记" onClick={props.onNewNote}><Plus size={17}/></IconButton></header>{recentNotes.length?<div className="study-library-note-list">{recentNotes.map(note=><NoteListItem key={note.id} note={note} api={api.study!} sources={snapshot.sources} onOpen={props.onNote}/>)}</div>:<div className="study-library-notes-empty"><NotebookPen size={24}/></div>}<button className="text-button study-all-notes" onClick={props.onNotes}>全部笔记 <ArrowRight size={14}/></button></aside>
  </div>;
}
