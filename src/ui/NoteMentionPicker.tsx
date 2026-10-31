import {useId,useLayoutEffect,useRef,useState} from 'react';
import {BookOpen,CalendarDays,Settings2} from 'lucide-react';
import {NoteBotIcon} from './NoteBotIcon';
import type {MentionItem} from './note-mentions';
import {usePopup,type PopupReason} from './use-popup';
import './note-mentions.css';

type Category='all'|'bot'|'source'|'date';
const categories:Array<{id:Category;label:string}>=[{id:'all',label:'全部'},{id:'bot',label:'Bots'},{id:'source',label:'引用'},{id:'date',label:'日期'}];
interface Props {items:MentionItem[];query:string;label:string;owner:()=>HTMLElement|null;rect:()=>{left:number;top:number;bottom:number}|undefined;onPick:(item:MentionItem)=>void;onClose:(reason?:PopupReason)=>void;onManage:()=>void;}
export function NoteMentionPicker(props:Props){
  const id=useId(),panel=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
  const [category,setCategory]=useState<Category>('all'),[index,setIndex]=useState(0);
  const found=category==='all'?(['bot','source','date'] as const).flatMap(kind=>props.items.filter(item=>item.kind===kind).slice(0,kind==='date'?3:6)):props.items.filter(item=>item.kind===category).slice(0,60);
  const items:MentionItem[]=[...found,...(category==='all'||category==='bot'?[{id:'manage',kind:'manage' as const,title:'管理 Note Bots'}]:[])];
  const active=index<0?-1:Math.min(index,items.length-1),optionId=(n:number)=>id+'-option-'+n;
  useLayoutEffect(()=>setIndex(found.length?0:-1),[props.query,category]);
  const pick=(item:MentionItem)=>item.kind==='manage'?props.onManage():props.onPick(item);
  const categoryFocus=(next:Category)=>{setCategory(next);requestAnimationFrame(()=>panel.current?.querySelector<HTMLElement>(`[data-category="${next}"]`)?.focus());};
  usePopup({panel,owner:props.owner,kind:'autocomplete',onClose:props.onClose,onKey:event=>{
    const tab=(event.target as HTMLElement).closest('[role=tab]');
    if(tab){
      const at=categories.findIndex(value=>value.id===category);
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){categoryFocus(categories[(at+(event.key==='ArrowRight'?1:categories.length-1))%categories.length]!.id);return true;}
      if(event.key==='ArrowDown'||event.key==='Tab'&&!event.shiftKey){props.owner()?.focus({preventScroll:true});setIndex(found.length?0:-1);return true;}
      if(event.key==='Enter'||event.key===' '){props.owner()?.focus({preventScroll:true});return true;}
    }
    if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey&&event.key!=='Tab')return false;
    if(event.key==='ArrowUp'&&active<=0){panel.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();return true;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){setIndex(value=>Math.max(0,Math.min(items.length-1,value+(event.key==='ArrowDown'?1:-1))));return true;}
    if(event.key==='Enter'||event.key==='Tab'&&!event.shiftKey){const item=items[active];if(item){pick(item);return true;}return event.key==='Enter';}
    return false;
  }});
  useLayoutEffect(()=>{
    const owner=props.owner();if(!owner)return;
    owner.setAttribute('aria-expanded','true');owner.setAttribute('aria-haspopup','listbox');owner.setAttribute('aria-autocomplete','list');owner.setAttribute('aria-controls',id);
    return()=>{if(owner.getAttribute('aria-controls')===id)for(const name of ['aria-expanded','aria-haspopup','aria-autocomplete','aria-controls','aria-activedescendant'])owner.removeAttribute(name);};
  },[id]);
  useLayoutEffect(()=>{const owner=props.owner();if(active>=0)owner?.setAttribute('aria-activedescendant',optionId(active));else owner?.removeAttribute('aria-activedescendant');const row=panel.current?.querySelector<HTMLElement>('[aria-selected=true][role=option]'),list=panel.current?.querySelector<HTMLElement>('.note-mention-options');if(row&&list){const a=row.getBoundingClientRect(),b=list.getBoundingClientRect();if(a.top<b.top)list.scrollTop-=b.top-a.top;else if(a.bottom>b.bottom)list.scrollTop+=a.bottom-b.bottom;}},[active,category,props.query]);
  useLayoutEffect(()=>{
    const place=()=>{const element=panel.current,owner=latest.current.owner();if(!element||!owner?.isConnected)return;
      let rect;try{rect=latest.current.rect();}catch{return latest.current.onClose();}if(!rect||rect.bottom<0||rect.top>innerHeight)return latest.current.onClose();
      const box=element.getBoundingClientRect();element.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.left))+'px';
      element.style.top=Math.max(8,Math.min(innerHeight-box.height-8,rect.bottom+box.height+8<=innerHeight-8?rect.bottom+8:rect.top-box.height-8))+'px';
    };
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!panel.current?.contains(event.target))place();};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);};
  },[props.query,category,items.length]);
  return <div className="note-mention-picker" ref={panel}>
    <div className="note-mention-tabs" role="tablist" aria-label="插入类型">{categories.map(value=><button type="button" role="tab" aria-selected={value.id===category} tabIndex={value.id===category?0:-1} key={value.id} data-category={value.id} onMouseDown={event=>event.preventDefault()} onClick={()=>{setCategory(value.id);props.owner()?.focus({preventScroll:true});}}>{value.label}</button>)}</div>
    <div className="note-mention-options" id={id} role="listbox" aria-label={props.label}>
      {!found.length&&<p className="note-mention-empty">{category==='source'&&!props.query?'选中书中文字后，可在此引用':'没有匹配内容'}</p>}
      {items.map((item,n)=>{const Icon=item.kind==='bot'?NoteBotIcon:item.kind==='source'?BookOpen:item.kind==='date'?CalendarDays:Settings2;return <div key={item.kind+item.id}>{item.kind!=='manage'&&(n===0||items[n-1]?.kind!==item.kind)&&<div className="note-mention-group" aria-hidden="true">{item.kind==='bot'?'指派':item.kind==='source'?'原文引用':'日期'}</div>}<button type="button" id={optionId(n)} role="option" tabIndex={-1} className={'note-mention-option'+(item.kind==='manage'?' is-management':'')} aria-selected={n===active} onMouseDown={event=>event.preventDefault()} onPointerMove={()=>setIndex(n)} onClick={()=>pick(item)}><span className="note-mention-icon"><Icon size={17}/></span><span className="note-mention-label"><strong>{item.title}</strong>{item.description&&<small>{item.description}</small>}</span>{item.default&&<span className="note-mention-default">默认</span>}</button></div>;})}
    </div><div className="note-mention-keys" aria-hidden="true"><span><kbd>↑↓</kbd>选择</span><span><kbd>Tab</kbd>确认</span><span><kbd>Esc</kbd>关闭</span></div>
  </div>;
}
