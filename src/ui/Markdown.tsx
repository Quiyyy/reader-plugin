import { createElement, useRef, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import type { NoteHeading } from './note-outline';

// Parse only text and explicit Markdown constructs. Raw HTML is always text.
function inline(text:string,depth=0):ReactNode {
  if(depth>8)return text;
  const parts:ReactNode[]=[];
  const tokens=/(`+)([^\n]*?)\1|\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let at=0;
  for(const match of text.matchAll(tokens)) {
    parts.push(text.slice(at,match.index));const key=match.index;
    parts.push(match[1]?<code key={key}>{match[2]}</code>:match[3]?<strong key={key}>{inline(match[3],depth+1)}</strong>:match[4]||match[5]?<em key={key}>{inline(match[4]??match[5],depth+1)}</em>:<a key={key} href={match[7]} target="_blank" rel="noreferrer noopener">{match[6]}</a>);
    at=match.index!+match[0].length;
  }
  parts.push(text.slice(at));return parts;
}

function CodeBlock({text,language}:{text:string;language:string}) {
  const [status,setStatus]=useState(''),code=useRef<HTMLElement>(null);
  const copy=async()=>{try{if(!navigator.clipboard)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(text);setStatus('已复制');}catch{if(code.current){const range=document.createRange();range.selectNodeContents(code.current);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);}setStatus('已选中，请复制');}};
  return <div className="markdown-code"><div className="markdown-code-head"><span>{language}</span><button type="button" aria-label="复制代码" onClick={()=>void copy()}><Copy size={13}/>{status||'复制'}</button></div><pre><code ref={code}>{text}</code></pre></div>;
}
type Line={text:string;index:number};
const listItem=(line:string)=>/^(\s*)([-+*]|\d+[.)])\s+(.*)$/.exec(line);
const fence=(line:string)=>/^ {0,3}(`{3,}|~{3,})([^\s]*)\s*$/.exec(line);
const cells=(line:string)=>line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(s=>s.trim().replace(/\\\|/g,'|'));
const divider=(line:string)=>line.includes('|')&&cells(line).every(s=>/^:?-{3,}:?$/.test(s));

export function Markdown({text,headings}:{text:string;headings?:NoteHeading[]}) {
  const headingByLine=new Map(headings?.map(h=>[h.line,h]));
  const render=(lines:Line[],depth=0):ReactNode[]=>{
    if(depth>20)return [<pre key="depth">{lines.map(l=>l.text).join('\n')}</pre>];
    const output:ReactNode[]=[];let i=0;
    const startsBlock=(at:number)=>!!lines[at]&&(!!fence(lines[at].text)||!!listItem(lines[at].text)||/^\s*>|^#{1,6}\s/.test(lines[at].text)||!!headingByLine.get(lines[at].index)||at+1<lines.length&&divider(lines[at+1].text));
    while(i<lines.length){
      const line=lines[i],value=line.text,key=line.index;
      if(!value.trim()){i++;continue;}
      const opening=fence(value);
      if(opening){const body:string[]=[];i++;while(i<lines.length&&!new RegExp('^ {0,3}'+opening[1][0]+'{'+opening[1].length+',}\\s*$').test(lines[i].text))body.push(lines[i++].text);if(i<lines.length)i++;output.push(<CodeBlock key={key} text={body.join('\n')} language={opening[2]}/>);continue;}
      const heading=headingByLine.get(key),atx=/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(value);
      if(heading||atx){output.push(createElement('h'+(heading?.level??atx![1].length),{key,...(heading?{'data-note-heading':heading.id,tabIndex:-1}:{})},inline(heading?.text??atx![2])));i+=heading&&heading.endLine>heading.line?2:1;continue;}
      if(i+1<lines.length&&value.includes('|')&&divider(lines[i+1].text)){
        const headers=cells(value),align=cells(lines[i+1].text).map(cell=>cell.startsWith(':')&&cell.endsWith(':')?'center':cell.endsWith(':')?'right':'left');i+=2;const rows:string[][]=[];
        while(i<lines.length&&lines[i].text.trim()&&lines[i].text.includes('|'))rows.push(cells(lines[i++].text));
        output.push(<div key={key} className="markdown-table" tabIndex={0} aria-label="表格"><table><thead><tr>{headers.map((cell,n)=><th key={n} style={{textAlign:align[n] as 'left'}}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row,n)=><tr key={n}>{headers.map((_,c)=><td key={c} style={{textAlign:align[c] as 'left'}}>{inline(row[c]??'')}</td>)}</tr>)}</tbody></table></div>);continue;
      }
      const first=listItem(value);
      if(first){const indent=first[1].length,ordered=/\d/.test(first[2]),items:ReactNode[]=[];
        while(i<lines.length){const item=listItem(lines[i].text);if(!item||item[1].length!==indent||/\d/.test(item[2])!==ordered)break;
          const itemKey=lines[i].index,content:Line[]=[{...lines[i],text:item[3]}],offset=item[0].length-item[3].length;i++;
          while(i<lines.length){const next=lines[i],nested=listItem(next.text);if(nested&&nested[1].length<=indent||next.text.trim()&&next.text.search(/\S/)<=indent)break;
            if(!next.text.trim()&&i+1<lines.length&&lines[i+1].text.search(/\S/)<=indent)break;
            content.push({...next,text:next.text.slice(Math.min(offset,next.text.search(/\S/)<0?offset:next.text.search(/\S/)))});i++;
          }
          const task=/^\[([ xX])\]\s+(.*)/.exec(content[0].text);if(task)content[0]={...content[0],text:task[2]};
          items.push(<li key={itemKey}>{task&&<input type="checkbox" aria-label={task[2]} checked={task[1].toLowerCase()==='x'} readOnly/>}{render(content,depth+1)}</li>);
        }
        output.push(ordered?<ol key={key} start={parseInt(first[2],10)}>{items}</ol>:<ul key={key}>{items}</ul>);continue;
      }
      if(/^\s*>/.test(value)){const quote:Line[]=[];while(i<lines.length&&/^\s*>/.test(lines[i].text)){quote.push({...lines[i],text:lines[i].text.replace(/^\s*> ?/,'')});i++;}output.push(<blockquote key={key}>{render(quote,depth+1)}</blockquote>);continue;}
      const paragraph=[value];i++;while(i<lines.length&&lines[i].text.trim()&&!startsBlock(i))paragraph.push(lines[i++].text);
      output.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
    }
    return output;
  };
  return <div className="study-markdown">{render(text.replace(/\r\n?/g,'\n').split('\n').map((text,index)=>({text,index})))}</div>;
}
