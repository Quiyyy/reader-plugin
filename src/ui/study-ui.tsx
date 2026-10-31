export { Markdown } from './Markdown';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { type SourceRef,type WorkspaceApi } from '../shared/workspace';
import {usePopup,popupItems} from './use-popup';
export const errorText=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试';
export function Modal({title,children,onClose,error,closeLabel}:{title:string;children:ReactNode;onClose:()=>void;error?:string;closeLabel?:string}){
  const ref=useRef<HTMLDialogElement>(null);
  usePopup({panel:ref,kind:'dialog',outside:false,focusOutside:false,onClose:()=>onClose()});
  useEffect(()=>{const dialog=ref.current!;dialog.showModal();const items=popupItems(dialog),field=items.find(element=>element.matches('input,textarea,select'))??items.find(element=>!element.closest('header'));field?.focus({preventScroll:true});return()=>dialog.close();},[]);
  return <dialog className="study-dialog" aria-label={title} ref={ref} onCancel={e=>{e.preventDefault();onClose();}}><header><h2>{title}</h2><IconButton label={closeLabel??"关闭"} onClick={onClose}><X size={17}/></IconButton></header>{error&&<p className="study-error" role="alert">{error}</p>}{children}</dialog>;
}
export function SourceCard({source,api,onOpen,compact=false}:{source:SourceRef;api:WorkspaceApi;onOpen:(source:SourceRef)=>void;compact?:boolean}){const [image,setImage]=useState(''),[expanded,setExpanded]=useState(!compact);useEffect(()=>{let cancelled=false;if(source.imageId)void api.asset(source.imageId).then(value=>{if(!cancelled)setImage(`data:${value.mimeType};base64,${value.data}`);}).catch(()=>{});return()=>{cancelled=true;};},[source.imageId,api]);return <div className={'study-source'+(compact?' compact':'')}><button className="source-title" onClick={()=>compact?setExpanded(!expanded):onOpen(source)} title={source.title+' · '+source.label}>{source.title} <span>· {source.label}</span></button>{expanded&&<>{image&&<img src={image} alt={source.label}/>} {source.quote&&<blockquote>{source.quote}</blockquote>}<button className="text-button" onClick={()=>onOpen(source)}>回到原文 ↗</button></>}</div>;}
export { appearanceVariables } from './appearance';
/** Small safe Markdown view: raw HTML is always escaped by React. */

export async function imageFile(file:File):Promise<string>{if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024)throw Error('请选择 8 MiB 内的 PNG、JPEG 或 WebP 图片');const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});const image=new Image();image.src=data;await image.decode();if(image.naturalWidth*image.naturalHeight>24_000_000)throw Error('图片尺寸过大');const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png').split(',')[1]!;}
