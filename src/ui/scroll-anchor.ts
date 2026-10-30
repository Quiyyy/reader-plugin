export interface TextScrollAnchor {range?:Range;element?:Element;top:number;}

// Retain a character and its position in the viewport, not an absolute scroll
// offset: line wrapping can change all the geometry above the visible passage.
export function textScrollAnchor(host:HTMLElement,selector='[data-reader-paragraph]'):TextScrollAnchor|undefined {
  const box=host.getBoundingClientRect(),threshold=box.top+42;
  for(const element of host.querySelectorAll(selector)){
    if(element.getBoundingClientRect().bottom<=threshold)continue;
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;
    while((node=walker.nextNode())){
      const length=node.textContent?.length??0;if(!length)continue;
      const range=document.createRange();range.selectNodeContents(node);
      if(![...range.getClientRects()].some(rect=>rect.bottom>threshold&&rect.top<box.bottom))continue;
      let lo=0,hi=length-1;while(lo<hi){const mid=(lo+hi)>>1;range.setStart(node,mid);range.setEnd(node,mid+1);if(range.getBoundingClientRect().bottom<=threshold)lo=mid+1;else hi=mid;}
      range.setStart(node,lo);range.setEnd(node,lo+1);return {range,top:range.getBoundingClientRect().top-box.top};
    }
    const rect=element.getBoundingClientRect();if(rect.height&&rect.top<box.bottom)return {element,top:rect.top-box.top};
  }
}
export function restoreTextScrollAnchor(host:HTMLElement,anchor:TextScrollAnchor){
  const target=anchor.range?.startContainer??anchor.element;if(!target||!host.contains(target))return;
  const rect=anchor.range?.getBoundingClientRect()??anchor.element!.getBoundingClientRect();
  host.scrollTop+=rect.top-host.getBoundingClientRect().top-anchor.top;
}
