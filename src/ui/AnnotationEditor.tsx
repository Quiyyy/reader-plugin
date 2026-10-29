import { useEffect,useRef } from 'react';
import { NotebookPen,Sparkles,Trash2,X } from 'lucide-react';
import type { Annotation,SourceRef } from '../shared/workspace';
import { IconButton } from './IconButton';

interface Props {
  source:SourceRef; annotation?:Annotation; text:string; color:Annotation['color']; busy:boolean; error:string; dirty:boolean;
  onText:(text:string)=>void; onColor:(color:Annotation['color'])=>void; onSave:()=>void; onDelete:()=>void; onAsk:()=>void; onNote:()=>void;
  onClose:(discard?:boolean)=>void;
}
export function AnnotationEditor(props:Props) {
  const input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{input.current?.focus({preventScroll:true});},[props.source.id]);
  return <aside className="annotation-editor" role="dialog" aria-modal="false" aria-label="批注" onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();props.onClose();}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();props.onSave();}}}>
    <header><h2>批注</h2><IconButton label="关闭批注" disabled={props.busy} onClick={()=>props.onClose()}><X size={17}/></IconButton></header>
    <blockquote title={props.source.quote}>{props.source.quote||props.source.label}</blockquote>
    {props.error&&<p className="annotation-error" role="alert">{props.error}</p>}
    <form onSubmit={event=>{event.preventDefault();props.onSave();}}><div className="annotation-colors" role="group" aria-label="高亮颜色">{(['yellow','green','blue','pink'] as const).map((color,index)=><button key={color} type="button" className={'annotation-'+color} disabled={props.busy} aria-label={['黄色','绿色','蓝色','粉色'][index]} aria-pressed={props.color===color} onClick={()=>props.onColor(color)}/>)}</div>
      <textarea ref={input} aria-label="我的想法" placeholder="写下想法…" value={props.text} maxLength={10000} disabled={props.busy} onChange={event=>props.onText(event.target.value)}/>
      <div className="annotation-actions"><div><IconButton label="询问 Codex" disabled={props.busy||props.dirty} onClick={props.onAsk}><Sparkles size={16}/></IconButton><IconButton label="加入笔记" disabled={props.busy||props.dirty} onClick={props.onNote}><NotebookPen size={16}/></IconButton>{props.annotation&&<IconButton label="移除批注" disabled={props.busy} onClick={props.onDelete}><Trash2 size={16}/></IconButton>}</div><button type="button" disabled={props.busy} onClick={()=>props.onClose(true)}>取消</button><button type="submit" className="primary-button" disabled={props.busy}>{props.busy?'保存中…':'保存批注'}</button></div>
    </form>
  </aside>;
}
