import { useLayoutEffect,useRef,type ReactNode } from 'react';

export function LibraryMenu({anchor,onClose,children,label='整理菜单'}:{anchor:HTMLButtonElement;onClose:()=>void;children:ReactNode;label?:string}) {
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const menu=ref.current!;
    const place=()=>{const rect=anchor.getBoundingClientRect(),box=menu.getBoundingClientRect();if(!anchor.isConnected||!rect.width||rect.bottom<0||rect.top>innerHeight){onClose();return;}
      menu.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.right-box.width))+'px';
      menu.style.top=(rect.bottom+box.height+6<=innerHeight-8?rect.bottom+6:Math.max(8,rect.top-box.height-6))+'px';
    };
    place();
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    // A queued scroll from bringing the anchor into view must not dismiss the
    // menu immediately after it opens. Keep it anchored while it is visible.
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!menu.contains(event.target))place();};
    window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);if(anchor.isConnected)anchor.focus({preventScroll:true});};
  },[anchor]);
  return <><button type="button" className="library-menu-scrim" aria-label={'关闭'+label} onClick={onClose}/><div className="library-menu" role="menu" aria-label={label} ref={ref} onKeyDown={event=>{
    event.stopPropagation();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(event.key==='Escape'){event.preventDefault();onClose();}
    else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1)+buttons.length)%buttons.length]?.focus();}
    else if(event.key==='Tab'&&(event.shiftKey&&index===0||!event.shiftKey&&index===buttons.length-1)){event.preventDefault();(event.shiftKey?buttons.at(-1):buttons[0])?.focus();}
  }}>{children}</div></>;
}
