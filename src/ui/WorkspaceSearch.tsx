import {useEffect,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {ArrowUpRight,BookOpen,FileText,Folder,Highlighter,LoaderCircle,NotebookPen,Search,X} from 'lucide-react';
import type {BookSummary} from '../shared/types';
import type {SearchHit,WorkspaceApi,WorkspaceSnapshot} from '../shared/workspace';
import {folderPath,libraryAccessLabel,libraryEntries,sortLibraryEntries} from './library-entries';
import {SearchText} from './SearchText';
import {IconButton} from './IconButton';
import {errorText} from './study-ui';
import './workspace-search.css';

export type SearchKind='all'|SearchHit['kind'];
const kinds:Array<{id:SearchKind;label:string}>=[{id:'all',label:'全部'},{id:'book',label:'书籍'},{id:'note',label:'笔记'},{id:'annotation',label:'批注'},{id:'passage',label:'原文'}];
const icons={book:BookOpen,note:NotebookPen,annotation:Highlighter,passage:FileText};
interface Props {api:WorkspaceApi;snapshot:WorkspaceSnapshot;books:BookSummary[];query:string;kind:SearchKind;folder:string;onQuery:(value:string)=>void;onKind:(value:SearchKind)=>void;onFolder:(value:string)=>void;onOpen:(hit:SearchHit)=>void;}
export function WorkspaceSearch({api,snapshot,books,query,kind,folder,onQuery,onKind,onFolder,onOpen}:Props){
  const [hits,setHits]=useState<SearchHit[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[page,setPage]=useState({identity:'',count:20}),[retry,setRetry]=useState(0),[composing,setComposing]=useState(false);
  const input=useRef<HTMLInputElement>(null),results=useRef<HTMLDivElement>(null),root=useRef<HTMLElement>(null),header=useRef<HTMLElement>(null);
  const text=query.trim(),identity=JSON.stringify([text,kind,folder]);
  const [resolved,setResolved]=useState('');
  const limit=page.identity===identity?page.count:20;
  useEffect(()=>{if(root.current)root.current.scrollTop=0;},[identity]);
  useEffect(()=>{const measure=()=>root.current?.style.setProperty('--search-header-height',`${(header.current?.offsetHeight??0)+8}px`);const observer=new ResizeObserver(measure);if(header.current)observer.observe(header.current);measure();return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let cancelled=false;setError('');
    if(!text||composing){setHits([]);setLoading(false);setResolved('');return;}
    setLoading(true);const count=limit;
    const timer=setTimeout(()=>void api.call<SearchHit[]>('reader_workspace_search',{query:text,limit:count+1,...(kind==='all'?{}:{kind}),...(folder==='all'?{}:{folderId:folder==='root'?null:folder})}).then(value=>{if(!cancelled){setHits(value);setResolved(identity);}}).catch(reason=>{if(!cancelled){setError(errorText(reason));setHits([]);setResolved(identity);}}).finally(()=>{if(!cancelled)setLoading(false);}),240);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[api,text,kind,folder,limit,retry,composing]);
  const folders=snapshot.folders.filter(value=>!value.trashedAt),folderNames=new Map(folders.map(value=>[value.id,folderPath(value.id,folders).map(item=>item.name).join(' / ')]));
  const path=(hit:SearchHit)=>{const name=folderNames.get(hit.kind==='note'?snapshot.notes.find(note=>note.id===hit.id)?.folderId??'':snapshot.books[hit.source?.bookId??hit.id]?.folderId??'')??'';return name===folderNames.get(folder)?'':name;};
  const recent=useMemo(()=>sortLibraryEntries(libraryEntries(books,snapshot),'visited').filter(entry=>entry.kind!=='folder'&&entry.accessedAt&&(kind==='all'||entry.kind===kind)&&(folder==='all'||folder==='root'&&!entry.parentId||folderPath(entry.parentId,snapshot.folders).some(value=>value.id===folder))).slice(0,6),[books,snapshot,kind,folder]);
  const visible=resolved===identity?hits.slice(0,limit):[],hasMore=resolved===identity&&hits.length>limit;
  const buttons=()=>Array.from(results.current?.querySelectorAll<HTMLButtonElement>('.workspace-search-result')??[]);
  const navigate=(event:KeyboardEvent)=>{
    if(event.nativeEvent.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
    const list=buttons(),index=list.indexOf(event.target as HTMLButtonElement);
    if(event.key==='ArrowDown'){event.preventDefault();list[Math.min(index+1,list.length-1)]?.focus();}
    else if(event.key==='ArrowUp'){event.preventDefault();if(index<=0)input.current?.focus();else list[index-1]?.focus();}
    else if(event.key==='Escape'){event.preventDefault();input.current?.focus();}
  };
  const clear=()=>{onQuery('');input.current?.focus();};
  return <main ref={root} className="study-search workspace-search" aria-label="书库搜索">
    <header ref={header} className="workspace-search-header"><h1>搜索</h1><div className="workspace-search-input"><Search size={19}/><input ref={input} type="search" aria-label="搜索书籍、批注和笔记" value={query} maxLength={200} placeholder="搜索书籍、笔记、批注或原文" autoFocus onChange={event=>onQuery(event.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='ArrowDown'&&buttons().length){event.preventDefault();buttons()[0]?.focus();}else if(event.key==='Escape'&&query){event.preventDefault();clear();}}}/>{query&&<IconButton label="清除搜索" onClick={clear}><X size={16}/></IconButton>}</div>
      <div className="workspace-search-filters"><div className="workspace-search-kinds" role="group" aria-label="搜索范围">{kinds.map(value=><button type="button" key={value.id} aria-pressed={kind===value.id} onClick={()=>onKind(value.id)}>{value.label}</button>)}</div><label className="workspace-search-folder"><Folder size={15}/><select aria-label="搜索文件夹" value={folder} onChange={event=>onFolder(event.target.value)}><option value="all">所有文件夹</option><option value="root">未分类</option>{folders.map(value=><option key={value.id} value={value.id}>{folderNames.get(value.id)}</option>)}</select></label></div>
    </header>
    <div className="workspace-search-content" ref={results} onKeyDown={navigate} aria-busy={loading}>
      {!text&&<><h2>最近访问</h2>{recent.map(entry=>{const Icon=entry.kind==='note'?NotebookPen:BookOpen;return <button type="button" key={entry.kind+entry.id} className="workspace-search-result is-recent" onClick={()=>onOpen({kind:entry.kind as 'book'|'note',id:entry.id,title:entry.name,text:''})}><span className="workspace-search-icon"><Icon size={19}/></span><span className="workspace-search-copy"><strong>{entry.name}</strong>{entry.parentId&&<small>{folderNames.get(entry.parentId)}</small>}</span><time dateTime={entry.accessedAt}>{libraryAccessLabel(entry.accessedAt)}</time><ArrowUpRight className="workspace-search-open" size={16}/></button>;})}{!recent.length&&<div className="workspace-search-empty"><Search size={25}/><p>输入关键词，查找你的内容</p></div>}</>}
      {text&&visible.map((hit,index)=>{const Icon=icons[hit.kind];return <button type="button" className="workspace-search-result study-search-hit" key={`${hit.kind}:${hit.id}:${index}`} onClick={()=>onOpen(hit)}><span className="workspace-search-icon" title={kinds.find(value=>value.id===hit.kind)?.label}><Icon size={19}/></span><span className="workspace-search-copy"><strong><SearchText text={hit.title} query={text}/></strong>{hit.text&&<span className="workspace-search-excerpt"><SearchText text={hit.text} query={text}/></span>}{path(hit)&&<small>{path(hit)}</small>}</span><ArrowUpRight className="workspace-search-open" size={16}/></button>;})}
      {loading&&<div className="workspace-search-progress" role="status"><LoaderCircle className="spin" size={17}/><span>正在搜索</span></div>}
      {error&&<div className="workspace-search-empty" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={()=>setRetry(value=>value+1)}>重试</button></div>}
      {!!text&&!loading&&!error&&resolved===identity&&!visible.length&&<div className="workspace-search-empty" role="status"><Search size={25}/><p>没有匹配内容</p>{(kind!=='all'||folder!=='all')&&<button type="button" className="secondary-button" onClick={()=>{onKind('all');onFolder('all');}}>搜索全部内容</button>}</div>}
      {hasMore&&!loading&&(limit<200?<button type="button" className="workspace-search-more" onClick={()=>setPage({identity,count:limit+20})}>加载更多</button>:<p className="workspace-search-limit">结果较多，请缩小搜索范围</p>)}
    </div>
  </main>;
}
