import type {NoteBots} from '../shared/note-bots';
import type {SourceRef} from '../shared/workspace';
export {sourceMentionHref,sourceMentionId,sourceMentionText,sourceMentionMarkdown} from '../shared/note-reference';

export interface MentionRange {from:number;to:number;query:string;raw?:string;caret?:number;}
export type MentionKind='bot'|'source'|'date'|'manage';
export interface MentionItem {id:string;kind:MentionKind;title:string;description?:string;default?:boolean;value?:string;source?:SourceRef;}
export function findMention(text:string,position:number,markdown=false):MentionRange|undefined {
  const before=text.slice(0,position),at=before.lastIndexOf('@');if(at<0||position-at>65)return;
  const preceding=before[at-1]??'';if(/[\w.%+@/-]/.test(preceding))return;
  const query=before.slice(at+1);if(/[\r\n@]/.test(query))return;
  if(markdown){
    let fence:string|undefined;for(const line of before.slice(0,at).split('\n')){const match=/^ {0,3}(`{3,}|~{3,})/.exec(line);if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length)fence=undefined;}}
    if(fence)return;const line=before.slice(before.lastIndexOf('\n',at)+1,at);if((line.match(/(?<!\\)`+/g)?.length??0)%2)return;
  }
  const suffix=/^[^\s@`()[\]{}<>，。！？、；：.,!?;:]*/.exec(text.slice(position))?.[0]??'';
  if(query.length+suffix.length>64)return;
  return {from:at,to:position+suffix.length,query,raw:query+suffix,caret:position};
}
export function mentionItems(bots:NoteBots|undefined,sources:SourceRef[],query:string,now=new Date()):MentionItem[]{
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches=(value:string)=>words.every(word=>value.toLocaleLowerCase().includes(word));
  const items:MentionItem[]=(bots?.bots??[]).filter(bot=>matches(bot.name+' '+bot.description)).sort((a,b)=>Number(b.id===bots?.defaultId)-Number(a.id===bots?.defaultId)).map(bot=>({id:bot.id,kind:'bot',title:bot.name,description:bot.description,default:bot.id===bots?.defaultId}));
  for(const source of [...sources].reverse())if(matches(source.title+' '+source.label+' '+source.quote))items.push({id:source.id,kind:'source',title:source.title,description:source.quote||source.label,source});
  for(const [offset,title,alias]of [[0,'今天','today 今日'],[1,'明天','tomorrow'],[-1,'昨天','yesterday']] as const){const date=new Date(now);date.setDate(date.getDate()+offset);const value=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;if(matches(title+' '+alias+' '+value))items.push({id:'date-'+offset,kind:'date',title,description:value,value});}
  return items;
}

/** Match textarea wrapping and scroll without injecting any of its contents as HTML. */
export function textareaCaretRect(input:HTMLTextAreaElement,position=input.selectionStart){
  const style=getComputedStyle(input),box=input.getBoundingClientRect(),mirror=document.createElement('div'),marker=document.createElement('span');
  for(const name of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textIndent','textTransform','wordSpacing','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'] as const)mirror.style[name]=style[name];
  Object.assign(mirror.style,{position:'fixed',left:box.left+'px',top:box.top+'px',width:(input.clientWidth+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth))+'px',height:box.height+'px',boxSizing:'border-box',whiteSpace:'pre-wrap',overflowWrap:'break-word',borderStyle:'solid',borderColor:'transparent',visibility:'hidden',overflow:'hidden',pointerEvents:'none'});
  mirror.textContent=input.value.slice(0,position);marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);mirror.scrollTop=input.scrollTop;mirror.scrollLeft=input.scrollLeft;const rect=marker.getBoundingClientRect();mirror.remove();return {left:rect.left,top:rect.top,bottom:rect.top+(parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5)};
}
