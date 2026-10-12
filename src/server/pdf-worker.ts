import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import Matrix from '@thednp/dommatrix';

// Extraction needs matrix math, not a native canvas. Rendering remains in the UI.
(globalThis as any).DOMMatrix ??= Matrix;
const root=dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const input=workerData as {bytes:Uint8Array;password?:string;page?:number;indexFrom?:number};
let task:ReturnType<typeof getDocument>|undefined;
try{
  task=getDocument({data:new Uint8Array(input.bytes),password:input.password,useWasm:false,useSystemFonts:false,useWorkerFetch:false,disableFontFace:true,enableXfa:false,maxImageSize:12_000_000,cMapUrl:join(root,'cmaps')+'/',cMapPacked:true,standardFontDataUrl:join(root,'standard_fonts')+'/',verbosity:0});
  const doc=await task.promise;
  if(doc.numPages>10000)throw Error('PDF 超过 10000 页');
  if(input.indexFrom!==undefined){
    const pages:{page:number;text:string}[]=[];let size=0;
    for(let n=input.indexFrom;n<=Math.min(doc.numPages,input.indexFrom+39);n++){const page=await doc.getPage(n),content=await page.getTextContent();let text='';for(const item of content.items){if('str' in item)text+=item.str+(item.hasEOL?'\n':' ');if(text.length>500000)break;}pages.push({page:n,text:text.trim().slice(0,500000)});size+=text.length;if(size>2_000_000)break;}
    parentPort!.postMessage({ok:true,value:{pages,next:(pages.at(-1)?.page??doc.numPages)+1,total:doc.numPages}});
  }else if(input.page!==undefined){
    if(input.page<1||input.page>doc.numPages)throw Error('页码超出范围');
    const page=await doc.getPage(input.page),content=await page.getTextContent();let text='';
    for(const item of content.items){if('str' in item)text+=item.str+(item.hasEOL?'\n':' ');if(text.length>2_000_000)throw Error('单页文字超过读取上限');}
    parentPort!.postMessage({ok:true,value:{page:input.page,text:text.trim()}});
  }else{
    const meta=await doc.getMetadata(),info=meta.info as Record<string,unknown>,outline:{title:string;page:number;depth:number}[]=[];
    const pending=(await doc.getOutline()??[]).map(item=>({item,depth:0}));
    while(pending.length&&outline.length<2000){const {item,depth}=pending.shift()!;let page=1;try{const dest=typeof item.dest==='string'?await doc.getDestination(item.dest):item.dest;if(dest?.[0]!==undefined)page=(typeof dest[0]==='number'?dest[0]:await doc.getPageIndex(dest[0]))+1;}catch{}
      outline.push({title:String(item.title).slice(0,300),page:Math.min(doc.numPages,Math.max(1,page)),depth});if(depth<16)pending.unshift(...(item.items??[]).map(x=>({item:x,depth:depth+1})));}
    const labels=await doc.getPageLabels();
    parentPort!.postMessage({ok:true,value:{pages:doc.numPages,title:typeof info.Title==='string'?info.Title.slice(0,300):'',author:typeof info.Author==='string'?info.Author.slice(0,200):'',outline,labels:labels?.slice(0,10000)??null,locked:!!info.EncryptFilterName,warnings:[]}});
  }
}catch(error){const e=error as Error & {code?:number};parentPort!.postMessage({ok:false,error:e.name==='PasswordException'?(e.code===2?'PDF_PASSWORD_INVALID：密码不正确':'PDF_PASSWORD_REQUIRED：请输入 PDF 密码'):e.message});}
finally{await task?.destroy();}
