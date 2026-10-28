import { useEffect,useState } from 'react';
import { NotebookPen } from 'lucide-react';
import type { NoteSummary,SourceRef,WorkspaceApi } from '../shared/workspace';

export function NoteListItem({note,api,sources,onOpen,active=false}:{note:NoteSummary;api:WorkspaceApi;sources:SourceRef[];onOpen:(id:string)=>void;active?:boolean}) {
  const imageId=note.imageIds[0]??sources.find(source=>note.sourceIds.includes(source.id)&&source.imageId)?.imageId;
  const [image,setImage]=useState<{id:string;src:string}>();
  useEffect(()=>{
    let cancelled=false;setImage(undefined);
    if(imageId)void api.asset(imageId).then(value=>{if(!cancelled)setImage({id:imageId,src:`data:${value.mimeType};base64,${value.data}`});}).catch(()=>{});
    return()=>{cancelled=true;};
  },[api,imageId]);
  const title=note.title||'未命名笔记',preview=note.preview.replace(/\s+/g,' ').trim();
  const updated=new Date(note.updatedAt),today=updated.toDateString()===new Date().toDateString();
  return <button className={'study-note-row'+(active?' active':'')} aria-label={title+(preview?' '+preview:'')} onClick={()=>onOpen(note.id)}>
    <span className="study-note-thumb" aria-hidden="true">{image&&image.id===imageId?<img src={image.src} alt=""/>:<NotebookPen size={19} strokeWidth={1.3}/>}</span>
    <span className="study-note-info"><span className="study-note-heading"><h3 title={title}>{title}</h3><time dateTime={note.updatedAt} title={updated.toLocaleString('zh-CN')}>{new Intl.DateTimeFormat('zh-CN',today?{hour:'2-digit',minute:'2-digit'}:{month:'numeric',day:'numeric'}).format(updated)}</time></span>{preview&&<p>{preview}</p>}</span>
  </button>;
}
