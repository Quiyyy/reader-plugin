import type { EpubApi, EpubAppearance, EpubChapter, EpubLocation, EpubNode, EpubTarget } from '../shared/epub';

const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();
const permitted=new Set('p div span section article main aside header footer h1 h2 h3 h4 h5 h6 blockquote pre code kbd samp var em strong b i u s del ins small sub sup abbr cite q dfn mark ruby rt rp rb ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td hr br a img figure figcaption'.split(' '));
const attributes=new Set('id class title lang dir alt colspan rowspan scope start value type width height data-reader-node'.split(' '));
const baseStyles=`:host{display:block;color:inherit;background:inherit;contain:layout paint style;isolation:isolate;overflow:auto;overscroll-behavior:contain;overflow-anchor:none;scrollbar-gutter:stable}*{box-sizing:border-box} .reader-book-body{margin:0 auto;padding:32px 24px 64px;max-width:100%;overflow-wrap:anywhere;font:20px/1.9 'Noto Serif SC','Songti SC','SimSun',serif}p{margin:0 0 1em}h1,h2,h3{line-height:1.5}img{max-width:100%!important;height:auto;object-fit:contain;cursor:zoom-in}table{border-collapse:collapse;max-width:100%;font-size:.9em}td,th{padding:.35em .6em}pre{white-space:pre-wrap}a[role=link]{color:var(--accent,#65734b);text-decoration:underline;text-underline-offset:3px;cursor:pointer}figure{max-width:100%;margin:1em 0}figcaption{font-size:.75em;color:var(--muted,#7d8276)}.reader-table-wrap{max-width:100%;overflow:auto}.reader-image-unavailable{font-size:.8em;color:var(--muted,#7d8276)}:focus-visible{outline:2px solid var(--accent,#65734b);outline-offset:3px}`;

