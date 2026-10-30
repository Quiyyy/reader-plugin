import { NoteBotIcon } from './NoteBotIcon';
import { forwardRef,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState,type ReactNode } from 'react';
import { ArrowUp,ChevronDown,ChevronUp,CircleAlert,Copy,FileText,ImagePlus,MessageSquare,Plus,RotateCcw,Square,Undo2,X } from 'lucide-react';
import type { NoteBots } from '../shared/note-bots';
import type { ChatSession,WorkspaceApi } from '../shared/workspace';
import type { NoteSelection } from './NoteRichEditor';
import { Markdown,errorText,imageFile } from './study-ui';
import { IconButton } from './IconButton';
import { ChatModelPicker } from './ChatModelPicker';
import { ChatImages } from './ChatImages';
import { LibraryMenu } from './LibraryMenu';

export interface NoteAIRequest {token:number;body:string;revision:number;selection:NoteSelection;botId?:string;instruction:string;}
export interface NoteChatHandle {focus:()=>void;flush:()=>Promise<boolean>;}
interface Props {status:ReactNode;onChanged:()=>void;api:WorkspaceApi;noteId:string;request?:NoteAIRequest;bots:NoteBots;onClear:()=>void;onManage:()=>void;onPrepare:(atEnd?:boolean)=>Promise<NoteAIRequest>;}
export const NoteAI=forwardRef<NoteChatHandle,Props>(function NoteAI({status,onChanged,api,noteId,request,bots,onClear,onManage,onPrepare},ref) {
  const [botId,setBot]=useState(bots.defaultId),[model,setModel]=useState<string|null>(null),[prompt,setPrompt]=useState(''),[session,setSession]=useState<ChatSession>(),[sending,setSending]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(false),[menu,setMenu]=useState<HTMLButtonElement>(),[images,setImages]=useState<string[]>([]),[uploading,setUploading]=useState(false),[mention,setMention]=useState<{from:number;to:number;query:string}>(),[mentionIndex,setMentionIndex]=useState(0),[details,setDetails]=useState(false),[copied,setCopied]=useState(false),[undone,setUndone]=useState<string>();
  const input=useRef<HTMLTextAreaElement>(null),file=useRef<HTMLInputElement>(null),alive=useRef(true),current=useRef<ChatSession|undefined>(undefined),lock=useRef(false),creating=useRef<Promise<ChatSession>|undefined>(undefined),draft=useRef(''),imageIds=useRef<string[]>([]),dirty=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),write=useRef<Promise<unknown>>(Promise.resolve()),observedWrite=useRef<string|undefined>(undefined),options=useRef({botId,model});options.current={botId,model};
  const busy=sending||session?.status==='running',reply=session?.messages.filter(message=>message.role==='assistant').at(-1)?.text??'';
  useEffect(()=>{if(busy||bots.bots.some(bot=>bot.id===botId))return;const next=bots.bots.find(bot=>bot.id===bots.defaultId)!;setBot(next.id);setModel(next.model);},[bots.revision,botId,busy]);
  const cacheKey='reader-note-chat-'+noteId;
  const cache=()=>{try{localStorage.setItem(cacheKey,JSON.stringify({prompt:draft.current,images:imageIds.current,botId:options.current.botId,model:options.current.model}));}catch{}};
  const sync=(value:ChatSession)=>{current.current=value;if(alive.current){setSession(value);if(value.error)setError(value.error);const last=value.messages.filter(message=>message.role==='tool'&&message.undoId).at(-1);if(last&&last.id!==observedWrite.current){observedWrite.current=last.id;onChanged();}const userAt=value.messages.reduce((last,message,index)=>message.role==='user'?index:last,-1);if(value.noteTask&&value.status==='idle'&&userAt>=0&&!value.messages.slice(userAt+1).some(message=>message.role==='tool')&&value.messages.slice(userAt+1).some(message=>message.role==='assistant'&&message.text.trim()))setExpanded(true);}};
  const ensure=async()=>{
    if(current.current)return current.current;
    if(!creating.current)creating.current=api.call<ChatSession>('reader_chat_create',{noteId,botId:options.current.botId,model:options.current.model,writeNote:true}).then(value=>{sync(value);return value;}).finally(()=>{creating.current=undefined;});
    return creating.current;
  };
  const flush=async():Promise<boolean>=>{
    clearTimeout(timer.current);if(!dirty.current){try{await write.current;return !dirty.current;}catch{return false;}}
    const text=draft.current,ids=[...imageIds.current],chosenModel=options.current.model;dirty.current=false;cache();
    const work=async()=>{const value=await ensure();await api.call('reader_chat_draft',{id:value.id,draft:text,imageIds:ids,sourceIds:[],model:chosenModel});};
    write.current=write.current.catch(()=>{}).then(work);
    try{await write.current;if(draft.current===text&&JSON.stringify(imageIds.current)===JSON.stringify(ids)&&!dirty.current){try{localStorage.removeItem(cacheKey);}catch{}}return true;}catch(e){dirty.current=true;if(alive.current)setError('对话草稿未保存：'+errorText(e));return false;}
  };
  const flushRef=useRef(flush);flushRef.current=flush;
  useImperativeHandle(ref,()=>({focus:()=>input.current?.focus(),flush:()=>flushRef.current()}),[]);
  useEffect(()=>{
    alive.current=true;let cancelled=false;
    void api.call<ChatSession[]>('reader_chat_list',{noteId,allNoteSessions:true}).then(values=>{
      if(cancelled||current.current)return;const value=values[0];if(value)sync(value);
      if(!dirty.current){let local:any;try{local=JSON.parse(localStorage.getItem(cacheKey)||'null');}catch{}
        const text=typeof local?.prompt==='string'?local.prompt:value?.draft??'',ids=Array.isArray(local?.images)?local.images.filter((id:unknown)=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)).slice(0,8):value?.draftImageIds??[];
        draft.current=text;setPrompt(text);imageIds.current=ids;setImages(ids);const chosen=bots.bots.find(bot=>bot.id===(local?.botId??value?.bot?.id))??bots.bots.find(bot=>bot.id===bots.defaultId)!;setBot(chosen.id);setModel(typeof local?.model==='string'||local?.model===null?local.model:value?.model??chosen.model);
      }
    }).catch(e=>{if(!cancelled)setError(errorText(e));});
    return()=>{cancelled=true;alive.current=false;clearTimeout(timer.current);void flushRef.current();};
  },[api,noteId]);
  useEffect(()=>{if(!request)return;if(request.botId){setBot(request.botId);setModel(bots.bots.find(bot=>bot.id===request.botId)?.model??null);}if(request.instruction){draft.current=request.instruction;setPrompt(request.instruction);dirty.current=true;cache();}setMention(undefined);input.current?.focus();},[request?.token]);
  useEffect(()=>{
    if(session?.status!=='running')return;let cancelled=false,pollTimer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const value=await api.call<ChatSession>('reader_chat_get',{id:session.id});if(cancelled)return;sync(value);if(value.status==='running')pollTimer=setTimeout(poll,700);}catch(e){if(!cancelled){setError(errorText(e));pollTimer=setTimeout(poll,1500);}}};
    pollTimer=setTimeout(poll,500);return()=>{cancelled=true;clearTimeout(pollTimer);};
  },[api,session?.id,session?.status]);
  const change=(text:string)=>{draft.current=text;setPrompt(text);dirty.current=true;cache();clearTimeout(timer.current);timer.current=setTimeout(()=>void flushRef.current(),650);};
  const selectBot=(id:string)=>{setBot(id);setModel(bots.bots.find(bot=>bot.id===id)?.model??null);if(mention){const text=draft.current;change(text.slice(0,mention.from)+text.slice(mention.to));setMention(undefined);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(mention.from,mention.from);});}};
  const send=async()=>{
    if(lock.current||busy||!draft.current.trim()||uploading)return;lock.current=true;setSending(true);setError('');
    try{
      const target=await onPrepare(),message=draft.current.trim(),ids=[...imageIds.current];
      const text=message+'\n\n'+(target.selection.text?'本次选区（资料）：\n'+JSON.stringify(target.selection.text):'本次任务直接在当前笔记中完成，保留其他内容。聊天仅报告结果或提出必要的问题。');
      if(text.length>12000)throw Error('选区与要求过长，请缩短后重试');
      if(!await flush())return;const created=await ensure();setExpanded(false);
      const value=await api.call<ChatSession>('reader_chat_send',{id:created.id,messageId:crypto.randomUUID(),text,sourceIds:[],imageIds:ids,botId:options.current.botId,model:options.current.model,writeNote:true,noteRevision:target.revision});sync(value);
      if(draft.current.trim()===message){draft.current='';setPrompt('');}imageIds.current=imageIds.current.filter(id=>!ids.includes(id));setImages(imageIds.current);dirty.current=true;cache();await flush();
    }catch(e){if(alive.current){setError(errorText(e));setExpanded(true);}}finally{lock.current=false;if(alive.current)setSending(false);}
  };
  const stop=async()=>{if(!current.current)return;try{await api.call('reader_chat_stop',{id:current.current.id});sync(await api.call<ChatSession>('reader_chat_get',{id:current.current.id}));}catch(e){setError(errorText(e));}};
  const undo=async()=>{const mutation=current.current?.messages.filter(message=>message.role==='tool'&&message.undoId).at(-1);if(!mutation?.undoId)return;try{await api.call('reader_study_undo',{id:mutation.undoId});setUndone(mutation.undoId);onChanged();}catch(e){setError(errorText(e));}};
  const attach=async(files:File[])=>{setUploading(true);try{for(const file of files){if(imageIds.current.length>=8)throw Error('最多附加 8 张图片');const image=await api.uploadImage(await imageFile(file));imageIds.current=[...new Set([...imageIds.current,image.id])];setImages(imageIds.current);dirty.current=true;cache();}await flush();}catch(e){setError(errorText(e));}finally{setUploading(false);}};
  useLayoutEffect(()=>{const element=input.current;if(element){element.style.height='0px';element.style.height=Math.max(28,Math.min(140,element.scrollHeight))+'px';}},[prompt]);
  const matches=bots.bots.filter(bot=>bot.name.toLocaleLowerCase().includes((mention?.query??'').toLocaleLowerCase()));
  return <section className="note-chat-dock" aria-label="笔记对话">
    <div className="note-chat-shell">
      <div className="note-chat-statusline">{status}{busy&&<span className="note-task-status" role="status">正在处理…</span>}{!!session?.messages.length&&<button type="button" className="note-chat-history-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><MessageSquare size={14}/>{expanded?'收起对话':'展开对话'}{expanded?<ChevronDown size={13}/>:<ChevronUp size={13}/>}</button>}</div>
      {expanded&&<div className="note-chat-log" role="log" aria-label="笔记对话消息">{session?.messages.filter(message=>message.role!=='tool').map(message=><article key={message.id} className={'note-chat-message '+message.role}><p>{message.role==='user'?message.text.split('\n\n本次')[0]:message.text.length>280?message.text.slice(0,280)+'…':message.text}</p></article>)}{!busy&&!!session?.messages.length&&<div className="note-chat-actions" role="toolbar" aria-label="回复操作">{session.messages.some(message=>message.undoId)&&<IconButton label="撤销最近修改" disabled={undone===session.messages.filter(message=>message.undoId).at(-1)?.undoId} onClick={()=>void undo()}><Undo2 size={16}/></IconButton>}{reply&&<IconButton label={copied?'已复制':'复制回复'} onClick={()=>{void navigator.clipboard?.writeText(reply).then(()=>setCopied(true)).catch(e=>setError(errorText(e)));}}><Copy size={16}/></IconButton>}<IconButton label="重新指派" onClick={()=>{const last=session.messages.filter(message=>message.role==='user').at(-1)?.text.split('\n\n本次')[0]??'';change(last);onClear();input.current?.focus();}}><RotateCcw size={16}/></IconButton></div>}</div>}
      <form className="note-chat-composer" onSubmit={event=>{event.preventDefault();void send();}} onPaste={event=>{const files=[...event.clipboardData.files].filter(file=>file.type.startsWith('image/'));if(files.length){event.preventDefault();event.stopPropagation();void attach(files);}}}>
        <div className="note-composer-context">{request?.selection.text&&<span className="note-context-pill" title={request.selection.text}><FileText size={13}/><span>{request.selection.text}</span><IconButton label="移除选区上下文" onClick={onClear}><X size={12}/></IconButton></span>}{!!images.length&&<ChatImages ids={images} api={api} onRemove={id=>{imageIds.current=imageIds.current.filter(value=>value!==id);setImages(imageIds.current);dirty.current=true;cache();void flush();}}/>}</div>
        <textarea ref={input} aria-label="给 Note Bot 的要求" placeholder="提出问题，或用 @ 指派 Note Bot" rows={1} value={prompt} maxLength={12000} onChange={event=>{change(event.target.value);if(!(event.nativeEvent as InputEvent).isComposing){const before=event.target.value.slice(0,event.target.selectionStart),match=/(?:^|\s)@([^@\s]{0,32})$/.exec(before);setMention(match?{from:event.target.selectionStart-match[1].length-1,to:event.target.selectionStart,query:match[1]}:undefined);setMentionIndex(0);}}} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(mention&&event.key==='Escape'){setMention(undefined);event.preventDefault();return;}if(mention&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();setMentionIndex(index=>(index+(event.key==='ArrowDown'?1:Math.max(1,matches.length)-1))%Math.max(1,matches.length));return;}if(mention&&event.key==='Enter'&&matches.length){event.preventDefault();selectBot(matches[mentionIndex%matches.length]!.id);return;}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send();}}}/>
        <div className="note-chat-options"><IconButton label="对话附件与操作" aria-expanded={!!menu} onClick={event=>setMenu(menu?undefined:event.currentTarget)}><Plus size={23}/></IconButton><div className="note-chat-bot"><NoteBotIcon size={16}/><select aria-label="指派 Note Bot" value={botId} disabled={busy} onChange={event=>selectBot(event.target.value)}>{bots.bots.map(bot=><option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></div><div className="note-composer-spacer"/>{error&&<IconButton label="查看对话提示" active={details} onClick={()=>setDetails(!details)}><CircleAlert size={16}/></IconButton>}<ChatModelPicker api={api} value={model} disabled={busy} onChange={value=>{setModel(value);dirty.current=true;}}/>{busy?<button type="button" className="note-chat-send" aria-label="停止回复" disabled={sending} onClick={()=>void stop()}><Square size={16} fill="currentColor"/></button>:<button type="submit" className="note-chat-send" aria-label="发送" disabled={!prompt.trim()||uploading}><ArrowUp size={21}/></button>}</div>
        {error&&details&&<div className="note-chat-detail" role="alert">{error}</div>}
      </form>
      <input ref={file} hidden type="file" aria-label="选择对话图片" accept="image/png,image/jpeg,image/webp" multiple onChange={event=>{void attach([...event.target.files??[]]);event.target.value='';}}/>
      {menu&&<LibraryMenu anchor={menu} label="对话操作" onClose={()=>setMenu(undefined)}><button role="menuitem" type="button" onClick={()=>{file.current?.click();setMenu(undefined);}}><ImagePlus size={16}/>附加图片</button><button role="menuitem" type="button" onClick={()=>{onManage();setMenu(undefined);}}><NoteBotIcon size={16}/>管理 Note Bots</button><button role="menuitem" type="button" disabled={busy} onClick={()=>{void flush().then(ok=>{if(ok){current.current=undefined;setSession(undefined);onClear();setExpanded(false);setMenu(undefined);}});}}><Plus size={16}/>新话题</button></LibraryMenu>}
      {mention&&<div className="note-chat-mention" role="listbox" aria-label="对话 Note Bots">{matches.map((bot,index)=><button type="button" role="option" aria-selected={index===mentionIndex%matches.length} key={bot.id} onMouseDown={event=>event.preventDefault()} onClick={()=>selectBot(bot.id)}><NoteBotIcon size={16}/><span>{bot.name}<small>{bot.description}</small></span></button>)}</div>}
    </div>
  </section>;
});
