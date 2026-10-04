import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, CircleAlert, List, LoaderCircle, Minus, MoreHorizontal, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import { IconButton } from './IconButton';
import { EpubDom } from './epub-dom';
import type { BookDetail, ReaderApi, ReaderSettings } from '../shared/types';
import type { EpubAppearance, EpubLocation, EpubMark, EpubOpen, EpubTarget, EpubToc } from '../shared/epub';
import { editableTarget, eventShortcut, shortcutActions, type KeyboardSettings } from '../shared/keyboard';
import './epub.css';

const message=(e:unknown)=>e instanceof Error?e.message:'暂时无法读取，请重试';
type Panel='toc'|'appearance'|'bookmarks'|'menu'|'search'|null;
interface Props { book:BookDetail; api:ReaderApi; settings:ReaderSettings; keyboard:KeyboardSettings; onBack:()=>Promise<void>; onLegacy:()=>void; onProgress:(progress:number,lastReadAt:string)=>void; }
function Toc({items,resource,fragment,select}: {items:EpubToc[];resource:string;fragment?:string;select:(target:EpubTarget)=>void}){
  return <ul className="epub-toc">{items.map((item,index)=><li key={`${item.target.resource}#${item.target.fragment??''}-${index}`}>
    {item.children.length?<details open><summary><button type="button" className={item.target.resource===resource&&item.target.fragment===fragment?'current':''} onClick={e=>{e.preventDefault();select(item.target);}}>{item.label}</button></summary><Toc items={item.children} resource={resource} fragment={fragment} select={select}/></details>:<button type="button" className={item.target.resource===resource&&item.target.fragment===fragment?'current':''} onClick={()=>select(item.target)}>{item.label}</button>}
  </li>)}</ul>;
}
export function EpubReader({book,api,settings,keyboard,onBack,onLegacy,onProgress}:Props){
  const epub=api.epub!;
  const [opened,setOpened]=useState<EpubOpen>();const openRef=useRef<EpubOpen|undefined>(undefined);
  const [panel,setPanel]=useState<Panel>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [saving,setSaving]=useState(false);
  const [resource,setResource]=useState('');const [appearance,setAppearance]=useState<EpubAppearance>({style:'original',flow:'scroll',fontSize:settings.fontSize});
  const [fragment,setFragment]=useState<string>();
  const [marks,setMarks]=useState<EpubMark[]>([]);const [noteDepth,setNoteDepth]=useState(0);const [image,setImage]=useState<{src:string;alt:string}>();const [query,setQuery]=useState('');
  const [unmatched,setUnmatched]=useState(false);const [resourceErrors,setResourceErrors]=useState<string[]>([]);
  const host=useRef<HTMLDivElement>(null),dom=useRef<EpubDom|undefined>(undefined),dialog=useRef<HTMLDialogElement>(null),popover=useRef<HTMLElement>(null);
  const location=useRef<EpubLocation|undefined>(undefined),pending=useRef<EpubLocation|undefined>(undefined),appearanceRef=useRef(appearance),notes=useRef<EpubLocation[]>([]),active=useRef(true),restoring=useRef(true),request=useRef(0),chain=useRef<Promise<unknown>>(Promise.resolve()),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),intent=useRef(false),navigateRef=useRef<((target:EpubTarget,restore?:EpubLocation,note?:boolean)=>Promise<void>)|undefined>(undefined);
  const progressCallback=useRef(onProgress);progressCallback.current=onProgress;
  const flush=useCallback(async()=>{
    clearTimeout(timer.current);const value=pending.current;if(!value)return chain.current;
    const work=chain.current.catch(()=>{}).then(async()=>{
      if(pending.current!==value)return;
      if(active.current)setSaving(true);
      try{const result=await epub.save(book.summary.id,value,appearanceRef.current);if(pending.current===value)pending.current=undefined;progressCallback.current(result.progress,result.lastReadAt);if(active.current)setError('');}
      catch(e){if(active.current)setError(message(e));throw e;}finally{if(active.current)setSaving(false);}
    });chain.current=work;return work;
  },[epub,book.summary.id]);
  const capture=useCallback(()=>{
    if(restoring.current)return;
    const value=dom.current?.location();if(!value)return;location.current=value;
    if(intent.current&&!notes.current.length){pending.current=value;clearTimeout(timer.current);timer.current=setTimeout(()=>{void flush().catch(()=>{});},400);}
  },[flush]);
  const navigate=useCallback(async(target:EpubTarget,restore?:EpubLocation,note=false)=>{
    const token=++request.current;
    try{
      await flush();if(!active.current||token!==request.current)return;
      if(note&&location.current){notes.current.push(location.current);setNoteDepth(notes.current.length);}else if(!restore){notes.current=[];setNoteDepth(0);}
      restoring.current=true;setLoading(true);setPanel(null);setError('');
      const chapter=await epub.chapter(book.summary.id,target.resource);if(!active.current||token!==request.current)return;
      await dom.current!.show(chapter,appearanceRef.current);if(!active.current||token!==request.current)return;
      let matched=true;if(restore)matched=dom.current!.restore(restore);else if(target.fragment)matched=dom.current!.anchor(target.fragment);
      if(!matched)setError('未找到准确位置，原进度已保留');
      location.current=matched?(restore??dom.current!.location()):undefined;
      setResource(target.resource);setFragment(target.fragment);setUnmatched(!matched);restoring.current=false;setLoading(false);
      if(intent.current&&matched&&!notes.current.length)capture();
      host.current?.focus({preventScroll:true});
    }catch(e){if(active.current&&token===request.current){setError(message(e));setLoading(false);restoring.current=false;}}
  },[epub,book.summary.id,flush,capture]);
  navigateRef.current=navigate;
  useEffect(()=>{
    active.current=true;
    const view=new EpubDom(host.current!,book.summary.id,epub,(target,note)=>{intent.current=true;void navigateRef.current?.(target,undefined,note);},(src,alt)=>setImage({src,alt}),value=>{if(active.current)setResourceErrors(old=>[...new Set([...old,value])].slice(0,20));});dom.current=view;
    void epub.open(book.summary.id).then(async value=>{
      if(!active.current)return;openRef.current=value;setOpened(value);setMarks(value.state.bookmarks);appearanceRef.current=value.state.appearance;setAppearance(value.state.appearance);
      const target=value.state.location?.resource??value.legacyLocation?.resource??value.package.sections[0]?.path;
      if(!target)throw Error('这本书没有可显示的章节');
      await navigateRef.current?.({resource:target},value.state.location);
      if(!value.state.location&&value.legacyLocation&&active.current)setUnmatched(true);
    }).catch(e=>{if(active.current){setError(message(e));setLoading(false);}});
    const resize=new ResizeObserver(()=>{
      if(restoring.current)return;const prior=location.current??view.location();restoring.current=true;
      view.setAppearance(appearanceRef.current);requestAnimationFrame(()=>{if(prior)view.restore(prior);restoring.current=false;});
    });resize.observe(host.current!);
    return ()=>{active.current=false;request.current++;clearTimeout(timer.current);resize.disconnect();view.dispose();};
  },[book.summary.id,epub]);
  useEffect(()=>api.onBeforeClose?.(flush),[api,flush]);
  useEffect(()=>{if(image)dialog.current?.showModal();else dialog.current?.close();},[image]);
  useEffect(()=>{if(panel)popover.current?.querySelector<HTMLElement>('input,button')?.focus();},[panel]);
  const changeAppearance=async(next:Partial<EpubAppearance>)=>{
    const value={...appearanceRef.current,...next},prior=location.current??dom.current?.location();appearanceRef.current=value;setAppearance(value);restoring.current=true;
    dom.current?.setAppearance(value);requestAnimationFrame(()=>{if(prior)dom.current?.restore(prior);restoring.current=false;});
    try{await epub.settings(book.summary.id,value);}catch(e){setError(message(e));}
  };
  const back=async()=>{try{await flush();await onBack();}catch(e){setError(message(e));}};
  const addBookmark=async()=>{const loc=location.current??dom.current?.location();if(!loc)return;try{setMarks(await epub.bookmark(book.summary.id,loc,loc.quote.exact.slice(0,100)));}catch(e){setError(message(e));}};
  const remove=async(id:string)=>{try{setMarks(await epub.removeBookmark(book.summary.id,id));}catch(e){setError(message(e));}};
  const page=(direction:number)=>{
    intent.current=true;if(dom.current?.page(direction)){requestAnimationFrame(capture);return;}
    const sections=openRef.current?.package.sections??[],index=sections.findIndex(x=>x.path===resource),next=sections[index+direction];
    if(next)void navigate({resource:next.path});
  };
  const jump=(target:EpubTarget,restore?:EpubLocation)=>{intent.current=true;void navigate(target,restore);};
  const returnFromNote=()=>{const prior=notes.current.pop();setNoteDepth(notes.current.length);if(prior)void navigate({resource:prior.resource},prior);};
  const key=(event:React.KeyboardEvent)=>{
    event.stopPropagation();
    if(event.key==='Escape'){if(image)setImage(undefined);else if(panel)setPanel(null);else void back();event.preventDefault();return;}
    if(editableTarget(event.target as HTMLElement))return;
    const action=shortcutActions.find(action=>keyboard.bindings[action]&&keyboard.bindings[action]===eventShortcut(event.nativeEvent));
    if(action==='closeHost'){event.preventDefault();void api.requestHostClose?.().catch(e=>setError(message(e)));return;}
    if(panel)return;
    if(action==='previousChapter'||action==='nextChapter'){event.preventDefault();const list=openRef.current?.package.sections??[],index=list.findIndex(x=>x.path===resource),next=list[index+(action==='previousChapter'?-1:1)];if(next)jump({resource:next.path});return;}
    if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();page(1);}else if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();page(-1);}else if(action==='scrollDown'||action==='scrollUp'){intent.current=true;host.current?.scrollBy({top:action==='scrollDown'?80:-80});event.preventDefault();}
    else if(!event.ctrlKey&&!event.metaKey&&!event.altKey){if(event.key.toLowerCase()==='t')setPanel('toc');if(event.key.toLowerCase()==='b')void addBookmark();if(event.key.toLowerCase()==='f')setPanel('search');}
  };
  const section=opened?.package.sections.find(x=>x.path===resource),sectionIndex=opened?.package.sections.findIndex(x=>x.path===resource)??0;
  const title=panel==='toc'?'目录':panel==='appearance'?'阅读外观':panel==='bookmarks'?'书签':panel==='search'?'搜索本章':'更多';
  const search=()=>{
    const text=query.trim();if(!text||!dom.current)return;
    const candidates=[...dom.current.root.querySelectorAll<HTMLElement>('[data-reader-node]')].filter(el=>(el.textContent??'').includes(text)&&![...el.children].some(child=>(child.textContent??'').includes(text)));
    if(candidates[0]){const el=candidates[0],offset=(el.textContent??'').indexOf(text);const loc:EpubLocation={version:2,sourceHash:book.summary.id,resource,element:el.dataset.readerNode!,offset,quote:{exact:(el.textContent??'').slice(offset,offset+160).replace(/\s+/g,' ').trim(),prefix:'',suffix:''}};intent.current=true;dom.current.restore(loc);location.current=loc;setPanel(null);capture();}else setError('本章未找到匹配内容');
  };
  return <section className="epub-reader" onKeyDown={key} aria-label="EPUB 阅读器">
    <header className="reader-toolbar"><div className="reader-title-group"><IconButton label="返回书架" onClick={()=>void back()}><ArrowLeft size={19}/></IconButton><div className="reading-title" title={book.document.title}>{book.document.title}</div></div><nav className="reader-actions" aria-label="阅读工具"><IconButton label="目录（T）" active={panel==='toc'} aria-expanded={panel==='toc'} onClick={()=>setPanel(panel==='toc'?null:'toc')}><List size={19}/></IconButton><IconButton label="阅读外观" active={panel==='appearance'} onClick={()=>setPanel(panel==='appearance'?null:'appearance')}><Settings2 size={19}/></IconButton><IconButton label="收藏当前位置（B）" onClick={()=>void addBookmark()}><Bookmark size={18}/></IconButton><IconButton label="更多" active={panel==='menu'} onClick={()=>setPanel(panel==='menu'?null:'menu')}><MoreHorizontal size={19}/></IconButton></nav></header>
    {error&&<div className="error-notice" role="alert"><CircleAlert size={16}/><span>{error}</span><button className="text-button" onClick={()=>void flush().catch(()=>{})}>重试保存</button><IconButton label="关闭提示" onClick={()=>setError('')}><X size={15}/></IconButton></div>}
    <div className="epub-stage"><div ref={host} className="epub-document" aria-label="EPUB 正文" tabIndex={0} onScroll={capture} onWheel={()=>{intent.current=true;}} onTouchStart={()=>{intent.current=true;}} onPointerDown={()=>{intent.current=true;}} />
      {loading&&<div className="epub-loading" role="status"><LoaderCircle size={22} className="spin"/><span>正在打开…</span></div>}
      {unmatched&&!loading&&<div className="epub-position-notice"><span>原进度已保留</span><button className="text-button" onClick={async()=>{await flush();onLegacy();}}>旧版阅读</button><IconButton label="关闭位置提示" onClick={()=>setUnmatched(false)}><X size={15}/></IconButton></div>}
      {noteDepth>0&&<button className="epub-note-return" onClick={returnFromNote}><ArrowLeft size={14}/>返回正文</button>}
      {panel&&<><button className="epub-scrim" aria-label="关闭面板" onClick={()=>setPanel(null)}/><aside ref={popover} className={`epub-panel ${panel==='toc'||panel==='bookmarks'||panel==='search'?'epub-drawer':'epub-popover'}`} role="dialog" aria-label={title} onKeyDown={event=>{if(event.key!=='Tab')return;const items=[...event.currentTarget.querySelectorAll<HTMLElement>('button,input,summary')].filter(x=>x.getClientRects().length),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}><div className="panel-heading"><h2>{title}</h2><IconButton label={`关闭${title}`} onClick={()=>setPanel(null)}><X size={18}/></IconButton></div>
        {panel==='toc'&&opened&&<Toc items={opened.package.toc} resource={resource} fragment={fragment} select={target=>jump(target)}/>}
        {panel==='appearance'&&<div className="epub-appearance"><div className="segmented"><button aria-pressed={appearance.style==='original'} className={appearance.style==='original'?'selected':''} onClick={()=>void changeAppearance({style:'original'})}>原书</button><button aria-pressed={appearance.style==='comfort'} className={appearance.style==='comfort'?'selected':''} onClick={()=>void changeAppearance({style:'comfort'})}>舒适</button></div><div className="epub-setting"><span>字号</span><div className="epub-stepper"><IconButton label="缩小字号" disabled={appearance.fontSize<=14} onClick={()=>void changeAppearance({fontSize:appearance.fontSize-2})}><Minus size={15}/></IconButton><output>{appearance.fontSize}</output><IconButton label="放大字号" disabled={appearance.fontSize>=34} onClick={()=>void changeAppearance({fontSize:appearance.fontSize+2})}><Plus size={15}/></IconButton></div></div><div className="epub-setting"><span>阅读</span><div className="segmented"><button aria-pressed={appearance.flow==='scroll'} className={appearance.flow==='scroll'?'selected':''} onClick={()=>void changeAppearance({flow:'scroll'})}>滚动</button><button aria-pressed={appearance.flow==='pages'} className={appearance.flow==='pages'?'selected':''} onClick={()=>void changeAppearance({flow:'pages'})}>翻页</button></div></div></div>}
        {panel==='menu'&&<div className="epub-menu"><button onClick={()=>setPanel('bookmarks')}><Bookmark size={16}/>书签</button><button onClick={()=>setPanel('search')}><Search size={16}/>搜索本章</button><button onClick={async()=>{await flush();onLegacy();}}>旧版阅读</button>{(resourceErrors.length>0||opened?.package.warnings.length)&&<details><summary><CircleAlert size={14}/>显示提示</summary><ul>{[...opened?.package.warnings??[],...resourceErrors].map(x=><li key={x}>{x}</li>)}</ul></details>}</div>}
        {panel==='bookmarks'&&<ul className="bookmark-list">{marks.map(mark=><li key={mark.id}><button className="bookmark-jump" onClick={()=>mark.location?jump({resource:mark.location.resource},mark.location):setError('此旧书签尚未匹配，已保留原位置')}><p>{mark.label}</p>{!mark.location&&<small>旧书签</small>}</button><IconButton label={`移除书签：${mark.label.slice(0,20)}`} onClick={()=>void remove(mark.id)}><Trash2 size={15}/></IconButton></li>)}{!marks.length&&<li className="panel-empty">还没有书签</li>}</ul>}
        {panel==='search'&&<form className="epub-search" onSubmit={event=>{event.preventDefault();search();}}><label className="search-field"><Search size={16}/><input type="search" aria-label="搜索本章内容" placeholder="输入关键词" value={query} onChange={event=>setQuery(event.target.value)}/></label><button className="secondary-button" type="submit">查找</button></form>}
      </aside></>}
    </div>
    <footer className="epub-footer"><span title={section?.title}>{section?.title??book.document.title}</span><div>{saving&&<LoaderCircle size={12} className="spin" aria-label="正在保存"/>}<IconButton label="上一页" onClick={()=>page(-1)}><ChevronLeft size={16}/></IconButton><span>{Math.max(1,sectionIndex+1)} / {opened?.package.sections.length??'—'}</span><IconButton label="下一页" onClick={()=>page(1)}><ChevronRight size={16}/></IconButton></div></footer>
    <dialog ref={dialog} className="epub-image-dialog" aria-label="插图预览" onCancel={()=>setImage(undefined)}><IconButton label="关闭插图" onClick={()=>setImage(undefined)}><X size={18}/></IconButton>{image&&<img src={image.src} alt={image.alt}/>}</dialog>
  </section>;
}
