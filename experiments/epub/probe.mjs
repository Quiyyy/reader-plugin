import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { Paginator } from './vendor/foliate/paginator.js';
import * as CFI from './vendor/foliate/epubcfi.js';
import { body, documentHtml } from './fixture.mjs';
import assets from './assets/base64.json';

const $ = id => document.getElementById(id);
const report = { schema:1, surface:__DESIGN__ ? 'design-preview' : 'pending-host-identification', engineCommit:'78914aef4466eb960965702401634c2cb348e9b1', cspChanged:false, innerScriptsAllowed:false, hostAcceptance:'not-performed', handshake:false, frameLoaded:false, imageLoaded:false, fontLoaded:false, bookScriptExecuted:null, keyboardEvents:0, anchorJumps:[], resizeEvents:0, cspViolations:[], errors:[], manual:{zoom:'pending',windowResize:'pending',closeReopen:'pending',appearance:'pending'} };
window.__epubProbe = { report };
let app, renderer, currentDoc, current, bookmark, returnTo, size=20, style='original', flow='scrolled', saveTimer, previousFocus;
let ready=Promise.resolve(), chain=Promise.resolve();
const objectUrls=[];
const blobUrl = (bytes,type) => { const url=URL.createObjectURL(new Blob([bytes],{type}));objectUrls.push(url);return url; };
const reportText = () => JSON.stringify({...report, locator:current, bookmark},null,2);
const updateReport = () => { $('diagnostics').textContent=reportText(); };
const error = e => { report.errors.push(String(e?.message??e).slice(0,300));updateReport(); };
const rpc = async (name,args={}) => { await ready;const result=await app.callServerTool({name,arguments:args});if(result.isError)throw Error('Probe server operation failed');return result._meta?.probe; };
function save() {
  if(__DESIGN__ || !app)return Promise.resolve();
  clearTimeout(saveTimer);
  const payload={report:JSON.parse(reportText()),state:{current,bookmark,size,style,flow}};
  chain=chain.catch(()=>{}).then(()=>rpc('reader_epub_probe_save',payload));
  return chain;
}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>void save().catch(error),350);updateReport();}
function panel(name) {
  const opening=name && $(name).hidden;
  for(const id of ['toc','appearance','menu']){$(id).hidden=id!==name||!opening;$(id+'-toggle').setAttribute('aria-expanded',String(id===name&&opening));}
  if(opening){previousFocus=document.activeElement;$(name).querySelector('button')?.focus();}else previousFocus?.focus();
}
function position(range) {
  const point=range.cloneRange();point.collapse(true);
  return {version:2,resource:'EPUB/story.xhtml',cfi:CFI.joinIndir('epubcfi(/6/2[story])',CFI.fromRange(point)),text:range.toString().slice(0,120)};
}
function rangeFor(doc,loc){const parsed=CFI.parse(loc.cfi);return CFI.toRange(doc,[parsed.at(-1)]);}
async function go(loc){if(renderer)await renderer.goTo({index:0,anchor:doc=>rangeFor(doc,loc)});}
async function anchor(id) {
  if(__DESIGN__){$(id)?.scrollIntoView({block:'start'});}
  else if(renderer){await renderer.goTo({index:0,anchor:doc=>doc.getElementById(id)});report.anchorJumps.push(id);}
  if(id==='note')$('return').hidden=false;
  else if(id==='note-ref')$('return').hidden=true;
  scheduleSave();
}
function key(event) {
  if(event.target?.matches('input,textarea,select')||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==='Escape'){for(const id of ['toc','appearance','menu'])$(id).hidden=true;$('image-dialog').close();return;}
  const action={ArrowRight:'next',PageDown:'next',ArrowLeft:'prev',PageUp:'prev'}[event.key];
  if(action && renderer){event.preventDefault();report.keyboardEvents++;void renderer[action]().then(scheduleSave).catch(error);}
}
function wireBook(doc) {
  currentDoc=doc;
  doc.addEventListener('keydown',key);
  doc.addEventListener('click',event=>{
    const a=event.target.closest('a');
    if(a){event.preventDefault();const href=a.getAttribute('href');if(href?.startsWith('#')){if(href==='#note')returnTo=current;void anchor(href.slice(1)).catch(error);}}
    const img=event.target.closest('img');
    if(img){$('large-image').src=img.src;$('image-dialog').showModal();}
  });
}
function appearance() {
  $('size').textContent=String(size);
  for(const button of document.querySelectorAll('[data-style]'))button.setAttribute('aria-pressed',String(button.dataset.style===style));
  for(const button of document.querySelectorAll('[data-flow]'))button.setAttribute('aria-pressed',String(button.dataset.flow===flow));
  const css=`body{font-size:${size}px!important;${style==='comfort'?"font-family:'Microsoft YaHei',sans-serif!important;line-height:1.95!important;color:#30372d!important;background:#fafbf7!important;":''}}`;
  if(renderer){renderer.setAttribute('flow',flow);renderer.setStyles(css);}
  if(__DESIGN__){$('canvas').style.fontSize=size+'px';$('canvas').style.fontFamily=style==='comfort'?"'Microsoft YaHei',sans-serif":"'SimSun',serif";}
  scheduleSave();
}
async function start() {
  if(__DESIGN__){
    $('canvas').innerHTML=body.replace('__IMAGE__','data:image/png;base64,'+assets.image);
    $('notice').hidden=true;
    $('position').textContent='12%';
    $('copy').textContent='复制设计检查结果';
    wireBook(document);
    return;
  }
  if(window.parent===window){report.surface='standalone-preview';}
  else {
    app=new App({name:'Reader',version:'0.1.10-epub-probe.1'});
    app.onhostcontextchanged=ctx=>{if(ctx.theme)applyDocumentTheme(ctx.theme);if(ctx.styles?.variables)applyHostStyleVariables(ctx.styles.variables);};
    app.ontoolinput=()=>{};app.ontoolresult=()=>{};
    app.onteardown=async()=>{await save();return {};};
    ready=app.connect(undefined,{timeout:10000});
    await ready;
    report.handshake=true;report.surface='mcp-host-unidentified';
    const prior=await rpc('reader_epub_probe_load');
    if(prior?.state){({current,bookmark,size=20,style='original',flow='scrolled'}=prior.state);report.previousProbeStateFound=true;}
  }
  renderer=new Paginator();
  renderer.setAttribute('flow',flow);renderer.setAttribute('max-column-count','1');renderer.setAttribute('max-inline-size','760');renderer.setAttribute('margin','24');
  $('canvas').replaceWith(renderer);renderer.id='canvas';
  renderer.addEventListener('load',async({detail:{doc}})=>{
    if(!doc?.getElementById('river')){error('The iframe load event did not contain the expected sample document');return;}
    report.frameLoaded=true;wireBook(doc);appearance();
    const img=doc.getElementById('illustration');
    try{await img.decode();report.imageLoaded=img.naturalWidth===960;}catch(e){error(e);}
    try{await doc.fonts.load('20px ReaderProbe','AAA');report.fontLoaded=[...doc.fonts].some(f=>f.family==='ReaderProbe'&&f.status==='loaded');}catch(e){error(e);}
    report.bookScriptExecuted=doc.defaultView.__readerBookScriptExecuted===true;
    $('notice').hidden=true;
    scheduleSave();
  });
  renderer.addEventListener('relocate',({detail:{range,fraction}})=>{if(range){current=position(range);$('position').textContent=Math.round(fraction*100)+'%';scheduleSave();}});
  // Original, fixed sample only. This is deliberately NOT an arbitrary EPUB importer.
  const source=documentHtml('data:image/png;base64,'+assets.image,'data:font/ttf;base64,'+assets.font,true);
  const sectionUrl=blobUrl(source,'text/html');
  renderer.open({dir:'ltr',sections:[{id:'EPUB/story.xhtml',size:source.length,load:()=>sectionUrl}]});
  const timeout=setTimeout(()=>{if(!report.frameLoaded){$('message').textContent='当前宿主未能打开 EPUB 正文';$('notice-details').hidden=false;report.renderTimeout=true;scheduleSave();}},6000);
  await renderer.goTo({index:0,...(current?{anchor:doc=>rangeFor(doc,current)}:{})});
  clearTimeout(timeout);
}
document.addEventListener('securitypolicyviolation',e=>{report.cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI.startsWith('blob:')?'blob:':e.blockedURI.slice(0,100)});scheduleSave();});
window.addEventListener('error',e=>error(e.error??e.message));
window.addEventListener('unhandledrejection',e=>error(e.reason));
window.addEventListener('resize',()=>{report.resizeEvents++;scheduleSave();});
window.addEventListener('beforeunload',()=>{objectUrls.forEach(URL.revokeObjectURL);});
document.addEventListener('keydown',key);
for(const name of ['toc','appearance','menu']){$(name+'-toggle').onclick=()=>panel(name);$(name+'-close').onclick=()=>panel(name);}
for(const btn of document.querySelectorAll('[data-anchor]'))btn.onclick=()=>{panel('toc');void anchor(btn.dataset.anchor).catch(error);};
for(const btn of document.querySelectorAll('[data-style]'))btn.onclick=()=>{style=btn.dataset.style;appearance();};
for(const btn of document.querySelectorAll('[data-flow]'))btn.onclick=()=>{flow=btn.dataset.flow;appearance();};
$('smaller').onclick=()=>{size=Math.max(14,size-2);appearance();};$('larger').onclick=()=>{size=Math.min(32,size+2);appearance();};
$('bookmark').onclick=()=>{bookmark=current??{anchor:'river'};$('bookmark').style.color='#657b4c';scheduleSave();};
$('go-bookmark').onclick=()=>{panel('menu');if(bookmark?.cfi)void go(bookmark).catch(error);else void anchor('river');};
$('return').onclick=()=>{if(returnTo)void go(returnTo).catch(error);else void anchor('note-ref');$('return').hidden=true;};
$('reload').onclick=()=>void save().then(()=>location.reload()).catch(error);
$('diagnostics-toggle').onclick=()=>{updateReport();$('diagnostics').hidden=!$('diagnostics').hidden;};
$('notice-details').onclick=()=>{panel('menu');updateReport();$('diagnostics').hidden=false;};
$('copy').onclick=()=>void navigator.clipboard.writeText(reportText()).catch(error);
$('image-close').onclick=()=>$('image-dialog').close();
void start().catch(e=>{error(e);$('message').textContent='兼容检查未完成';$('notice-details').hidden=false;});
updateReport();
