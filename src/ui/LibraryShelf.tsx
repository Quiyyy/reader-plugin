import { useMemo,useState } from 'react';
import { ArrowRight,BookOpen,Check,ChevronDown,ChevronRight,LayoutGrid,LayoutList,MoreHorizontal,NotebookPen,Plus,Search,Upload } from 'lucide-react';
import type { BookSummary } from '../shared/types';
import type { NoteSummary,WorkspaceSnapshot } from '../shared/workspace';
import { IconButton } from './IconButton';
import { progressLabel,readingState,readingStates } from './library-presentation';

interface Props {
  books:BookSummary[]; total:number; snapshot:WorkspaceSnapshot; notes:NoteSummary[];
  title:string; query:string; format:string; busy:boolean;
  onQuery:(value:string)=>void; onFormat:(value:string)=>void; onLayout:(value:'cards'|'list')=>void;
  onImport:()=>void; onImportOptions:()=>void; onFiles:(files:File[])=>void;
  onOpen:(id:string)=>void; onManage:(book:BookSummary)=>void;
  onNote:(id:string)=>void; onNewNote:()=>void; onNotes:()=>void;
}

function BookCover({book}:{book:BookSummary}) {
  return <span className={'study-cover tone-'+(parseInt(book.id.slice(0,2),16)%4)} aria-hidden="true"><strong>{book.title}</strong><small>{book.format.toUpperCase()}</small></span>;
}
function Progress({book}:{book:BookSummary}) {
  return <span className="study-book-progress"><span>{readingState(book)==='finished'&&<Check size={12}/>} {progressLabel(book)}</span><span className="study-progress-track" aria-hidden="true"><i style={{width:`${Math.min(100,Math.max(0,book.progress*100))}%`}}/></span></span>;
}
function readDate(book:BookSummary) {
  if(!book.lastReadAt)return '尚未打开';
  const date=new Date(book.lastReadAt);
  return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(date);
}

