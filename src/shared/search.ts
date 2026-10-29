export interface TextMatch { start:number; end:number; }

/** Literal, case-insensitive search with offsets in the original UTF-16 text. */
export function textMatches(text:string,query:string,limit=100):TextMatch[] {
  const needle=query.trim();if(!needle||limit<1)return [];
  const pattern=new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'),matches:TextMatch[]=[];
  for(const found of text.matchAll(pattern)){matches.push({start:found.index!,end:found.index!+found[0].length});if(matches.length>=limit)break;}
  return matches;
}
export function searchSnippet(text:string,query:string) {
  const match=textMatches(text,query,1)[0],start=Math.max(0,(match?.start??0)-40),end=Math.min(text.length,(match?.end??0)+160);
  return (start?'…':'')+text.slice(start,end)+(end<text.length?'…':'');
}
