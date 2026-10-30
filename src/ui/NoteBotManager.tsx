import { useEffect,useRef,useState } from 'react';
import { ArrowLeft,Check,Plus,Trash2 } from 'lucide-react';
import type { WorkspaceApi } from '../shared/workspace';
import type { NoteBot,NoteBots } from '../shared/note-bots';
import { errorText } from './study-ui';
import { ChatModelPicker } from './ChatModelPicker';
import { NoteBotIcon } from './NoteBotIcon';
import { IconButton } from './IconButton';

export function NoteBotManager({api,active=true,embedded=false,onClose,onChanged}:{api:WorkspaceApi;active?:boolean;embedded?:boolean;onClose:()=>void;onChanged:()=>void}) {
  const [state,setState]=useState<NoteBots>(),[draft,setDraft]=useState<NoteBot>(),[makeDefault,setDefault]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const drafts=useRef(new Map<string,{bot:NoteBot;makeDefault:boolean}>()),lock=useRef(false),back=useRef<HTMLButtonElement>(null);
  const remember=()=>{if(!draft)return;const original=state?.bots.find(bot=>bot.id===draft.id);if(!original||JSON.stringify(original)!==JSON.stringify(draft)||makeDefault!==(state?.defaultId===draft.id))drafts.current.set(draft.id,{bot:draft,makeDefault});else drafts.current.delete(draft.id);};
  const choose=(bot:NoteBot,config:NoteBots)=>{remember();const cached=drafts.current.get(bot.id);setDraft({...cached?.bot??bot});setDefault(cached?.makeDefault??config.defaultId===bot.id);setError('');setSaved(false);};
  useEffect(()=>{if(!active||state)return;let cancelled=false;void api.call<NoteBots>('reader_note_bots').then(value=>{if(cancelled)return;setState(value);const bot=value.bots.find(bot=>bot.id===value.defaultId)!;setDraft({...bot});setDefault(true);}).catch(e=>{if(!cancelled)setError(errorText(e));});return()=>{cancelled=true;};},[api,active,!!state]);
  useEffect(()=>{if(active)back.current?.focus();},[active]);
  const change=(patch:Partial<NoteBot>)=>{if(draft)setDraft({...draft,...patch});setSaved(false);};
  const save=async()=>{if(!state||!draft||lock.current)return;lock.current=true;setBusy(true);setError('');try{const value=await api.call<NoteBots>('reader_note_bot_save',{revision:state.revision,bot:draft,makeDefault});drafts.current.delete(draft.id);setState(value);setDraft({...value.bots.find(bot=>bot.id===draft.id)!});setDefault(value.defaultId===draft.id);setSaved(true);onChanged();}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}};
  const remove=async()=>{if(!state||!draft||lock.current)return;lock.current=true;setBusy(true);setError('');try{const value=await api.call<NoteBots>('reader_note_bot_delete',{revision:state.revision,id:draft.id});drafts.current.delete(draft.id);setState(value);setDraft({...value.bots.find(bot=>bot.id===value.defaultId)!});setDefault(true);setSaved(false);onChanged();}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}};
  const add=()=>{remember();setDraft({id:crypto.randomUUID(),name:'',description:'',instructions:'',model:null});setDefault(false);setError('');setSaved(false);};
  const choices=[...(state?.bots??[]),...[...drafts.current.values()].map(item=>item.bot).filter(bot=>!state?.bots.some(item=>item.id===bot.id))];if(draft&&!choices.some(bot=>bot.id===draft.id))choices.push(draft);
  return <section className={'note-bot-page'+(embedded?' embedded':'')} hidden={!active} aria-label="Note Bot 配置">
    {!embedded&&<header className="note-bot-page-head"><button ref={back} type="button" className="icon-button" aria-label="返回笔记" title="返回笔记" disabled={busy} onClick={onClose}><ArrowLeft size={18}/></button><NoteBotIcon size={22}/><h1>Note Bots</h1></header>}
    <div className="note-bot-page-scroll"><div className="note-bot-page-content">
      <div className="note-bot-page-picker"><select aria-label="选择 Note Bot 配置" disabled={busy||!state} value={draft?.id??''} onChange={event=>{const bot=choices.find(bot=>bot.id===event.target.value);if(bot&&state)choose(bot,state);}}>{choices.map(bot=><option key={bot.id} value={bot.id}>{bot.name||'新建 Bot'}{state?.defaultId===bot.id?' · 默认':''}</option>)}</select><IconButton label="新建 Bot" disabled={busy||!state||state.bots.length>=24} onClick={add}><Plus size={18}/></IconButton></div>
      {error&&<p className="note-bot-page-error" role="alert">{error}</p>}
      {!state&&!error&&<p role="status">正在加载…</p>}
      {draft&&<form id="note-bot-configuration" className="note-bot-page-form" onSubmit={event=>{event.preventDefault();void save();}}>
        <label>名称<input aria-label="Bot 名称" required maxLength={32} value={draft.name} disabled={busy} placeholder="例如：写作教练" onChange={event=>change({name:event.target.value})}/></label>
        <label>用途<input aria-label="Bot 用途" maxLength={120} value={draft.description} disabled={busy} placeholder="用一句话说明它擅长什么" onChange={event=>change({description:event.target.value})}/></label>
        <label>职责与表达偏好<textarea aria-label="Bot 指令" required maxLength={8000} value={draft.instructions} disabled={busy} placeholder="例如：检查论证是否完整，指出缺失的依据；保留作者语气。" onChange={event=>change({instructions:event.target.value})}/></label>
        <div className="note-bot-page-options"><ChatModelPicker api={api} value={draft.model} disabled={busy} onChange={model=>change({model})}/><label><input type="checkbox" checked={makeDefault} disabled={busy||state?.defaultId===draft.id} onChange={event=>{setDefault(event.target.checked);setSaved(false);}}/>默认 Bot</label></div>
      </form>}
    </div></div>
    <footer className="note-bot-page-footer"><div>{draft&&state?.bots.some(bot=>bot.id===draft.id)&&<IconButton label="删除 Note Bot" disabled={busy||state.bots.length===1} onClick={()=>void remove()}><Trash2 size={17}/></IconButton>}<span className="note-bot-save-status" role="status">{saved&&<><Check size={14}/>已保存</>}</span><button type="submit" form="note-bot-configuration" className="primary-button" disabled={busy||!draft?.name.trim()||!draft?.instructions.trim()}>{busy?'保存中…':'保存 Bot'}</button></div></footer>
  </section>;
}
