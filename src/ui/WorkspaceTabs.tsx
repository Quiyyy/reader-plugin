import {useCallback,useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {BookOpen,NotebookPen,Search,Plus,X,MoreHorizontal,Columns2,Rows2,PanelsTopLeft} from 'lucide-react';
import {WorkspacePage} from './Workspace';
import {App} from './App';
import {appearanceIsDark,appearanceVariables} from './appearance';
import {defaultAppearance,type WorkspaceSnapshot} from '../shared/workspace';
import type {ReaderApi} from '../shared/types';
import {activateTab,closeTab,groups,initialLayout,workspaceChrome,layoutRects,layoutStorageKey,minimumSize,moveTab,openTab,resizeSplit,restoreLayout,serializeLayout,type DropEdge,type OpenPage,type Rect,type TabLayout,type WorkspaceTab,type WorkspaceNotice} from './workspace-tabs';
import './workspace-tabs.css';

const empty:WorkspaceSnapshot={revision:0,folders:[],notes:[],annotations:[],sources:[],books:{},appearance:defaultAppearance,aiBooks:[]};
const position=(rect:Rect):CSSProperties=>({left:rect.x,top:rect.y,width:rect.width,height:rect.height});
const icon=(tab:WorkspaceTab)=>tab.target.kind==='book'?<BookOpen size={14}/>:tab.target.kind==='note'||tab.target.kind==='notes'?<NotebookPen size={14}/>:tab.target.kind==='search'?<Search size={14}/>:<PanelsTopLeft size={14}/>;

// Page components stay in a flat, keyed layer. Moving a tab changes its bounds,
// never its React parent, so editor selection, undo history and scroll survive.
function Page({tab,api,rect,visible,focused,snapshot,setSnapshot,onOpen,onTitle,registerFlush,onFocus,onNotice,libraryVersion}:{
  tab:WorkspaceTab;api:ReaderApi;rect:Rect;visible:boolean;focused:boolean;snapshot:WorkspaceSnapshot;
  setSnapshot:(value:WorkspaceSnapshot)=>void;onOpen:(page:OpenPage,from:string)=>void;onTitle:(id:string,title:string)=>void;
  registerFlush:(id:string,fn:(()=>Promise<void>)|null)=>void;onFocus:(id:string)=>void;
  onNotice:(value:WorkspaceNotice|undefined)=>void;libraryVersion:number;
}) {
  const listeners=useRef(new Set<()=>Promise<unknown>>());
  const scopedApi=useMemo<ReaderApi>(()=>({...api,onExternalBook:undefined,onBeforeClose:listener=>{listeners.current.add(listener);return()=>{listeners.current.delete(listener);};}}),[api]);
  useEffect(()=>{registerFlush(tab.id,async()=>{for(const listener of [...listeners.current])await listener();});return()=>registerFlush(tab.id,null);},[tab.id,registerFlush]);
  const open=useCallback((page:OpenPage)=>onOpen(page,tab.id),[tab.id,onOpen]);
  const title=useCallback((value:string)=>onTitle(tab.id,value),[tab.id,onTitle]);
  return <section id={'reader-page-'+tab.id} role="tabpanel" aria-labelledby={'reader-tab-'+tab.id} aria-hidden={!visible} inert={!visible} data-workspace-page={tab.id} data-visible={visible} data-focused={focused} className="reader-tab-page" style={{...position({...rect,y:rect.y+workspaceChrome.tabHeight,height:rect.height-workspaceChrome.tabHeight}),visibility:visible?'visible':'hidden'}} onPointerDownCapture={()=>onFocus(tab.id)} onFocusCapture={()=>onFocus(tab.id)}>
    <WorkspacePage api={scopedApi} page={tab} visible={visible} focused={focused} snapshot={snapshot} setSnapshot={setSnapshot} onOpenPage={open} onTitle={title} onNotice={onNotice} libraryVersion={libraryVersion}/>
  </section>;
}

export function Workspace({api}:{api:ReaderApi}) {
  if(!api.study)return <App api={api}/>;
  return <TabbedWorkspace api={api}/>;
}
function TabbedWorkspace({api}:{api:ReaderApi}) {
  const [layout,setLayout]=useState<TabLayout>(()=>{try{return restoreLayout(sessionStorage.getItem(layoutStorageKey))??initialLayout();}catch{return initialLayout();}});
  const current=useRef(layout);current.current=layout;
  const [snapshot,setSnapshot]=useState(empty),[error,setError]=useState(''),[size,setSize]=useState({width:0,height:0}),[dragging,setDragging]=useState<string>(),[drop,setDrop]=useState<{group:string;edge:DropEdge}>(),[menu,setMenu]=useState<{group:string;kind:'new'|'layout'}>(),[dark,setDark]=useState(false);
  const viewport=useRef<HTMLDivElement>(null),canvas=useRef<HTMLDivElement>(null),drag=useRef<string|undefined>(undefined),flushes=useRef(new Map<string,()=>Promise<void>>()),closing=useRef(new Set<string>()),navigationSeen=useRef('');
  const commit=useCallback((update:(value:TabLayout)=>TabLayout)=>{const next=update(current.current);current.current=next;setLayout(next);},[]);
  const [libraryVersion,setLibraryVersion]=useState(0);
  const [progressFailures,setProgressFailures]=useState<Record<string,string>>({});
  const [notice,setNotice]=useState<WorkspaceNotice>(),noticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const showNotice=useCallback((value:WorkspaceNotice|undefined)=>{clearTimeout(noticeTimer.current);setNotice(value);if(value&&!value.undo)noticeTimer.current=setTimeout(()=>setNotice(undefined),5000);},[]);
  useEffect(()=>()=>clearTimeout(noticeTimer.current),[]);
  const pageApi=useMemo<ReaderApi>(()=>{
    let listing:ReturnType<ReaderApi['list']>|undefined;
    const invalidate=()=>{listing=undefined;setLibraryVersion(value=>value+1);};
    return {...api,list:()=>{if(listing)return listing;const pending=api.list();listing=pending;void pending.finally(()=>{if(listing===pending)listing=undefined;}).catch(()=>{});return pending;},saveProgress:async(id,locator)=>{
      try{const result=await api.saveProgress(id,locator);setProgressFailures(old=>{if(!(id in old))return old;const next={...old};delete next[id];return next;});return result;}
      catch(e){setProgressFailures(old=>({...old,[id]:'阅读位置未保存：'+(e instanceof Error?e.message:String(e))}));throw e;}
    },restore:async id=>{await api.restore(id);invalidate();},importBook:async(...args)=>{const result=await api.importBook(...args);invalidate();return result;},trash:async id=>{
      const readers=current.current.tabs.filter(tab=>tab.target.kind==='book'&&tab.target.bookId===id);
      for(const tab of readers)await flushes.current.get(tab.id)?.();
      const result=await api.trash(id);
      commit(value=>readers.reduce((next,tab)=>closeTab(next,tab.id),value));
      invalidate();return result;
    }};
  },[api,commit]);
  const updateSnapshot=useCallback((next:WorkspaceSnapshot)=>setSnapshot(old=>old.revision>=next.revision?old:next),[]);
  const open=useCallback((page:OpenPage,from?:string)=>{
    commit(value=>openTab(value,page,groups(value.root).find(g=>g.tabs.includes(from??''))?.id));setMenu(undefined);
    if(page.focus==='import-options'){
      const library=current.current.tabs.find(tab=>tab.target.kind==='library');
      requestAnimationFrame(()=>document.getElementById('reader-page-'+library?.id)?.querySelector<HTMLElement>('[aria-label="添加选项"]')?.focus());
    }
  },[commit]);
  const activate=useCallback((id:string)=>{commit(value=>{const group=groups(value.root).find(g=>g.tabs.includes(id));return group?.id===value.focused&&group.active===id?value:activateTab(value,id);});},[commit]);
  const title=useCallback((id:string,value:string)=>commit(layout=>layout.tabs.some(t=>t.id===id&&t.title!==value)?{...layout,tabs:layout.tabs.map(t=>t.id===id?{...t,title:value}:t)}:layout),[commit]);
  const registerFlush=useCallback((id:string,fn:(()=>Promise<void>)|null)=>{if(fn)flushes.current.set(id,fn);else flushes.current.delete(id);},[]);
  const close=async(id:string)=>{
    if(closing.current.has(id))return;closing.current.add(id);
    try{await flushes.current.get(id)?.();commit(value=>closeTab(value,id));setError('');const group=groups(current.current.root).find(g=>g.id===current.current.focused)!;requestAnimationFrame(()=>document.getElementById('reader-tab-'+group.active)?.focus());}
    catch(e){activate(id);setError('页面尚未关闭：'+(e instanceof Error?e.message:String(e)));}
    finally{closing.current.delete(id);}
  };
  useEffect(()=>api.onBeforeClose?.(async()=>{for(const [id,flush] of flushes.current){try{await flush();}catch(e){activate(id);throw e;}}}),[api,activate]);
  useEffect(()=>api.onExternalBook?.(book=>open({target:{kind:'book',bookId:book.summary.id},title:book.summary.title,book}),message=>setError(message)),[api,open]);
  useEffect(()=>{let cancelled=false,timer:ReturnType<typeof setTimeout>;const tick=async()=>{
    try{const next=await api.study!.call<WorkspaceSnapshot&{navigation?:{sourceId:string;token:string}}>('reader_workspace');if(cancelled)return;updateSnapshot(next);
      if(next.navigation&&next.navigation.token!==navigationSeen.current){navigationSeen.current=next.navigation.token;const source=next.sources.find(s=>s.id===next.navigation!.sourceId);if(source)open({target:{kind:'book',bookId:source.bookId,sourceId:source.id},title:source.title+' · 引用'});}
    }catch(e){if(snapshot===empty&&!cancelled)setError(e instanceof Error?e.message:String(e));}
    if(!cancelled)timer=setTimeout(tick,2500);
  };void tick();return()=>{cancelled=true;clearTimeout(timer);};},[api,open,updateSnapshot]);
  useEffect(()=>{try{sessionStorage.setItem(layoutStorageKey,serializeLayout(layout));}catch{/* Opaque host frames may not expose storage; the live layout still works. */}},[layout]);
  const focusedTab=groups(layout.root).find(group=>group.id===layout.focused)?.active;
  useEffect(()=>{if(focusedTab)document.getElementById('reader-tab-'+focusedTab)?.scrollIntoView({block:'nearest',inline:'nearest'});},[focusedTab]);
  useEffect(()=>{const element=viewport.current!;const observer=new ResizeObserver(()=>setSize({width:element.clientWidth,height:element.clientHeight}));observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),apply=()=>setDark(appearanceIsDark(snapshot.appearance.mode,document.documentElement.dataset.hostTheme,media.matches));apply();media.addEventListener('change',apply);const observer=new MutationObserver(apply);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-host-theme']});return()=>{media.removeEventListener('change',apply);observer.disconnect();};},[snapshot.appearance.mode]);
  useEffect(()=>{if(!menu)return;const dismiss=(event:PointerEvent)=>{if(!(event.target as Element).closest('.reader-group-menu,.reader-group-action'))setMenu(undefined);};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[menu]);
  const min=minimumSize(layout.root),width=Math.max(size.width,min.width),height=Math.max(size.height,min.height),{panes,dividers}=layoutRects(layout.root,width,height);
  const finishDrag=()=>{drag.current=undefined;setDragging(undefined);setDrop(undefined);};
  const move=(id:string,group:string,edge:DropEdge,before?:string)=>{commit(value=>moveTab(value,id,group,edge,before));finishDrag();setMenu(undefined);};
  const progressFailure=Object.entries(progressFailures)[0];
  return <div className={'reader-tabs-workspace '+(dark?'dark':'light')} style={{...appearanceVariables(snapshot.appearance,dark),'--reader-tab-height':workspaceChrome.tabHeight+'px','--reader-toolbar-height':workspaceChrome.toolbarHeight+'px','--reader-status-height':workspaceChrome.statusHeight+'px'} as CSSProperties} onKeyDown={e=>{
    if(e.key==='Escape'){finishDrag();setMenu(undefined);}
    if(e.ctrlKey&&e.altKey&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){e.preventDefault();const group=groups(current.current.root).find(g=>g.id===current.current.focused)!;activate(group.tabs[(group.tabs.indexOf(group.active)+(e.key==='ArrowRight'?1:group.tabs.length-1))%group.tabs.length]!);}
  }}>
    {(error||progressFailure)&&<div className="reader-tabs-error" role="alert"><span>{error||progressFailure?.[1]}</span>{progressFailure&&<button onClick={()=>{const tab=current.current.tabs.find(tab=>tab.target.kind==='book'&&tab.target.bookId===progressFailure[0]&&!tab.target.sourceId);if(tab)void flushes.current.get(tab.id)?.().then(()=>setError('')).catch(()=>{});}}>重试</button>}{error&&<button aria-label="关闭工作区提示" onClick={()=>setError('')}><X size={16}/></button>}</div>}
    <div className="reader-tabs-viewport" ref={viewport}><div className="reader-tabs-canvas" ref={canvas} style={{width,height}}>
      {layout.tabs.map(tab=>{const pane=panes.find(p=>p.group.tabs.includes(tab.id))!;return <Page key={tab.id} tab={tab} api={pageApi} rect={pane.rect} visible={pane.group.active===tab.id} focused={pane.group.id===layout.focused&&pane.group.active===tab.id} snapshot={snapshot} setSnapshot={updateSnapshot} onOpen={open} onTitle={title} registerFlush={registerFlush} onFocus={activate} onNotice={showNotice} libraryVersion={libraryVersion}/>;})}
      {panes.map(({group,rect},index)=><div key={group.id} className={'reader-tab-group'+(group.id===layout.focused?' is-focused':'')} data-tab-group={group.id} style={position({...rect,height:workspaceChrome.tabHeight})}>
        <div role="tablist" aria-label={'页面标签组 '+(index+1)} className="reader-tab-list" onDragOver={e=>{if(drag.current){e.preventDefault();e.dataTransfer.dropEffect='move';}}} onDrop={e=>{if(drag.current){e.preventDefault();move(drag.current,group.id,'center');}}}>
          {group.tabs.map(id=>{const tab=layout.tabs.find(t=>t.id===id)!;return <div key={id} className={'reader-tab'+(group.active===id?' is-active':'')} draggable onDragStart={e=>{drag.current=id;setDragging(id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',tab.title);setMenu(undefined);}} onDragEnd={finishDrag} onDragOver={e=>{if(drag.current){e.preventDefault();e.stopPropagation();e.currentTarget.dataset.drop='true';}}} onDragLeave={e=>{delete e.currentTarget.dataset.drop;}} onDrop={e=>{delete e.currentTarget.dataset.drop;if(!drag.current)return;e.preventDefault();e.stopPropagation();const after=e.clientX>e.currentTarget.getBoundingClientRect().left+e.currentTarget.clientWidth/2;move(drag.current,group.id,'center',after?group.tabs[group.tabs.indexOf(id)+1]:id);}}>
            <button role="tab" id={'reader-tab-'+id} aria-selected={group.active===id} aria-controls={'reader-page-'+id} tabIndex={group.active===id?0:-1} title={tab.title} onClick={()=>activate(id)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Home'||e.key==='End'){e.preventDefault();const at=e.key==='Home'?0:e.key==='End'?group.tabs.length-1:(group.tabs.indexOf(id)+(e.key==='ArrowRight'?1:group.tabs.length-1))%group.tabs.length,next=group.tabs[at]!;activate(next);requestAnimationFrame(()=>document.getElementById('reader-tab-'+next)?.focus());}if(e.key==='Delete'){e.preventDefault();void close(id);}}}>{icon(tab)}<span>{tab.title}</span></button>
            <button className="reader-tab-close" aria-label={'关闭页面 '+tab.title} title="关闭页面" onClick={()=>void close(id)}><X size={13}/></button>
          </div>;})}
        </div>
        <button className="reader-group-action" aria-label="打开页面" title="打开页面" onClick={()=>setMenu(menu?.group===group.id&&menu.kind==='new'?undefined:{group:group.id,kind:'new'})}><Plus size={16}/></button>
        <button className="reader-group-action" aria-label="分栏操作" title="分栏操作" onClick={()=>setMenu(menu?.group===group.id&&menu.kind==='layout'?undefined:{group:group.id,kind:'layout'})}><MoreHorizontal size={17}/></button>
        {menu?.group===group.id&&<div className="reader-group-menu" role="menu" aria-label={menu.kind==='new'?'打开页面':'分栏操作'}>{menu.kind==='new'?(['library','notes','search','online','trash'] as const).filter(kind=>kind!=='online'||api.online).map(kind=><button key={kind} role="menuitem" onClick={()=>{commit(value=>openTab(value,{target:{kind}},group.id));setMenu(undefined);}}>{{library:'书库',notes:'笔记',search:'搜索',online:'在线找书',trash:'回收站'}[kind]}</button>):<>
          {(['left','right','top','bottom'] as const).map(edge=><button role="menuitem" key={edge} disabled={group.tabs.length<2} onClick={()=>move(group.active,group.id,edge)}>{edge==='left'||edge==='right'?<Columns2 size={15}/>:<Rows2 size={15}/>}{{left:'移到左侧分栏',right:'移到右侧分栏',top:'移到上方分栏',bottom:'移到下方分栏'}[edge]}</button>)}
          {panes.length>1&&<button role="menuitem" onClick={()=>{commit(value=>{const all=groups(value.root);return {...value,focused:group.id,root:{kind:'group',id:group.id,tabs:all.flatMap(g=>g.tabs),active:group.active}};});setMenu(undefined);}}>合并所有分栏</button>}
          <small>拖动标签到页面四边分栏<br/>Ctrl + Alt + ← / → 切换标签</small>
        </>}</div>}
      </div>)}
      {dividers.map(({split,rect,parent,min,max})=><div key={split.id} role="separator" aria-label={split.axis==='horizontal'?'调整左右分栏':'调整上下分栏'} aria-orientation={split.axis==='horizontal'?'vertical':'horizontal'} aria-valuemin={Math.round(min*100)} aria-valuemax={Math.round(max*100)} aria-valuenow={Math.round(Math.max(min,Math.min(max,split.ratio))*100)} tabIndex={0} className={'reader-divider '+split.axis} style={position(split.axis==='horizontal'?{...rect,x:rect.x-(workspaceChrome.dividerHitSize-workspaceChrome.dividerSize)/2,width:workspaceChrome.dividerHitSize}:{...rect,y:rect.y-(workspaceChrome.dividerHitSize-workspaceChrome.dividerSize)/2,height:workspaceChrome.dividerHitSize})} onDoubleClick={()=>commit(value=>({...value,root:resizeSplit(value.root,split.id,.5)}))} onKeyDown={e=>{const decrease=split.axis==='horizontal'?'ArrowLeft':'ArrowUp',increase=split.axis==='horizontal'?'ArrowRight':'ArrowDown';if(e.key===decrease||e.key===increase){e.preventDefault();commit(value=>({...value,root:resizeSplit(value.root,split.id,Math.max(min,Math.min(max,Math.max(min,Math.min(max,split.ratio))+(e.key===decrease?-.05:.05))))}));}}} onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const box=canvas.current!.getBoundingClientRect(),horizontal=split.axis==='horizontal',coordinate=horizontal?e.clientX-box.left:e.clientY-box.top,aligned=dividers.filter(item=>item.split.id!==split.id&&item.split.axis===split.axis).map(item=>horizontal?item.rect.x:item.rect.y).sort((a,b)=>Math.abs(a-coordinate)-Math.abs(b-coordinate))[0],snapped=aligned!==undefined&&Math.abs(aligned-coordinate)<=8?aligned:coordinate,ratio=(snapped-(horizontal?parent.x:parent.y))/(horizontal?parent.width-workspaceChrome.dividerSize:parent.height-workspaceChrome.dividerSize);commit(value=>({...value,root:resizeSplit(value.root,split.id,Math.max(min,Math.min(max,ratio)))}));}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}/>)}
      {dragging&&panes.map(({group,rect})=><div key={group.id} className="reader-drop-surface" data-drop-group={group.id} style={position({...rect,y:rect.y+workspaceChrome.tabHeight,height:rect.height-workspaceChrome.tabHeight})} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move';const box=e.currentTarget.getBoundingClientRect(),x=(e.clientX-box.left)/box.width,y=(e.clientY-box.top)/box.height;const near=Math.min(x,1-x,y,1-y),edge:DropEdge=near>.25?'center':near===x?'left':near===1-x?'right':near===y?'top':'bottom';setDrop({group:group.id,edge});}} onDrop={e=>{e.preventDefault();if(drag.current)move(drag.current,group.id,drop?.group===group.id?drop.edge:'center');}}>{drop?.group===group.id&&<div className={'reader-drop-preview '+drop.edge}><span>{{left:'在左侧分栏',right:'在右侧分栏',top:'在上方分栏',bottom:'在下方分栏',center:'移入此标签组'}[drop.edge]}</span></div>}</div>)}
    </div></div>
    {notice&&<div className="reader-tabs-toast" role="status"><span>{notice.text}</span>{notice.undo&&<button onClick={()=>{void notice.undo!().then(()=>showNotice(undefined)).catch(e=>setError(e instanceof Error?e.message:String(e)));}}>撤销</button>}<button aria-label="关闭操作提示" onClick={()=>showNotice(undefined)}><X size={14}/></button></div>}
  </div>;
}
