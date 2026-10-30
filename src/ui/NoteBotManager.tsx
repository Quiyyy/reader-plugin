import { NoteBotIcon } from './NoteBotIcon';
import { useEffect,useState } from 'react';
import { Bot,Plus,Star,Trash2 } from 'lucide-react';
import type { WorkspaceApi } from '../shared/workspace';
import type { NoteBot,NoteBots } from '../shared/note-bots';
import { Modal,errorText } from './study-ui';
import { ChatModelPicker } from './ChatModelPicker';

export function NoteBotManager({api,onClose,onChanged}:{api:WorkspaceApi;onClose:()=>void;onChanged:()=>void}) {
  const [state,setState]=useState<NoteBots>(),[draft,setDraft]=useState<NoteBot>(),[makeDefault,setDefault]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const choose=(bot:NoteBot,config:NoteBots)=>{setDraft({...bot});setDefault(config.defaultId===bot.id);setError('');};
  useEffect(()=>{void api.call<NoteBots>('reader_note_bots').then(value=>{setState(value);choose(value.bots.find(bot=>bot.id===value.defaultId)!,value);}).catch(e=>setError(errorText(e)));},[api]);
  const save=async()=>{if(!state||!draft||busy)return;setBusy(true);setError('');try{const value=await api.call<NoteBots>('reader_note_bot_save',{revision:state.revision,bot:draft,makeDefault});setState(value);choose(value.bots.find(bot=>bot.id===draft.id)!,value);onChanged();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  const remove=async()=>{if(!state||!draft||busy)return;setBusy(true);try{const value=await api.call<NoteBots>('reader_note_bot_delete',{revision:state.revision,id:draft.id});setState(value);choose(value.bots.find(bot=>bot.id===value.defaultId)!,value);onChanged();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return <Modal title="Note Bots" error={error} onClose={()=>{if(!busy)onClose();}}><div className="note-bot-manager">
    <div className="note-bot-list" role="group" aria-label="已配置的 Note Bots">{state?.bots.map(bot=><button type="button" key={bot.id} aria-pressed={draft?.id===bot.id} onClick={()=>choose(bot,state)} disabled={busy}><NoteBotIcon size={16}/>{bot.name}{state.defaultId===bot.id&&<Star size={12} aria-label="默认"/>}</button>)}<button type="button" disabled={busy||!state||state.bots.length>=24} onClick={()=>{setDraft({id:crypto.randomUUID(),name:'',description:'',instructions:'',model:null});setDefault(false);setError('');}}><Plus size={15}/>新建 Bot</button></div>
    {draft&&<form onSubmit={event=>{event.preventDefault();void save();}}><label>名称<input aria-label="Bot 名称" required maxLength={32} value={draft.name} disabled={busy} placeholder="例如：写作教练" onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label>用途<input aria-label="Bot 用途" maxLength={120} value={draft.description} disabled={busy} placeholder="用一句话说明它擅长什么" onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <label>职责与表达偏好<textarea aria-label="Bot 指令" required maxLength={8000} value={draft.instructions} disabled={busy} placeholder="例如：检查论证是否完整，指出缺失的依据；保留作者语气。" onChange={e=>setDraft({...draft,instructions:e.target.value})}/></label>
      <div className="note-bot-options"><ChatModelPicker api={api} value={draft.model} disabled={busy} onChange={model=>setDraft({...draft,model})}/><label><input type="checkbox" checked={makeDefault} disabled={busy||state?.defaultId===draft.id} onChange={e=>setDefault(e.target.checked)}/>默认 Bot</label></div>
      <div className="dialog-actions">{state?.bots.some(bot=>bot.id===draft.id)&&<button type="button" aria-label="删除 Note Bot" disabled={busy||state.bots.length===1} onClick={()=>void remove()}><Trash2 size={15}/>删除</button>}<button type="submit" className="primary-button" disabled={busy||!draft.name.trim()||!draft.instructions.trim()}>{busy?'保存中…':'保存 Bot'}</button></div>
    </form>}
  </div></Modal>;
}
