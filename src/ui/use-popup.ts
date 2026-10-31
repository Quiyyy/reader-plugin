import {useLayoutEffect,useRef,type RefObject} from 'react';

export type PopupReason='escape'|'outside'|'focusout'|'tab';
interface Options {
  open?:boolean;panel:RefObject<HTMLElement|null>;owner?:()=>HTMLElement|null;
  onClose:(reason:PopupReason)=>void;onKey?:(event:KeyboardEvent)=>boolean;
  kind?:'menu'|'autocomplete'|'dialog'|'panel';outside?:boolean;focusOutside?:boolean;
  scoped?:boolean;fallbackFocus?:()=>HTMLElement|null;identity?:unknown;
}
interface Layer {element:HTMLElement;options:()=>Options;owner:()=>HTMLElement|null;}
const layers:Layer[]=[];
const handoff=new WeakMap<Document,{element:HTMLElement;until:number}>();
const visible=(element:HTMLElement)=>element.isConnected&&!!element.getClientRects().length&&!element.closest('[hidden],[inert],[aria-hidden="true"]');
function topLayer(document:Document,target?:EventTarget|null){
  const modal=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
  return layers.filter(layer=>layer.element.ownerDocument===document&&visible(layer.element)&&(!modal||modal.contains(layer.element))&&(!target||!layer.options().scoped||target===document.body||layer.element.contains(target as Node)||layer.owner()?.contains(target as Node))).reduce<Layer|undefined>((top,next)=>!top||top.element.contains(next.element)?next:next.element.contains(top.element)?top:next,undefined);
}
export function popupItems(root:HTMLElement){return [...root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(element=>visible(element)&&element.tabIndex>=0);}

/** Menus leave on Tab; dialogs contain Tab. Only the top visible layer owns Escape. */
export function usePopup(options:Options){
  const latest=useRef(options);latest.current=options;
  useLayoutEffect(()=>{
    if(options.open===false||!options.panel.current)return;
    const element=options.panel.current,document=element.ownerDocument,focused=document.activeElement as HTMLElement|null,recent=handoff.get(document);
    const previous=focused&&focused!==document.body?focused:recent&&recent.until>Date.now()?recent.element:focused;
    const layer:Layer={element,options:()=>latest.current,owner:()=>latest.current.owner?.()??previous};layers.push(layer);let reason:PopupReason|undefined;
    const close=(next:PopupReason)=>{reason=next;latest.current.onClose(next);};
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.cancelBubble||event.isComposing||event.keyCode===229||topLayer(document,event.target)!==layer)return;
      const current=latest.current,owner=current.owner?.()??previous;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close('escape');return;}
      if(current.onKey?.(event)){event.preventDefault();event.stopImmediatePropagation();return;}
      if(event.key!=='Tab')return;
      if(current.kind==='menu'||current.kind==='autocomplete'){
        // Let the trusted Tab default move from the opener, including across an
        // iframe boundary. Make the closing popup ineligible for focus first.
        element.inert=true;if(owner?.isConnected)owner.focus({preventScroll:true});event.stopPropagation();close('tab');
      }else if(current.kind==='dialog'){
        const items=popupItems(element),first=items[0],last=items.at(-1);
        if(!first){event.preventDefault();element.focus();}
        else if(event.shiftKey&&(document.activeElement===first||document.activeElement===element)){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    };
    const outside=(event:Event)=>{
      if(topLayer(document)!==layer)return;const current=latest.current,target=event.target as Node;
      if(element.contains(target)||current.owner?.()?.contains(target))return;
      if(event.type==='pointerdown'&&current.outside!==false)close('outside');
      if(event.type==='focusin'&&(current.focusOutside??(current.kind==='menu'||current.kind==='autocomplete')))close('focusout');
    };
    document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside);
    return()=>{
      const index=layers.indexOf(layer);if(index>=0)layers.splice(index,1);document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside);
      if(reason==='tab'||reason==='focusout'||reason==='outside'&&latest.current.kind==='autocomplete')return;
      const preferred=latest.current.owner?.()??previous,owner=preferred?.isConnected?preferred:latest.current.fallbackFocus?.();
      if(owner?.isConnected&&(!document.activeElement||document.activeElement===document.body||element.contains(document.activeElement)))handoff.set(document,{element:owner,until:Date.now()+100});
      requestAnimationFrame(()=>{const active=document.activeElement;if(owner?.isConnected&&visible(owner)&&(!active||active===document.body||element.contains(active)||active===owner))owner.focus({preventScroll:true});});
    };
  },[options.open,options.identity]);
}
