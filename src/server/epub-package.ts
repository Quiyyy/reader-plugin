import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { DOMParser } from 'linkedom';
import { parse as parseCss } from 'cssom';
import { importDocument, parseXml, resolveReference, withoutDocumentType } from './importers.js';
import { readSafeZip, safeArchivePath } from './formats/zip.js';
import { safeSvg } from './epub-svg.js';
import type { BookDocument } from '../shared/types.js';
import type { EpubPackage, EpubTarget, EpubToc, EpubNode, EpubChapter, EpubCssRule, EpubFont } from '../shared/epub.js';

const array = <T>(x: T | T[] | undefined): T[] => x == null ? [] : Array.isArray(x) ? x : [x];
const clean = (s: string) => s.replace(/\s+/g,' ').trim();
const tag = (el: Element) => el.tagName.toLowerCase().split(':').pop()!;
const decoder = new TextDecoder('utf-8', { fatal: true });
const maxNodes=100000, maxDepth=96, maxCss=512*1024;
const elements=new Set('p div span section article main aside header footer h1 h2 h3 h4 h5 h6 blockquote pre code kbd samp var em strong b i u s del ins small sub sup abbr cite q dfn mark ruby rt rp rb ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td hr br a img figure figcaption'.split(' '));
const forbidden=new Set('script iframe frame frameset object embed form input textarea button select option link meta base style template noscript canvas audio video source track'.split(' '));
const properties=new Set(('color background-color font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing text-align text-indent text-decoration text-transform white-space overflow-wrap word-break hyphens vertical-align margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-color border-style border-width border-collapse border-spacing border-radius width min-width max-width height min-height max-height display float clear list-style-type list-style-position caption-side table-layout break-before break-after break-inside page-break-before page-break-after page-break-inside writing-mode text-orientation direction unicode-bidi').split(' '));