export function LibraryShelf(props:Props) {
  const {books,total,snapshot,notes,title,query,format,busy}=props;
  const layout=snapshot.layout??'list';
  const [collapsed,setCollapsed]=useState<string[]>([]);
  const counts=useMemo(()=>{
    const sources=new Map(snapshot.sources.map(s=>[s.id,s.bookId])),result=new Map<string,number>();
    for(const note of notes){const ids=new Set(note.sourceIds.map(id=>sources.get(id)).filter((id):id is string=>!!id));if(note.relatedBookId)ids.add(note.relatedBookId);for(const id of ids)result.set(id,(result.get(id)??0)+1);}
    return result;
  },[notes,snapshot.sources]);
  const recentNotes=[...notes].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,4);
  const resume=books.find(book=>readingState(book)==='reading')??books[0];
  return <div className="study-library-workspace" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();props.onFiles([...e.dataTransfer.files]);}}>
    <main className="study-library">
      <header className="study-page-head"><div className="study-library-title"><h1>{title}</h1><span>{books.length} 本</span></div><div><button className="primary-button" disabled={busy} onClick={props.onImport}><Upload size={15}/>导入书籍</button><IconButton label="添加选项" onClick={props.onImportOptions}><Plus size={17}/></IconButton></div></header>
      {resume&&<section className="study-continue" aria-label="最近阅读"><BookCover book={resume}/><div className="study-continue-info"><small>{readingState(resume)==='later'?'开始阅读':readingState(resume)==='finished'?'再读一遍':'继续阅读'}</small><h2>{resume.title}</h2><p>{resume.author||'佚名'}<span> · {resume.format.toUpperCase()}</span></p><Progress book={resume}/></div><button className="secondary-button study-continue-action" disabled={busy} onClick={()=>props.onOpen(resume.id)}>{readingState(resume)==='later'?'开始阅读':readingState(resume)==='finished'?'再次阅读':'接着读'}<ArrowRight size={16}/></button></section>}
      <div className="study-library-filter"><label><Search size={16}/><input type="search" aria-label="搜索书名或作者" placeholder="搜索书名或作者" value={query} onChange={e=>props.onQuery(e.target.value)}/></label><div className="study-format-filter" aria-label="书籍格式">{['all','txt','epub','pdf','online'].map(value=><button key={value} aria-pressed={format===value} className={format===value?'active':''} onClick={()=>props.onFormat(value)}>{value==='all'?'全部':value==='online'?'在线':value.toUpperCase()}</button>)}</div><div className="study-layout-switch" aria-label="书库视图"><IconButton label="切换列表" active={layout==='list'} onClick={()=>props.onLayout('list')}><LayoutList size={16}/></IconButton><IconButton label="切换卡片" active={layout==='cards'} onClick={()=>props.onLayout('cards')}><LayoutGrid size={16}/></IconButton></div></div>
      {!books.length?<div className="study-empty"><BookOpen size={32}/><h2>{total?'没有匹配书籍':'暂无书籍'}</h2>{query||format!=='all'?<button className="text-button" onClick={()=>{props.onQuery('');props.onFormat('all');}}>清除搜索和筛选</button>:<button className="primary-button" disabled={busy} onClick={props.onImport}>导入书籍</button>}</div>:readingStates.map(state=>{
        const group=books.filter(book=>readingState(book)===state.id),closed=collapsed.includes(state.id);
        if(!group.length)return null;
        return <section className="study-book-group" aria-label={state.label} key={state.id}><h2><button aria-expanded={!closed} aria-controls={'book-group-'+state.id} onClick={()=>setCollapsed(previous=>closed?previous.filter(id=>id!==state.id):[...previous,state.id])}>{closed?<ChevronRight size={14}/>:<ChevronDown size={14}/>}<span>{state.label}</span><small>{group.length}</small></button></h2>{!closed&&<div id={'book-group-'+state.id} className={'study-book-grid book-grid '+layout}>{group.map(book=><article className="study-book-card" data-book-id={book.id} key={book.id}><button className="book-card" aria-label={`打开 ${book.title}，${book.author||'佚名'}`} disabled={busy} onClick={()=>props.onOpen(book.id)}><BookCover book={book}/><span className="study-book-info"><strong>{book.title}</strong><small>{book.author||'佚名'}<i>·</i>{book.format==='online'?'在线':book.format.toUpperCase()}<i>·</i>{counts.get(book.id)??0} 篇笔记</small></span><Progress book={book}/><time className="study-book-date" dateTime={book.lastReadAt}>{readDate(book)}</time></button><IconButton label={'管理 '+book.title} onClick={()=>props.onManage(book)}><MoreHorizontal size={16}/></IconButton></article>)}</div>}</section>;
      })}
    </main>
    <aside className="study-library-notes" aria-label="最近的笔记"><header><h2>最近的笔记</h2><IconButton label="新建笔记" onClick={props.onNewNote}><Plus size={17}/></IconButton></header>{recentNotes.length?<div className="study-library-note-list">{recentNotes.map(note=>{
      const bookId=note.relatedBookId??snapshot.sources.find(s=>note.sourceIds.includes(s.id))?.bookId;
      const sourceTitle=snapshot.books[bookId??'']?.title??snapshot.sources.find(s=>s.bookId===bookId)?.title??books.find(b=>b.id===bookId)?.title;
      return <button className="study-library-note" key={note.id} onClick={()=>props.onNote(note.id)}><span className="study-library-note-source"><NotebookPen size={14}/><span>{sourceTitle??'笔记'}</span></span><h3>{note.title||'未命名笔记'}</h3>{note.preview&&<p>{note.preview}</p>}<span className="study-library-note-foot"><span>{new Date(note.updatedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</span><ArrowRight size={14}/></span></button>;
    })}</div>:<div className="study-library-notes-empty"><NotebookPen size={24}/><button className="text-button" onClick={props.onNewNote}>新建笔记 <Plus size={14}/></button></div>}<button className="text-button study-all-notes" onClick={props.onNotes}>全部笔记 <ArrowRight size={14}/></button></aside>
  </div>;
}
