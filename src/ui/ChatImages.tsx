import { useEffect,useState } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceApi } from '../shared/workspace';
import { IconButton } from './IconButton';
import { Modal } from './study-ui';
export function ChatImages({ids,api,onRemove}:{ids:string[];api:WorkspaceApi;onRemove?:(id:string)=>void}) {
  const [images,setImages]=useState<Record<string,string>>({}),[selected,setSelected]=useState<string>();
  useEffect(()=>{let cancelled=false;for(const id of ids)void api.asset(id).then(image=>{if(!cancelled)setImages(old=>({...old,[id]:`data:${image.mimeType};base64,${image.data}`}));}).catch(()=>{});return()=>{cancelled=true;};},[ids.join(','),api]);
  return <><div className="study-chat-images">{ids.map((id,index)=><div key={id}><button type="button" aria-label={'查看截图 '+(index+1)} onClick={()=>setSelected(id)}>{images[id]?<img src={images[id]} alt={'截图 '+(index+1)}/>:<span>图片</span>}</button>{onRemove&&<IconButton label={'移除截图 '+(index+1)} onClick={()=>onRemove(id)}><X size={12}/></IconButton>}</div>)}</div>{selected&&<Modal title="截图" onClose={()=>setSelected(undefined)}>{images[selected]&&<img className="study-chat-image-preview" src={images[selected]} alt="截图预览"/>}</Modal>}</>;
}
