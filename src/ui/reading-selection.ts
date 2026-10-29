import type { BookDetail } from '../shared/types';
import type { Annotation,SourceInput,SourceRef } from '../shared/workspace';
import { textMatches } from '../shared/search';
export function searchRanges(root:Element,query:string) {return textMatches(root.textContent??'',query).flatMap(match=>{const range=rangeAt(root,match.start,match.end);return range?[range]:[];});}
export function paintSearch(name:string,ranges:Range[],active?:Range) {
  const registry=(CSS as any).highlights,HighlightClass=(globalThis as any).Highlight;if(!registry||!HighlightClass)return;
  if(!ranges.length){registry.delete(name);registry.delete(name+'-active');return;}
  const all=new HighlightClass(...ranges);all.priority=1;registry.set(name,all);
  const current=new HighlightClass(...(active?[active]:[]));current.priority=2;registry.set(name+'-active',current);
}
function offset(element:Element,node:Node,at:number){const range=document.createRange();range.selectNodeContents(element);range.setEnd(node,at);return range.toString().length;}
export function textSelection(book:BookDetail):{source:SourceInput;rect:DOMRect}|undefined{
  const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;const range=selection.getRangeAt(0);
  const start=(range.startContainer.nodeType===Node.ELEMENT_NODE?range.startContainer:range.startContainer.parentElement) as Element|null,end=(range.endContainer.nodeType===Node.ELEMENT_NODE?range.endContainer:range.endContainer.parentElement) as Element|null;
  const a=start?.closest<HTMLElement>('[data-reader-paragraph]'),b=end?.closest<HTMLElement>('[data-reader-paragraph]');if(!a||!b||!a.closest('.reading-content')||!b.closest('.reading-content'))return;
  const quote=selection.toString().trim();if(!quote)return;if(quote.length>20000)throw Error('请选择少于两万字的片段');
  const startChapter=Number(a.dataset.chapter),endChapter=Number(b.dataset.chapter);const from={chapter:startChapter,paragraph:Number(a.dataset.readerParagraph),offset:Math.max(0,offset(a,range.startContainer,range.startOffset)-Number(a.dataset.readerPrefix??0)),...(book.document.format==='online'?{chapterId:book.document.chapters[startChapter]!.id}:{})},to={chapter:endChapter,paragraph:Number(b.dataset.readerParagraph),offset:Math.max(0,offset(b,range.endContainer,range.endOffset)-Number(b.dataset.readerPrefix??0)),...(book.document.format==='online'?{chapterId:book.document.chapters[endChapter]!.id}:{})};
  return {source:{bookId:book.summary.id,quote,anchor:{kind:'text',start:from,end:to}},rect:range.getBoundingClientRect()};
}
export function rangeAt(element:Element,start:number,end:number){const walk=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null,left=start,right=end;const range=document.createRange();let started=false;while((node=walk.nextNode())){const n=node.textContent?.length??0;if(!started&&left<=n){range.setStart(node,left);started=true;}if(started&&right<=n){range.setEnd(node,right);return range;}left-=n;right-=n;}return undefined;}
export interface AnnotationRange { id:string; range:Range; }
export function annotationAtPoint(ranges:AnnotationRange[],x:number,y:number){return [...ranges].reverse().find(({range})=>[...range.getClientRects()].some(rect=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom))?.id;}
export function textHighlights(root:Element,bookId:string,annotations:Annotation[],sources:SourceRef[]){const registry=(CSS as any).highlights,HighlightClass=(globalThis as any).Highlight;const hitRanges:AnnotationRange[]=[];const grouped:Record<string,Range[]>={yellow:[],green:[],blue:[],pink:[]};for(const a of annotations){const ref=sources.find(s=>s.id===a.sourceId);if(!ref||ref.bookId!==bookId||ref.anchor.kind!=='text')continue;const {start,end}=ref.anchor;const from=root.querySelector(`[data-chapter="${start.chapter}"][data-reader-paragraph="${start.paragraph}"]`),to=root.querySelector(`[data-chapter="${end.chapter}"][data-reader-paragraph="${end.paragraph}"]`);if(!from||!to)continue;const first=rangeAt(from,start.offset+Number((from as HTMLElement).dataset.readerPrefix??0),start.offset+Number((from as HTMLElement).dataset.readerPrefix??0)),last=rangeAt(to,end.offset+Number((to as HTMLElement).dataset.readerPrefix??0),end.offset+Number((to as HTMLElement).dataset.readerPrefix??0));if(first&&last){first.setEnd(last.endContainer,last.endOffset);grouped[a.color]!.push(first);hitRanges.push({id:a.id,range:first});}}
  if(registry&&HighlightClass)for(const [color,ranges] of Object.entries(grouped))registry.set('reader-'+color,new HighlightClass(...ranges));return hitRanges;
}
