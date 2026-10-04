import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ReaderStore } from './store.js';
import { EpubArchive } from './epub-package.js';
import { epubAppearanceSchema, epubLocationSchema, type EpubLocation, type EpubAppearance, type EpubState, type EpubMark, type EpubOpen, type EpubNode } from '../shared/epub.js';
import type { BookDetail, Locator } from '../shared/types.js';

const markSchema=z.object({id:z.string().max(100),label:z.string().max(240),createdAt:z.string(),location:epubLocationSchema.optional(),legacy:z.object({chapter:z.number().int().min(0),paragraph:z.number().int().min(0)}).optional()});
const stateSchema=z.object({version:z.literal(2),sourceHash:z.string(),location:epubLocationSchema.optional(),bookmarks:z.array(markSchema).max(1000),appearance:epubAppearanceSchema,updatedAt:z.string().optional(),legacyRevision:z.string(),deletedLegacyIds:z.array(z.string()).max(1000).optional(),progress:z.number().min(0).max(1).optional()});
type SavedState=z.infer<typeof stateSchema>;
const normalized=(s:string)=>s.replace(/\s+/g,' ').trim();
const nodeText=(node:EpubNode):string=>typeof node==='string'?node:node.children.map(nodeText).join('');
const revision=(book:BookDetail)=>createHash('sha256').update(JSON.stringify(book.summary.locator)).digest('hex');

