import {useCallback,useLayoutEffect,useRef,type RefObject} from 'react';
import {textScrollAnchor,restoreTextScrollAnchor,type TextScrollAnchor} from './scroll-anchor';

const typography=['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','lineHeight','letterSpacing','wordSpacing','wordBreak','tabSize','textIndent','textTransform','direction','paddingTop','paddingRight','paddingBottom','paddingLeft'] as const;
type NoteAnchor={top:number;text?:TextScrollAnchor;source?:{offset:number;top:number}};

/** The editor and composer stay mounted; reflow never replaces the current draft. */
export function useNoteScroll(body:RefObject<HTMLDivElement|null>,input:RefObject<HTMLTextAreaElement|null>,id:string|undefined,visual:boolean,value:string|undefined,fontSize:number){
  const controller=useRef<{content:()=>void;reflow:()=>void;navigate:(action:()=>void)=>void}|undefined>(undefined),previousFont=useRef(fontSize);
  useLayoutEffect(()=>{
    const host=body.current;if(!host||!id)return;
    const textarea=input.current,mirror=textarea?document.createElement('div'):undefined;
    if(mirror){mirror.setAttribute('aria-hidden','true');Object.assign(mirror.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',pointerEvents:'none',boxSizing:'border-box',whiteSpace:'pre-wrap',overflowWrap:'break-word',border:'0',margin:'0'});document.body.append(mirror);}
    let size={width:host.clientWidth,height:host.clientHeight},anchor:NoteAnchor={top:host.scrollTop},frame=0,settle=0,contentFrame=0,reflowing=false,suspended=false,navigating=false;
    const updateMirror=()=>{if(!mirror||!textarea||!textarea.clientWidth)return;const style=getComputedStyle(textarea);mirror.style.width=textarea.clientWidth+'px';for(const property of typography)mirror.style[property]=style[property];const text=textarea.value+'\u200b';if(mirror.textContent!==text)mirror.textContent=text;};
    const fit=()=>{if(!mirror||!textarea||!host.clientWidth)return;updateMirror();let following=0;for(let next=textarea.nextElementSibling;next;next=next.nextElementSibling){const style=getComputedStyle(next);following+=next.getBoundingClientRect().height+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);}const available=host.clientHeight-textarea.offsetTop-parseFloat(getComputedStyle(host).paddingBottom)-following;
      // Measuring with a mirror avoids shrinking the textarea to zero, which
      // temporarily clamps the outer document's scroll position.
      textarea.style.height=Math.max(240,available,mirror.getBoundingClientRect().height)+'px';};
    const sourceRect=(offset:number)=>{const node=mirror?.firstChild;if(!node)return;const range=document.createRange();const at=Math.min(offset,(node.textContent?.length??1)-1);range.setStart(node,Math.max(0,at));range.setEnd(node,Math.max(0,at)+1);return range.getBoundingClientRect();};
    const capture=()=>{
      if(reflowing||!host.clientWidth||!host.clientHeight||host.clientWidth!==size.width||host.clientHeight!==size.height)return;
      anchor={top:host.scrollTop};if(host.scrollTop<1)return;
      if(mirror&&textarea){updateMirror();const target=host.scrollTop-textarea.offsetTop+20,origin=mirror.getBoundingClientRect().top;let lo=0,hi=textarea.value.length;while(lo<hi){const mid=(lo+hi)>>1;if((sourceRect(mid)?.bottom??0)-origin<=target)lo=mid+1;else hi=mid;}const rect=sourceRect(lo);if(rect)anchor.source={offset:lo,top:textarea.offsetTop+rect.top-origin-host.scrollTop};}
      else anchor.text=textScrollAnchor(host,'.note-rich-content > *,.note-image');
    };
    const restore=()=>{if(!host.clientWidth||!host.clientHeight)return;if(anchor.top===0)host.scrollTop=0;else if(anchor.source&&mirror&&textarea){const rect=sourceRect(anchor.source.offset);if(rect)host.scrollTop=textarea.offsetTop+rect.top-mirror.getBoundingClientRect().top-anchor.source.top;}else if(anchor.text)restoreTextScrollAnchor(host,anchor.text);else host.scrollTop=anchor.top;};
    const reflow=()=>{
      if(!host.clientWidth||!host.clientHeight){suspended=true;return;}
      if(navigating){fit();size={width:host.clientWidth,height:host.clientHeight};return;}
      reflowing=true;suspended=false;size={width:host.clientWidth,height:host.clientHeight};cancelAnimationFrame(frame);cancelAnimationFrame(settle);cancelAnimationFrame(contentFrame);fit();restore();
      frame=requestAnimationFrame(()=>{frame=0;fit();restore();settle=requestAnimationFrame(()=>{settle=0;restore();reflowing=false;});});
    };
    const interrupt=()=>{if(!frame&&!settle)return;cancelAnimationFrame(frame);cancelAnimationFrame(settle);frame=settle=0;reflowing=false;navigating=false;};
    const navigate=(action:()=>void)=>{interrupt();cancelAnimationFrame(contentFrame);navigating=reflowing=true;frame=requestAnimationFrame(()=>{frame=0;fit();action();settle=requestAnimationFrame(()=>{settle=0;fit();action();size={width:host.clientWidth,height:host.clientHeight};navigating=reflowing=false;capture();});});};
    const content=()=>{if(reflowing)return;const top=host.scrollTop;fit();host.scrollTop=top;cancelAnimationFrame(contentFrame);contentFrame=requestAnimationFrame(capture);};
    fit();capture();const observer=new ResizeObserver(()=>{if(suspended||host.clientWidth!==size.width||host.clientHeight!==size.height)reflow();});observer.observe(host,{box:'border-box'});host.addEventListener('scroll',capture,{passive:true});host.addEventListener('load',content,true);for(const event of ['wheel','touchstart','pointerdown','keydown'])host.addEventListener(event,interrupt,{passive:true});controller.current={content,reflow,navigate};
    return()=>{observer.disconnect();host.removeEventListener('scroll',capture);host.removeEventListener('load',content,true);for(const event of ['wheel','touchstart','pointerdown','keydown'])host.removeEventListener(event,interrupt);cancelAnimationFrame(frame);cancelAnimationFrame(settle);cancelAnimationFrame(contentFrame);mirror?.remove();controller.current=undefined;};
  },[id,visual]);
  useLayoutEffect(()=>{if(previousFont.current!==fontSize){previousFont.current=fontSize;controller.current?.reflow();}else controller.current?.content();},[value,fontSize]);
  return useCallback((action:()=>void)=>controller.current?controller.current.navigate(action):action(),[]);
}
