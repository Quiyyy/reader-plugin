import { useRef,useState } from 'react';
import type { ReaderApi } from '../shared/types';
import type { Mutation,WorkspaceSnapshot } from '../shared/workspace';
import { folderPath,type LibraryEntry } from './library-entries';
import { Modal,errorText } from './study-ui';

export function LibraryTrashDialog({entries,snapshot,api,onClose,onChanged,onNotice}:{entries:LibraryEntry[];snapshot:WorkspaceSnapshot;api:ReaderApi;onClose:()=>void;onChanged:()=>Promise<unknown>;onNotice:(message:string,undo?:()=>Promise<void>)=>void}) {
  const [contents,setContents]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[finished,setFinished]=useState(false);
  const lock=useRef(false),single=entries.length===1;
  const apply=async()=>{
    if(lock.current)return;lock.current=true;setWorking(true);let done=0;let undo:(()=>Promise<void>)|undefined;
    // Preserve folder contents by default. Remove children before their parents
    // so reparenting does not invalidate a later selected item's revision.
    const ordered=[...entries].sort((a,b)=>Number(a.kind==='folder')-Number(b.kind==='folder')||folderPath(b.parentId,snapshot.folders).length-folderPath(a.parentId,snapshot.folders).length);
    try{
      for(const entry of ordered){
        if(entry.kind==='book'){await api.trash(entry.id);if(single)undo=async()=>{await api.restore(entry.id);};}
        else {const result=await api.study!.call<Mutation<unknown>>('reader_study_trash',{kind:entry.kind==='folder'?'folders':'notes',id:entry.id,revision:entry.revision,...(entry.kind==='folder'?{contents:single&&contents}:{})});if(single&&result.undoId)undo=async()=>{await api.study!.call('reader_study_undo',{id:result.undoId});};}
        done++;
      }
      await onChanged();onNotice(single?'已移到回收站':'所选条目已移到回收站，可在回收站恢复',undo?async()=>{await undo!();await onChanged();}:undefined);onClose();
    }catch(reason){
      setFinished(true);setError(`${done?`已完成 ${done} 项，其余未完成。`:''}${errorText(reason)} 已完成的内容可在回收站恢复。`);
      await onChanged().catch(()=>{});
    }finally{lock.current=false;setWorking(false);}
  };
  return <Modal title="移到回收站" error={error} onClose={()=>{if(!lock.current)onClose();}}><p>{single?`将“${entries[0].name}”移到回收站？`:`将所选 ${entries.length} 项移到回收站？`}</p>{entries.some(e=>e.kind==='folder')&&!finished&&(single?<label className="library-trash-option"><input type="checkbox" checked={contents} disabled={working} onChange={e=>setContents(e.target.checked)}/>同时移入文件夹中的内容</label>:<p>文件夹中的其他内容保留到上一级。</p>)}{single&&entries[0].kind==='folder'&&!contents&&!finished&&<p>文件夹中的内容保留到上一级。</p>}<div className="dialog-actions"><button type="button" disabled={working} onClick={onClose}>{finished?'关闭':'取消'}</button>{!finished&&<button type="button" className="primary-button" disabled={working} onClick={()=>void apply()}>{working?'处理中…':'移到回收站'}</button>}</div></Modal>;
}
