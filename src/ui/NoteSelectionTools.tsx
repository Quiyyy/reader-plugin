import { useLayoutEffect,useRef } from 'react';
import { Bold,Code,Italic,MessageSquare,ScanText,Strikethrough,Underline } from 'lucide-react';
import type { NoteSelection,NoteFormat } from './NoteRichEditor';

export function NoteSelectionTools({selection,onFormat,onRequest,onComment}:{selection:NoteSelection;onFormat:(kind:NoteFormat)=>void;onRequest:()=>void;onComment:()=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{const element=ref.current!;const rect=selection.rect;const place=()=>{const center=(rect?.left??80)+(rect?.width??0)/2;element.style.left=Math.max(10,Math.min(innerWidth-element.offsetWidth-10,center-element.offsetWidth/2))+'px';element.style.top=Math.max(56,(rect?.top??110)-element.offsetHeight-10)+'px';};place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);},[selection]);
  return <div ref={ref} className="note-space-selection" role="toolbar" aria-label="笔记选区操作" onMouseDown={event=>{if(!(event.target instanceof HTMLSelectElement))event.preventDefault();}}>
    <button className="note-request-edit" type="button" onClick={onRequest}><ScanText size={18}/><span>提出修改要求</span></button><i/>
    <button type="button" aria-label="加粗" aria-pressed={selection.marks?.includes('bold')??false} title="加粗" onClick={()=>onFormat('bold')}><Bold size={18}/></button>
    <button type="button" aria-label="斜体" aria-pressed={selection.marks?.includes('italic')??false} title="斜体" onClick={()=>onFormat('italic')}><Italic size={18}/></button>
    <button type="button" aria-label="下划线" aria-pressed={selection.marks?.includes('underline')??false} title="下划线" onClick={()=>onFormat('underline')}><Underline size={18}/></button>
    <button type="button" aria-label="删除线" aria-pressed={selection.marks?.includes('strike')??false} title="删除线" onClick={()=>onFormat('strike')}><Strikethrough size={18}/></button>
    <button type="button" aria-label="行内代码" aria-pressed={selection.marks?.includes('code')??false} title="行内代码" onClick={()=>onFormat('code')}><Code size={18}/></button>
    <select aria-label="段落样式" value={selection.style??'paragraph'} onChange={event=>onFormat(event.target.value as NoteFormat)}><option value="paragraph">普通段落</option><option value="heading1">标题 1</option><option value="heading">标题 2</option><option value="heading3">标题 3</option><option value="list">项目列表</option><option value="ordered">编号列表</option><option value="quote">引用</option></select><i/>
    <button className="note-comment-action" type="button" onClick={onComment}><MessageSquare size={18}/><span>评论</span></button>
  </div>;
}
