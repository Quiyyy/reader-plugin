import {useLayoutEffect,useRef,useState} from 'react';
import { Check,Trash2,X } from 'lucide-react';
import type { NoteComment } from '../shared/workspace';
import { IconButton } from './IconButton';
import {usePopup} from './use-popup';

export function NoteComments({comments,quote,active,onChange,onClose,owner}:{comments:NoteComment[];quote:string;active:boolean;onChange:(value:NoteComment[])=>void;onClose:()=>void;owner:()=>HTMLElement|null}) {
  const [text,setText]=useState('');
  const panel=useRef<HTMLElement>(null),drafts=useRef(new Map<string,string>());
  usePopup({open:active,panel,owner,kind:'panel',outside:false,focusOutside:false,onClose:()=>onClose()});
  useLayoutEffect(()=>{if(!active)return;setText(drafts.current.get(quote)??'');(panel.current?.querySelector<HTMLElement>('textarea')??panel.current?.querySelector<HTMLElement>('button'))?.focus({preventScroll:true});},[active,quote]);
  return <aside ref={panel} className="note-comments" hidden={!active} role="dialog" aria-label="笔记评论" aria-modal="false"><header><strong>评论</strong><IconButton label="关闭评论" onClick={onClose}><X size={17}/></IconButton></header>
    {quote&&<form onSubmit={event=>{event.preventDefault();if(!text.trim())return;onChange([...comments,{id:crypto.randomUUID(),quote:quote.slice(0,8000),text:text.trim(),createdAt:new Date().toISOString(),resolved:false}]);drafts.current.delete(quote);setText('');}}><blockquote>{quote}</blockquote><textarea aria-label="评论内容" value={text} maxLength={8000} placeholder="添加评论…" onChange={event=>{drafts.current.set(quote,event.target.value);setText(event.target.value);}}/><button type="submit" className="primary-button" disabled={!text.trim()}>添加评论</button></form>}
    {!quote&&!comments.length&&<p className="panel-empty">选中文字后添加评论</p>}
    <div className="note-comments-list">{comments.slice().reverse().map(comment=><article key={comment.id} className={comment.resolved?'resolved':''}><blockquote>{comment.quote}</blockquote><p>{comment.text}</p><footer><time>{new Date(comment.createdAt).toLocaleDateString('zh-CN')}</time><IconButton label={comment.resolved?'重新打开评论':'解决评论'} onClick={()=>onChange(comments.map(item=>item.id===comment.id?{...item,resolved:!item.resolved}:item))}><Check size={14}/></IconButton><IconButton label="删除评论" onClick={()=>onChange(comments.filter(item=>item.id!==comment.id))}><Trash2 size={14}/></IconButton></footer></article>)}</div>
  </aside>;
}