/** A unique structural/text match is required. No guesses, percentages or destructive migration. */
function migrate(archive:EpubArchive,book:BookDetail,legacy:Locator):EpubLocation|undefined {
  const section=archive.package.sections.find(x=>x.legacyChapter===legacy.chapter);
  const paragraph=book.document.chapters[legacy.chapter]?.paragraphs[legacy.paragraph];
  if(!section||!paragraph)return;
  const exact=normalized(paragraph);const matches:Exclude<EpubNode,string>[]=[];
  const walk=(node:EpubNode):boolean=>{
    if(typeof node==='string')return false;
    const below=node.children.map(walk).some(Boolean);
    if(normalized(nodeText(node))===exact){if(!below)matches.push(node);return true;}
    return below;
  };
  archive.chapter(section.path).nodes.forEach(walk);
  if(matches.length!==1)return;
  const paras=book.document.chapters[legacy.chapter]!.paragraphs;
  return {version:2,sourceHash:book.summary.id,resource:section.path,element:matches[0]!.attrs['data-reader-node']!,offset:0,quote:{exact:exact.slice(0,160),prefix:(paras[legacy.paragraph-1]??'').slice(-60),suffix:(paras[legacy.paragraph+1]??'').slice(0,60)}};
}
function stateFor(raw:unknown,book:BookDetail,archive:EpubArchive):SavedState {
  const currentRevision=revision(book);
  const state:SavedState=raw===undefined?{version:2,sourceHash:book.summary.id,bookmarks:[],appearance:{style:'original',flow:'scroll',fontSize:20},legacyRevision:currentRevision}:stateSchema.parse(raw);
  if(state.sourceHash!==book.summary.id)throw Error('EPUB state source hash mismatch');
  if(state.legacyRevision!==currentRevision || !state.location){state.location=migrate(archive,book,book.summary.locator);state.legacyRevision=currentRevision;}
  const removed=new Set(state.deletedLegacyIds??[]),existing=new Set(state.bookmarks.map(x=>x.id));
  for(const mark of book.bookmarks){if(!existing.has(mark.id)&&!removed.has(mark.id))state.bookmarks.push({...mark,legacy:mark.locator,location:migrate(archive,book,mark.locator)});}
  // Failed matches retain the original legacy locator and bookmark ID.
  return state;
}
export class EpubService {
  private cached?:{id:string;archive:EpubArchive};
  constructor(private store:ReaderStore){}
  private async read(id:string){
    const snapshot=await this.store.epubSnapshot(id);
    const archive=this.cached?.id===id?this.cached.archive:new EpubArchive(snapshot.source,snapshot.detail.document);
    this.cached={id,archive}; // one bounded ZIP cache; chapter cache also retains at most one document
    return {...snapshot,archive};
  }
  private async archive(id:string){if(this.cached?.id===id){await this.store.assertActive(id);return this.cached.archive;}return (await this.read(id)).archive;}
  async open(id:string):Promise<EpubOpen>{
    const {detail,rich,archive}=await this.read(id),state=stateFor(rich,detail,archive);
    const legacy=detail.summary.locator,section=archive.package.sections.find(x=>x.legacyChapter===legacy.chapter),paras=detail.document.chapters[legacy.chapter]?.paragraphs??[];
    return {package:archive.package,state,...(!state.location&&section?{legacyLocation:{resource:section.path,exact:paras[legacy.paragraph]??'',prefix:paras[legacy.paragraph-1]??'',suffix:paras[legacy.paragraph+1]??''}}:{})};
  }
  async chapter(id:string,path:string){return (await this.archive(id)).chapter(path);}
  async resource(id:string,path:string,offset:number){
    const {bytes,mediaType}=(await this.archive(id)).asset(path);
    if(offset>bytes.length)throw Error('EPUB resource offset out of range');
    const end=Math.min(bytes.length,offset+192*1024);
    return {mediaType,data:Buffer.from(bytes.subarray(offset,end)).toString('base64'),total:bytes.length,next:end<bytes.length?end:null};
  }
  private validate(archive:EpubArchive,location:EpubLocation){
    epubLocationSchema.parse(location);
    if(location.sourceHash!==archive.package.id)throw Error('EPUB locator belongs to another source');
    let found:EpubNode|undefined;
    const walk=(node:EpubNode)=>{if(typeof node!=='string'){if(node.attrs['data-reader-node']===location.element)found=node;node.children.forEach(walk);}};
    archive.chapter(location.resource).nodes.forEach(walk);
    if(!found||location.offset>nodeText(found).length)throw Error('EPUB locator is outside the source');
    const text=normalized(nodeText(found).slice(location.offset));
    if(location.quote.exact && !text.startsWith(normalized(location.quote.exact)))throw Error('EPUB locator text does not match the source');
  }
  async save(id:string,location:EpubLocation,appearance:EpubAppearance){
    const archive=await this.archive(id);this.validate(archive,location);
    return this.store.updateEpub(id,(raw,book)=>{
      const state=stateFor(raw,book,archive),lastReadAt=new Date().toISOString();
      const index=archive.package.sections.findIndex(s=>s.path===location.resource);
      let textBefore=0,textTotal=0,found=false;
      const measure=(node:EpubNode)=>{if(typeof node==='string'){textTotal+=node.length;if(!found)textBefore+=node.length;}else{if(node.attrs['data-reader-node']===location.element)found=true;node.children.forEach(measure);}};
      archive.chapter(location.resource).nodes.forEach(measure);
      const sections=archive.package.sections,weight=sections.reduce((n,s)=>n+s.size,0);
      const progress=index<0?(state.progress??book.summary.progress):Math.min(1,(sections.slice(0,index).reduce((n,s)=>n+s.size,0)+sections[index]!.size*Math.min(1,(textBefore+location.offset)/Math.max(1,textTotal)))/Math.max(1,weight));
      Object.assign(state,{location,appearance:epubAppearanceSchema.parse(appearance),updatedAt:lastReadAt,progress});
      return {state,result:{progress,lastReadAt}};
    });
  }
  async settings(id:string,appearance:EpubAppearance){const archive=await this.archive(id);return this.store.updateEpub(id,(raw,book)=>{const state=stateFor(raw,book,archive);state.appearance=epubAppearanceSchema.parse(appearance);return {state,result:{saved:true}};});}
  async bookmark(id:string,location:EpubLocation,label:string):Promise<EpubMark[]>{
    const archive=await this.archive(id);this.validate(archive,location);
    return this.store.updateEpub(id,(raw,book)=>{const state=stateFor(raw,book,archive);if(state.bookmarks.length>=1000)throw Error('Too many bookmarks');
      if(!state.bookmarks.some(x=>x.location?.resource===location.resource&&x.location.element===location.element&&x.location.offset===location.offset))state.bookmarks.push({id:randomUUID(),location,label:label.slice(0,240),createdAt:new Date().toISOString()});
      return {state,result:state.bookmarks};});
  }
  async removeBookmark(id:string,bookmarkId:string):Promise<EpubMark[]>{const archive=await this.archive(id);return this.store.updateEpub(id,(raw,book)=>{const state=stateFor(raw,book,archive);state.bookmarks=state.bookmarks.filter(x=>x.id!==bookmarkId);if(book.bookmarks.some(x=>x.id===bookmarkId))state.deletedLegacyIds=[...new Set([...(state.deletedLegacyIds??[]),bookmarkId])];return {state,result:state.bookmarks};});}
}
