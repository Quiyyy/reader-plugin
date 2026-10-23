import { useEffect,useRef,useState } from 'react';
import { Check,ChevronDown,LoaderCircle } from 'lucide-react';
import type { ChatModels,WorkspaceApi } from '../shared/workspace';
import { errorText } from './study-ui';
const catalogs=new WeakMap<WorkspaceApi,{value:ChatModels;expires:number}>();

export function ChatModelPicker({api,value,disabled,onChange}:{api:WorkspaceApi;value:string|null;disabled:boolean;onChange:(model:string|null)=>void}) {
  const [open,setOpen]=useState(false),[catalog,setCatalog]=useState<ChatModels|undefined>(()=>catalogs.get(api)?.value),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),alive=useRef(true),request=useRef(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++;};},[]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[open]);
  const load=async()=>{const token=++request.current;setLoading(true);setError('');try{const result=await api.call<ChatModels>('reader_chat_models');catalogs.set(api,{value:result,expires:Date.now()+60000});if(alive.current&&token===request.current)setCatalog(result);}catch(e){if(alive.current&&token===request.current)setError(errorText(e));}finally{if(alive.current&&token===request.current)setLoading(false);}};
  const select=(model:string|null)=>{onChange(model);setOpen(false);trigger.current?.focus();};
  const label=value?(catalog?.models.find(model=>model.id===value)?.name??value):'默认模型';
  return <div className="study-model-picker" ref={root} onKeyDown={event=>{if(event.key==='Escape'&&open){event.stopPropagation();setOpen(false);trigger.current?.focus();}if(open&&(event.key==='ArrowDown'||event.key==='ArrowUp')){const items=[...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')],index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(event.key==='ArrowDown'?1:items.length-1)+items.length)%items.length]?.focus();event.preventDefault();}}}>
    <button ref={trigger} type="button" className="study-model-trigger" aria-label="选择模型" title={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={()=>{setOpen(!open);if(!open&&!loading&&(catalogs.get(api)?.expires??0)<Date.now())void load();}}><span>{label}</span><ChevronDown size={12}/></button>
    {open&&<div className="study-model-menu" role="menu" aria-label="模型"><button type="button" role="menuitemradio" aria-checked={value===null} onClick={()=>select(null)}><span>默认模型{catalog?.defaultModel&&<small>{catalog.models.find(model=>model.id===catalog.defaultModel)?.name??catalog.defaultModel}</small>}</span>{value===null&&<Check size={14}/>}</button>{loading?<div className="study-model-status" role="status"><LoaderCircle size={14} className="spin"/>正在读取模型…</div>:error?<div className="study-model-status" role="alert"><span>{error}</span><button type="button" onClick={()=>void load()}>重试</button></div>:catalog?.models.map(model=><button type="button" key={model.id} role="menuitemradio" aria-checked={value===model.id} onClick={()=>select(model.id)}><span>{model.name}</span>{value===model.id&&<Check size={14}/>}</button>)}</div>}
  </div>;
}