/** References remain relative to the archive; neither browser URLs nor filesystem paths. */
export function epubTarget(base: string, href: string): EpubTarget {
  if(href.length>2048||href!==href.trim()||/[\x00-\x20\x7f\\]/.test(href)||href.includes('?')||/^(?:[a-z][\w+.-]*:|\/\/|\/)/i.test(href))throw Error('Unsupported EPUB reference');
  const hash=href.indexOf('#'), raw=hash<0?href:href.slice(0,hash);
  const decoded=decodeURIComponent(raw);
  if(/^(?:[a-z][\w+.-]*:|\/\/|\/)/i.test(decoded)||/[\x00-\x1f\x7f\\?#]/.test(decoded))throw Error('Unsafe EPUB reference');
  const resource=resolveReference(base,raw);
  const fragment=hash<0?undefined:decodeURIComponent(href.slice(hash+1));
  if(fragment && (fragment.length>1024||/[\x00-\x1f\x7f]/.test(fragment)))throw Error('Invalid EPUB fragment');
  return {resource,...(fragment?{fragment}:{})};
}
function doc(bytes:Uint8Array):Document {
  const source=withoutDocumentType(decoder.decode(bytes),'EPUB content');
  return new DOMParser().parseFromString(source,'text/html') as unknown as Document;
}
function declarations(style:any):Record<string,string> {
  const result:Record<string,string>={};
  for(let i=0;i<Math.min(style.length,200);i++){
    const property=String(style[i]).toLowerCase(), value=String(style.getPropertyValue(property)).trim();
    // Reject escaped tokens, functions/URLs, custom properties and active legacy CSS.
    // Values are emitted only for a closed property set; unsupported CSS degrades inertly.
    if(!(properties.has(property)||property==='font')||value.length>300||/[\\@{}<>\x00-\x1f]/.test(value)||/url|expression|javascript|behavior|binding|var\s*\(|attr\s*\(/i.test(value)||/[()]/.test(value)&&!/^(?:rgb|rgba|hsl|hsla)\([\d\s.,%+\-/]+\)$/i.test(value))continue;
    if(property==='display'&&!/^(block|inline|inline-block|list-item|table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|table-caption|table-column|table-column-group|none)$/i.test(value))continue;
    if(/(?:width|height)/.test(property)&&!/^auto$|^none$|^(?:\d+(?:\.\d+)?)(?:%|px|em|rem|ch|ex)$/i.test(value))continue;
    if(/-?\d{5,}/.test(value))continue;
    result[property]=value;
  }
  return result;
}
function selector(value:string):string|undefined {
  if(value.length>1000||/[\\@{}<>]|:host|:root|::part|::slotted|:has\(/i.test(value))return;
  // CSS cannot reference attributes other than book ids/classes/lang and cannot pierce the shadow root.
  if(/\[[^\]]*\]/g.test(value) && [...value.matchAll(/\[([^\]]*)\]/g)].some(m=>! /^(?:id|class|lang|dir)(?:\s*[~|^$*]?=\s*["']?[\w\u0080-\uffff .-]+["']?\s*[is]?)?$/.test(m[1]!)))return;
  if(!/^[\w\u0080-\uffff\s.#,:>+~*\[\]="'()|^$-]+$/.test(value))return;
  return value.replace(/(^|[\s,>+~])(html|body)(?=[\s.#:[,>+~]|$)/gi,'$1.reader-book-body');
}

export class EpubArchive {
  readonly bytes:Map<string,Uint8Array>;
  readonly package:EpubPackage;
  readonly legacy:BookDocument;
  private manifest=new Map<string,{path:string;mediaType:string;properties:string}>();
  private encrypted=new Set<string>();
  private chapterCache=new Map<string,EpubChapter>();
  private generatedImages=new Map<string,Uint8Array>();
  private svgCache?:{path:string;bytes:Uint8Array};
  constructor(source:Uint8Array, previous:BookDocument){
    // Retain all existing ZIP, DTD, DRM and font-encryption validation before rich parsing.
    this.legacy=importDocument('source.epub',source);
    if(this.legacy.id!==previous.id||JSON.stringify(this.legacy.chapters.map(c=>c.paragraphs))!==JSON.stringify(previous.chapters.map(c=>c.paragraphs)))throw Error('EPUB source differs from saved reading data; original positions were retained.');
    this.bytes=readSafeZip(source);
    const get=(path:string)=>{const bytes=this.bytes.get(path);if(!bytes)throw Error('Missing EPUB resource');return bytes;};
    const container=parseXml(get('META-INF/container.xml'),'EPUB container');
    const roots=array<any>(container.container.rootfiles.rootfile), opfPath=(roots.find(x=>x['@_media-type']==='application/oebps-package+xml')??roots[0])['@_full-path'];
    safeArchivePath(opfPath);
    const opf=parseXml(get(opfPath),'EPUB package').package;
    for(const item of array<any>(opf.manifest.item)){
      const target=epubTarget(opfPath,item['@_href']);
      if(target.fragment)throw Error('Manifest resource contains a fragment');
      this.manifest.set(item['@_id'],{path:target.resource,mediaType:String(item['@_media-type']??''),properties:String(item['@_properties']??'')});
    }
    if(this.bytes.has('META-INF/encryption.xml')){
      const encryption=parseXml(get('META-INF/encryption.xml'),'EPUB encryption');
      for(const entry of array<any>(encryption.encryption.EncryptedData))this.encrypted.add(epubTarget('',entry.CipherData.CipherReference['@_URI']).resource);
    }
    const sections:EpubPackage['sections']=[];
    for(const item of array<any>(opf.spine.itemref)){
      const resource=this.manifest.get(item['@_idref']);if(!resource||!['application/xhtml+xml','text/html'].includes(resource.mediaType))continue;
      const content=doc(get(resource.path));
      const linear=item['@_linear']!=='no';
      // Reproduce the legacy accepted reading order, retaining non-linear note resources separately.
      const matched=this.legacy.chapters.findIndex(chapter=>chapter.sourcePath===resource.path);
      const legacyChapter=linear&&matched>=0?matched:undefined;
      sections.push({path:resource.path,title:(legacyChapter!==undefined?previous.chapters[legacyChapter]?.title:undefined)||clean(content.querySelector('h1,h2,title')?.textContent??'')||`第 ${sections.length+1} 节`,size:get(resource.path).length,...(legacyChapter!==undefined?{legacyChapter}:{})});
    }
    const resources=[...this.manifest.values()].map(x=>({path:x.path,mediaType:x.mediaType,size:this.bytes.get(x.path)?.length??0}));
    const packagePaths=new Set(resources.filter(x=>['application/xhtml+xml','text/html'].includes(x.mediaType)).map(x=>x.path));
    const target=(base:string,href:string)=>{try{const value=epubTarget(base,href);return packagePaths.has(value.resource)?value:undefined;}catch{return undefined;}};
    let toc:EpubToc[]=[];
    const nav=[...this.manifest.values()].find(x=>x.properties.split(/\s+/).includes('nav'));
    if(nav){
      const document=doc(get(nav.path));const navs=[...document.querySelectorAll('nav')];const element=navs.find(x=>(x.getAttribute('epub:type')??'').split(/\s+/).includes('toc')||x.getAttribute('role')==='doc-toc')??navs[0];
      let count=0;
      const walk=(parent:Element,depth:number):EpubToc[]=>{
        if(depth>32)throw Error('EPUB contents nesting exceeds limit');
        const result:EpubToc[]=[];
        for(const child of [...parent.children]){
          if(++count>10000)throw Error('EPUB contents exceeds limit');
          if(tag(child)==='li'){
            const a=[...child.children].find(x=>tag(x)==='a'), dest=a&&target(nav.path,a.getAttribute('href')??'');
            const children=[...child.children].filter(x=>['ol','ul'].includes(tag(x))).flatMap(x=>walk(x,depth+1));
            if(dest)result.push({label:clean(a!.textContent??'').slice(0,500)||'未命名',target:dest,children});else result.push(...children);
          }else if(['ol','ul'].includes(tag(child)))result.push(...walk(child,depth+1));
        }return result;
      };if(element)toc=walk(element,0);
    }
    if(!toc.length){
      const ncx=this.manifest.get(opf.spine['@_toc'])??[...this.manifest.values()].find(x=>x.mediaType==='application/x-dtbncx+xml');
      if(ncx){let count=0;const walk=(points:any,depth:number):EpubToc[]=>{if(depth>32)throw Error('EPUB contents nesting exceeds limit');return array<any>(points).flatMap(point=>{if(++count>10000)throw Error('EPUB contents exceeds limit');const dest=target(ncx.path,point.content?.['@_src']??'');const children=walk(point.navPoint,depth+1);return dest?[{label:clean(String(point.navLabel?.text??'')).slice(0,500)||'未命名',target:dest,children}]:children;});};toc=walk(parseXml(get(ncx.path),'EPUB contents').ncx?.navMap?.navPoint,0);}
    }
    const metas=array<any>(opf.metadata?.meta);const fixed=metas.some(x=>x['@_property']==='rendition:layout'&&x['#text']==='pre-paginated');
    this.package={version:2,id:previous.id,sections,toc:toc.length?toc:sections.map(x=>({label:x.title,target:{resource:x.path},children:[]})),resources,layout:fixed?'fixed':'reflowable',direction:opf.spine['@_page-progression-direction']==='rtl'?'rtl':'ltr',warnings:[...(this.encrypted.size?['加密或混淆字体使用系统字体显示。']:[]),...(fixed?['固定版式按结构显示，版面可能与原页不同。']:[])]};
  }
  private resourceRecord(path:string){safeArchivePath(path);const item=this.package.resources.find(x=>x.path===path);if(!item||!this.bytes.has(path)||this.encrypted.has(path))throw Error('EPUB resource unavailable');return item;}
  private css(source:string,base:string,styles:EpubCssRule[],fonts:EpubFont[],seen:Set<string>,depth=0){
    if(source.length>maxCss||depth>8)return;
    let sheet;try{sheet=parseCss(source);}catch{return;}
    for(const rule of sheet.cssRules.slice(0,4000)){
      if(rule.type===1){const sel=selector(String(rule.selectorText));if(sel)styles.push({selector:sel,declarations:declarations(rule.style)});}
      else if(rule.type===3){try{const ref=epubTarget(base,rule.href).resource;if(!seen.has(ref)&&this.resourceRecord(ref).mediaType==='text/css'){seen.add(ref);this.css(decoder.decode(this.bytes.get(ref)!),ref,styles,fonts,seen,depth+1);}}catch{/* Remote or missing CSS is inert. */}}
      else if(rule.type===5){
        const family=String(rule.style.getPropertyValue('font-family')).replace(/^["']|["']$/g,'').trim();
        const src=String(rule.style.getPropertyValue('src')).match(/^url\(\s*["']?([^\s"'()]+)["']?\s*\)(?:\s*format\(["'][\w-]+["']\))?$/);
        if(!family||family.length>100||!src)continue;
        try{const resource=epubTarget(base,src[1]!).resource;if(!this.resourceRecord(resource).mediaType.match(/font|opentype/))continue;fonts.push({family,resource,weight:String(rule.style.getPropertyValue('font-weight')||'normal'),style:String(rule.style.getPropertyValue('font-style')||'normal')});}catch{/* Unavailable fonts use the configured fallback. */}
      }
    }
    if(styles.length>5000||fonts.length>32)throw Error('EPUB stylesheet exceeds rendering budget');
  }
  chapter(path:string):EpubChapter {
    if(this.chapterCache.has(path))return this.chapterCache.get(path)!;
    const resource=this.resourceRecord(path);if(!['application/xhtml+xml','text/html'].includes(resource.mediaType))throw Error('Not an EPUB chapter');
    const document=doc(this.bytes.get(path)!);const styles:EpubCssRule[]=[],fonts:EpubFont[]=[],warnings:string[]=[],seen=new Set<string>();
    for(const el of [...document.querySelectorAll('style,link')]){
      if(tag(el)==='style')this.css(el.textContent??'',path,styles,fonts,seen);
      else if((el.getAttribute('rel')??'').toLowerCase()==='stylesheet'){try{const ref=epubTarget(path,el.getAttribute('href')??'').resource;if(this.resourceRecord(ref).mediaType==='text/css'&&!seen.has(ref)){seen.add(ref);this.css(decoder.decode(this.bytes.get(ref)!),ref,styles,fonts,seen);}}catch{/* No external CSS. */}}
    }
    this.generatedImages.clear();
    let count=0;
    const walk=(node:Node,depth:number):EpubNode[]=>{
      const nodeId=++count;if(count>maxNodes||depth>maxDepth)throw Error('EPUB chapter exceeds structural limits');
      if(node.nodeType===3)return [node.textContent??''];if(node.nodeType!==1)return [];
      const el=node as Element,name=tag(el);if(forbidden.has(name))return [];
      if(name==='svg'){
        try {
          const ref=`.reader-generated/${createHash('sha256').update(path).update(el.outerHTML).digest('hex')}.svg`;
          if(!this.generatedImages.has(ref)){
            const used=[...this.generatedImages.values()].reduce((total,image)=>total+image.length,0);
            if(this.generatedImages.size>=32||used>=16*1024*1024)throw Error('Inline SVG cache budget exceeded');
            const data=safeSvg(el.outerHTML,href=>this.rasterAt(path,href));
            if(used+data.length>16*1024*1024)throw Error('Inline SVG cache budget exceeded');
            this.generatedImages.set(ref,data);
          }
          return [{tag:'img',attrs:{'data-reader-node':`n${nodeId}`,alt:el.querySelector('title')?.textContent??'插图'},children:[],resource:ref}];
        }catch{warnings.push('此章有暂不支持的矢量插图。');return [];}
      }
      if(name==='math'){warnings.push('数学公式以文字显示。');return [el.textContent??''];}
      const children=[...el.childNodes].flatMap(x=>walk(x,depth+1));
      if(!elements.has(name)&&name!=='body')return children;
      const attrs:Record<string,string>={'data-reader-node':`n${nodeId}`};
      for(const key of ['id','class','title','lang','dir','alt','colspan','rowspan','scope','start','value','type']){const value=el.getAttribute(key);if(value!==null&&value.length<=1024&&!/[\x00-\x1f]/.test(value))attrs[key]=value;}
      if(attrs.dir&&!['ltr','rtl','auto'].includes(attrs.dir))delete attrs.dir;
      for(const key of ['width','height']){const value=el.getAttribute(key);if(value&&/^\d{1,4}%?$/.test(value))attrs[key]=value;}
      const inline=el.getAttribute('style');if(inline){try{const decl=declarations(parseCss(`x{${inline}}`).cssRules[0]?.style??{length:0});if(Object.keys(decl).length)styles.push({selector:`[data-reader-node="${attrs['data-reader-node']}"]`,declarations:decl});}catch{/* Invalid style omitted. */}}
      if(name==='body')attrs.class=`reader-book-body ${attrs.class??''}`.trim();
      const result:Exclude<EpubNode,string>={tag:name==='body'?'div':name,attrs,children};
      if(name==='a')result.note=(el.getAttribute('epub:type')??'').split(/\s+/).includes('noteref')||el.getAttribute('role')==='doc-noteref';
      if(name==='a'){try{const dest=epubTarget(path,el.getAttribute('href')??'');if(this.package.resources.some(x=>x.path===dest.resource&&/html/.test(x.mediaType)))result.target=dest;}catch{/* External links remain non-navigating text. */}}
      if(name==='img'){try{const ref=epubTarget(path,el.getAttribute('src')??'').resource;if(this.resourceRecord(ref).mediaType.startsWith('image/'))result.resource=ref;}catch{/* No remote images. */}if(!result.resource)return attrs.alt?[{tag:'span',attrs:{class:'reader-image-unavailable'},children:[attrs.alt]}]:[];result.children=[];}
      return [result];
    };
    const root=document.body??document.documentElement;
    const nodes=walk(root,0); // unknown body wrapper is flattened; no active HTML is ever serialized.
    const result={resource:path,nodes,styles,fonts,warnings};
    if(styles.length>10000||Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw Error('EPUB chapter exceeds response budget');
    this.chapterCache.clear();this.chapterCache.set(path,result);return result;
  }
  asset(path:string):{bytes:Uint8Array;mediaType:string}{
    const generated=this.generatedImages.get(path);if(generated)return {bytes:generated,mediaType:'image/svg+xml'};
    const item=this.resourceRecord(path),bytes=this.bytes.get(path)!;
    if(item.mediaType==='image/svg+xml'){
      if(this.svgCache?.path!==path)this.svgCache={path,bytes:safeSvg(decoder.decode(bytes),href=>this.rasterAt(path,href))};
      return {bytes:this.svgCache.bytes,mediaType:'image/svg+xml'};
    }
    const ascii=Buffer.from(bytes.subarray(0,16)).toString('latin1');let mediaType='';
    if(ascii.startsWith('\x89PNG\r\n\x1a\n'))mediaType='image/png';
    else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mediaType='image/jpeg';
    else if(/^GIF8[79]a/.test(ascii))mediaType='image/gif';
    else if(ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP')mediaType='image/webp';
    else if(ascii.startsWith('wOFF'))mediaType='font/woff';else if(ascii.startsWith('wOF2'))mediaType='font/woff2';
    else if(ascii.startsWith('OTTO'))mediaType='font/otf';else if(bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0)mediaType='font/ttf';
    if(!mediaType || mediaType.startsWith('font/')&&!/font|opentype/.test(item.mediaType)||mediaType.startsWith('image/')&&!item.mediaType.startsWith('image/'))throw Error('Unsupported or mismatched EPUB asset');
    return {bytes,mediaType};
  }
  private rasterAt(base:string,href:string){
    const ref=epubTarget(base,href).resource;
    if(!/^image\/(png|jpeg|gif|webp)$/.test(this.resourceRecord(ref).mediaType))throw Error('Only local raster SVG dependencies are supported');
    return this.asset(ref);
  }
}
