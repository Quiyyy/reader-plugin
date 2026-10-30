import { useState } from 'react';
import { Check,Trash2,X } from 'lucide-react';
import type { NoteComment } from '../shared/workspace';
import { IconButton } from './IconButton';

export function NoteComments({comments,quote,onChange,onClose}:{comments:NoteComment[];quote:string;onChange:(value:NoteComment[])=>void;onClose:()=>void}) {
  const [text,setText]=useState('');
  return <aside className="note-comments" role="dialog" aria-label="笔记评论" aria-modal="false"><header><strong>评论</strong><IconButton label="关闭评论" onClick={onClose}><X size={17}/></IconButton></header>
    {quote&&<form onSubmit={event=>{event.preventDefault();if(!text.trim())return;onChange([...comments,{id:crypto.randomUUID(),quote:quote.slice(0,8000),text:text.trim(),createdAt:new Date().toISOString(),resolved:false}]);setText('');}}><blockquote>{quote}</blockquote><textarea aria-label="评论内容" value={text} maxLength={8000} placeholder="添加评论…" onChange={event=>setText(event.target.value)} autoFocus/><button type="submit" className="primary-button" disabled={!text.trim()}>添加评论</button></form>}
    {!quote&&!comments.length&&<p className="panel-empty">选中文字后添加评论</p>}
    <div className="note-comments-list">{comments.slice().reverse().map(comment=><article key={comment.id} className={comment.resolved?'resolved':''}><blockquote>{comment.quote}</blockquote><p>{comment.text}</p><footer><time>{new Date(comment.createdAt).toLocaleDateString('zh-CN')}</time><IconButton label={comment.resolved?'重新打开评论':'解决评论'} onClick={()=>onChange(comments.map(item=>item.id===comment.id?{...item,resolved:!item.resolved}:item))}><Check size={14}/></IconButton><IconButton label="删除评论" onClick={()=>onChange(comments.filter(item=>item.id!==comment.id))}><Trash2 size={14}/></IconButton></footer></article>)}</div>
  </aside>;
}