export class EpubDom {
  readonly root:ShadowRoot;
  private content:HTMLDivElement;
  private author:HTMLStyleElement;
  private appearanceStyle:HTMLStyleElement;
  private disposed=false;
  private serial=0;
  private chapter?:EpubChapter;
  private faces:FontFace[]=[];
  private assetCache=new Map<string,Promise<string>>();
  private cacheBytes=0;
  private imageTasks:Promise<unknown>[]=[];
  private appearance:EpubAppearance={style:'original',flow:'scroll',fontSize:20};
  constructor(private host:HTMLDivElement,private id:string,private api:EpubApi,private onLink:(target:EpubTarget,note:boolean)=>void,private onImage:(src:string,alt:string)=>void,private onResourceError:(message:string)=>void){
    this.root=host.shadowRoot??host.attachShadow({mode:'open'});
    const base=document.createElement('style');base.textContent=baseStyles;
    this.author=document.createElement('style');this.appearanceStyle=document.createElement('style');this.content=document.createElement('div');this.content.className='reader-content-root';
    this.root.append(base,this.author,this.appearanceStyle,this.content);
  }
  private async asset(path:string):Promise<string>{
    if(this.assetCache.has(path))return this.assetCache.get(path)!;
    const pending=(async()=>{
      let offset=0,mediaType='',total=-1;const chunks:string[]=[];
      do{if(this.disposed)throw Error('Reading view closed');const part=await this.api.resource(this.id,path,offset);
        if(part.total>16*1024*1024||part.total<0||total!==-1&&part.total!==total||part.next!==null&&part.next<=offset)throw Error('Invalid EPUB resource response');
        total=part.total;mediaType=part.mediaType;chunks.push(part.data);offset=part.next??-1;
      }while(offset>=0);
      // Server chunks are divisible by 3; only the final chunk may contain Base64 padding.
      const data=`data:${mediaType};base64,${chunks.join('')}`;
      this.cacheBytes+=total;
      if(this.cacheBytes>24*1024*1024){this.assetCache.clear();this.cacheBytes=total;}
      return data;
    })();this.assetCache.set(path,pending);pending.catch(()=>this.assetCache.delete(path));return pending;
  }
  private build(node:EpubNode,serial:number):Node {
    if(typeof node==='string')return document.createTextNode(node);
    if(!permitted.has(node.tag))return document.createTextNode('');
    const el=document.createElement(node.tag);
    for(const [key,value] of Object.entries(node.attrs))if(attributes.has(key))el.setAttribute(key,value);
    if(node.target&&node.tag==='a'){
      el.setAttribute('role','link');el.tabIndex=0;
      const activate=()=>this.onLink(node.target!,node.note===true||/note|fn|foot/i.test(node.target?.fragment??'')||/^〔?\d+[〕)]?$/.test(el.textContent??''));
      el.addEventListener('click',e=>{e.preventDefault();activate();});el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();activate();}});
    }
    for(const child of node.children)el.append(this.build(child,serial));
    if(node.tag==='img'&&node.resource){
      const img=el as HTMLImageElement;img.decoding='async';
      // Fetch only the current chapter's assets. Data URLs obey the existing img/font CSP.
      this.imageTasks.push(this.asset(node.resource).then(async src=>{if(!this.disposed&&serial===this.serial){img.src=src;await img.decode();img.addEventListener('click',()=>this.onImage(src,img.alt));}}).catch(e=>{if(serial===this.serial){img.replaceWith(Object.assign(document.createElement('span'),{className:'reader-image-unavailable',textContent:img.alt||'插图暂不可用'}));this.onResourceError(e instanceof Error?e.message:'图片读取失败');}}));
    }
    if(node.tag==='table'){const wrapper=document.createElement('div');wrapper.className='reader-table-wrap';wrapper.append(el);return wrapper;}
    return el;
  }
  async show(chapter:EpubChapter,appearance:EpubAppearance):Promise<void>{
    const serial=++this.serial;this.chapter=chapter;
    for(const warning of chapter.warnings)this.onResourceError(warning);
    this.imageTasks=[];
    for(const face of this.faces)document.fonts.delete(face);this.faces=[];
    const aliases=new Map(chapter.fonts.map((font,i)=>[font.family,`Reader_${this.id.slice(0,12)}_${serial}_${i}`]));
    this.author.textContent=chapter.styles.map(rule=>`${rule.selector}{${Object.entries(rule.declarations).map(([property,value])=>{
      // Publisher absolute sizes must respond to the reader's size control too.
      if(property==='font-size'&&/^\d+(?:\.\d+)?(?:px|pt)$/.test(value))value=`${parseFloat(value)*(value.endsWith('pt')?4/3:1)/20}em`;
      if(property==='font')value=value.replace(/([\d.]+)(px|pt)/,(_,size,unit)=>`${Number(size)*(unit==='pt'?4/3:1)/20}em`);
      if(property==='font-family')value=value.split(',').map(name=>aliases.get(name.trim().replace(/^["']|["']$/g,''))??name).join(',');
      return `${property}:${value}`;
    }).join(';')}}`).join('\n');
    this.content.replaceChildren(...chapter.nodes.map(node=>this.build(node,serial)));
    this.setAppearance(appearance);this.host.scrollTo({top:0,left:0});
    await Promise.all([...this.imageTasks,...chapter.fonts.map(async font=>{
      try{const src=await this.asset(font.resource);if(this.disposed||serial!==this.serial)return;
        const face=new FontFace(aliases.get(font.family)!,`url("${src}")`,{weight:/^(normal|bold|[1-9]00)$/.test(font.weight??'')?font.weight:'normal',style:/^(normal|italic|oblique)$/.test(font.style??'')?font.style:'normal'});
        await face.load();if(this.disposed||serial!==this.serial)return;document.fonts.add(face);this.faces.push(face);
      }catch(e){if(serial===this.serial)this.onResourceError(e instanceof Error?e.message:'字体读取失败');}
    })]);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  }
  setAppearance(appearance:EpubAppearance){
    this.appearance=appearance;
    const width=Math.max(240,this.host.clientWidth),height=Math.max(240,this.host.clientHeight-48);
    const comfort=appearance.style==='comfort';
    this.appearanceStyle.textContent=`
      .reader-book-body{font-size:${appearance.fontSize}px!important;margin-inline:auto!important;
        ${appearance.flow==='pages'?`width:${width}px!important;max-width:none!important;height:${height}px!important;column-width:${width-48}px!important;column-gap:48px!important;column-fill:auto!important;padding:24px!important;`: `width:100%!important;max-width:760px!important;min-height:100%;padding-inline:24px!important;`}}
      .reader-book-body *{max-width:100%;overflow-wrap:break-word}
      ${comfort?`.reader-book-body,.reader-book-body *{font-family:var(--reading-font,serif)!important;line-height:var(--reading-line-height,1.9)!important;color:var(--text,#292c28)!important;background-color:transparent!important;letter-spacing:normal!important;writing-mode:horizontal-tb!important}
        .reader-book-body p{font-size:1em!important;margin-block:0 1em!important;text-indent:0!important}
        .reader-book-body article,.reader-book-body section{width:auto!important;margin-inline:auto!important}`:''}
      .reader-book-body{overflow:visible!important}.reader-book-body img{max-height:${height-32}px!important}
      ${appearance.flow==='pages'?'.reader-book-body figure,.reader-book-body table{break-inside:avoid}':''}`;
    this.host.classList.toggle('is-paged',appearance.flow==='pages');
  }
  private element(location:EpubLocation):HTMLElement|undefined{return [...this.root.querySelectorAll<HTMLElement>('[data-reader-node]')].find(el=>el.dataset.readerNode===location.element);}
  private atOffset(el:Element,offset:number):Range|undefined {
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node:Node|null;
    while((node=walker.nextNode())){const length=node.textContent?.length??0;if(offset<length||offset===0&&length){const range=document.createRange();range.setStart(node,Math.min(offset,Math.max(0,length-1)));range.setEnd(node,Math.min(length,offset+1));return range;}offset-=length;}
  }
  private scrollToRange(range:Range){const rect=range.getBoundingClientRect(),box=this.host.getBoundingClientRect();if(this.appearance.flow==='pages'){const page=Math.floor((this.host.scrollLeft+rect.left-box.left)/this.host.clientWidth);this.host.scrollLeft=Math.max(0,page*this.host.clientWidth);}else this.host.scrollTop+=rect.top-box.top-20;}
  restore(location:EpubLocation):boolean {
    if(location.sourceHash!==this.id||location.resource!==this.chapter?.resource)return false;
    const el=this.element(location);
    if(el && normalize((el.textContent??'').slice(location.offset)).startsWith(normalize(location.quote.exact))){const range=this.atOffset(el,location.offset);if(range){this.reveal(el);this.scrollToRange(range);return true;}}
    // Stable structural id + text validation first; bounded unique quote fallback second.
    if(!location.quote.exact)return false;
    const candidates=[...this.root.querySelectorAll<HTMLElement>('[data-reader-node]')].filter(node=>normalize(node.textContent??'')===normalize(location.quote.exact)&&![...node.children].some(child=>normalize(child.textContent??'')===normalize(location.quote.exact)));
    if(candidates.length!==1)return false;this.reveal(candidates[0]!);const range=this.atOffset(candidates[0]!,0);if(!range)return false;this.scrollToRange(range);return true;
  }
  private reveal(el:HTMLElement){for(let node:HTMLElement|null=el;node&&node!==this.content;node=node.parentElement)if(getComputedStyle(node).display==='none')node.style.setProperty('display','block','important');}
  anchor(fragment:string):boolean {const el=[...this.root.querySelectorAll<HTMLElement>('[id]')].find(x=>x.id===fragment);if(!el)return false;this.reveal(el);const range=document.createRange();range.selectNode(el);this.scrollToRange(range);el.tabIndex=-1;el.focus({preventScroll:true});return true;}
  location():EpubLocation|undefined {
    if(!this.chapter)return;
    const box=this.host.getBoundingClientRect(),walker=document.createTreeWalker(this.content,NodeFilter.SHOW_TEXT);let node:Node|null;
    while((node=walker.nextNode())){
      if(!normalize(node.textContent??''))continue;
      const parent=(node.parentElement?.closest('[data-reader-node]')) as HTMLElement|null;if(!parent)continue;
      const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()];
      if(!rects.some(r=>r.bottom>box.top+20&&r.top<box.bottom&&r.right>box.left&&r.left<box.right))continue;
      let lo=0,hi=(node.textContent?.length??1)-1;
      while(lo<hi){const mid=(lo+hi)>>1;range.setStart(node,mid);range.setEnd(node,mid+1);const r=range.getBoundingClientRect();if(this.appearance.flow==='pages'?r.right<=box.left:r.bottom<=box.top+20)lo=mid+1;else hi=mid;}
      range.selectNodeContents(parent);range.setEnd(node,lo);const offset=range.toString().length,text=parent.textContent??'',exact=normalize(text.slice(offset)).slice(0,160);
      if(!exact)continue;
      return {version:2,sourceHash:this.id,resource:this.chapter.resource,element:parent.dataset.readerNode!,offset,quote:{exact,prefix:normalize(text.slice(0,offset)).slice(-60),suffix:normalize(text.slice(offset+exact.length)).slice(0,60)}};
    }
  }
  page(direction:number):boolean {
    const paged=this.appearance.flow==='pages',at=paged?this.host.scrollLeft:this.host.scrollTop,max=paged?this.host.scrollWidth-this.host.clientWidth:this.host.scrollHeight-this.host.clientHeight;
    if(direction>0&&at>=max-3||direction<0&&at<=3)return false;
    this.host.scrollBy(paged?{left:direction*this.host.clientWidth,behavior:'instant'}:{top:direction*(this.host.clientHeight-48),behavior:'instant'});return true;
  }
  dispose(){this.disposed=true;this.serial++;for(const face of this.faces)document.fonts.delete(face);this.assetCache.clear();this.root.replaceChildren();}
}
