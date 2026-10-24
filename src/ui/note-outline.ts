export interface NoteHeading {
  id:string;
  level:number;
  title:string;
  text:string;
  line:number;
  endLine:number;
  offset:number;
}

function headingTitle(text:string) {
  const literals:string[]=[];
  const protectedText=text.replace(/(`+)(.*?)\1|\\([\\`*_[\]{}()#+.!>-])/g,(_match,_ticks,code,escaped)=>{literals.push(code??escaped);return '\u0000'+(literals.length-1)+'\u0000';});
  return protectedText.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\*\*|__|~~/g,'').replace(/\*([^*]+)\*|_([^_]+)_/g,'$1$2').replace(/\u0000(\d+)\u0000/g,(match,index)=>literals[Number(index)]??match).trim();
}

/** Offsets use the LF-normalized text exposed by a textarea, including UTF-16 pairs. */
export function noteOutline(body:string):NoteHeading[] {
  const lines=body.replace(/\r\n?/g,'\n').split('\n'),headings:NoteHeading[]=[];
  let offset=0,fence:{character:string;length:number}|undefined;
  for(let line=0;line<lines.length;line++){
    const text=lines[line]!,fenced=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if(fence){if(fenced&&fenced[1]![0]===fence.character&&fenced[1]!.length>=fence.length&&!fenced[2]!.trim())fence=undefined;offset+=text.length+1;continue;}
    if(fenced){fence={character:fenced[1]![0]!,length:fenced[1]!.length};offset+=text.length+1;continue;}
    const atx=/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(text);
    const underline=line+1<lines.length?/^ {0,3}(=+|-+)[ \t]*$/.exec(lines[line+1]!):null;
    let level=0,content='',endLine=line;
    if(atx){level=atx[1]!.length;content=(atx[2]??'').replace(/[ \t]+#+[ \t]*$/,'').trim();}
    else if(underline&&text.trim()&&!/^(?: {4}|\t| {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]|#))/.test(text)){level=underline[1]![0]==='='?1:2;content=text.trim();endLine=line+1;}
    if(level&&headingTitle(content))headings.push({id:'heading-'+line,level,title:headingTitle(content),text:content,line,endLine,offset});
    offset+=text.length+1;
    if(endLine>line){offset+=lines[++line]!.length+1;}
  }
  return headings;
}

/** Measure wrapped text with the editor's actual font instead of guessing from line count. */
export function noteHeadingTop(textarea:HTMLTextAreaElement,offset:number):number {
  const mirror=document.createElement('div'),style=getComputedStyle(textarea);
  Object.assign(mirror.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',pointerEvents:'none',boxSizing:'border-box',width:textarea.clientWidth+'px',whiteSpace:'pre-wrap',overflowWrap:'break-word',border:'0',margin:'0'});
  for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','lineHeight','letterSpacing','wordSpacing','wordBreak','tabSize','textIndent','textTransform','direction','paddingTop','paddingRight','paddingBottom','paddingLeft'] as const)mirror.style[property]=style[property];
  mirror.textContent=textarea.value.slice(0,offset);const marker=document.createElement('span');marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
  try{return marker.getBoundingClientRect().top-mirror.getBoundingClientRect().top;}finally{mirror.remove();}
}
