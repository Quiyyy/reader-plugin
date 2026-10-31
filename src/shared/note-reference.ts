import type {SourceRef} from './workspace.js';

export const sourceMentionHref=(id:string)=>'reader://source/'+id;
export const sourceMentionId=(href:string)=>/^reader:\/\/source\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(href)?.[1];
export const sourceMentionText=(source:SourceRef)=>(source.title+' · '+source.label).replace(/\s+/g,' ').slice(0,100);
export function sourceMentionMarkdown(source:SourceRef){const label=sourceMentionText(source).replace(/[\\\[\]]/g,'\\$&');return `[${label}](${sourceMentionHref(source.id)})`;}
/** Keep internal identifiers out of shelf summaries, including near the cut-off. */
export function noteSummaryPreview(text:string,limit=180){return text.slice(0,limit+240).replace(/\[((?:\\.|[^\]\\])*)\]\((reader:\/\/source\/[a-f0-9-]{36})\)/gi,(original,label:string,href:string)=>sourceMentionId(href)?label.replace(/\\([\\\[\]])/g,'$1'):original).slice(0,limit);}
