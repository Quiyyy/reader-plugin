import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { shell } from './shell.mjs';
import { documentHtml, bookCss } from './fixture.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=fileURLToPath(new URL('./',import.meta.url));
const out=join(root,'artifacts','epub-probe');
const pin=JSON.parse(await readFile(join(source,'vendor','foliate','pin.json'),'utf8'));
for(const [name,digest] of Object.entries(pin.sha256)){
  const actual=createHash('sha256').update(await readFile(join(source,'vendor','foliate',name))).digest('hex');
  if(actual!==digest)throw Error(`Pinned Foliate file changed: ${name}`);
}
await mkdir(out,{recursive:true});
const image=await readFile(join(source,'assets','river.png')),font=await readFile(join(source,'assets','reader-probe.ttf'));
await writeFile(join(source,'assets','base64.json'),JSON.stringify({image:image.toString('base64'),font:font.toString('base64')}));
const css=await readFile(join(source,'reader.css'),'utf8');
const manifest={scope:'development probe only',engine:pin,changes:['paginator iframe removes allow-scripts; inner document script-src none'],csp:{connectDomains:[],resourceDomains:[],frameDomains:[]},hostAcceptance:'not-performed',files:{}};
for(const design of [false,true]){
  const result=await build({entryPoints:[join(source,'probe.mjs')],bundle:true,write:false,format:'iife',target:'es2022',define:{__DESIGN__:String(design)},plugins:[{name:'windows-book-script-isolation',setup(b){b.onLoad({filter:/vendor[\\/]foliate[\\/]paginator\.js$/},async({path})=>{
    const original=await readFile(path,'utf8');
    const token="setAttribute('sandbox', 'allow-same-origin allow-scripts')";
    if(original.split(token).length!==2)throw Error('Unexpected pinned iframe sandbox');
    return {contents:original.replace(token,"setAttribute('sandbox', 'allow-same-origin')"),loader:'js'};
  });}}]});
  const script=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  const sampleCss=design?`.canvas{font-family:'SimSun',serif;font-size:20px;line-height:1.9}@scope (.canvas) {${bookCss.replace('__FONT__','data:font/ttf;base64,'+font.toString('base64')).replace(/(?:html|body)\{[^}]*\}/g,'')}}`:'';
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${design?'Reader · EPUB design preview':'Reader'}</title><style>${css}\n${sampleCss}</style></head><body>${shell}<script>${script}</script></body></html>`;
  const name=design?'design.html':'probe.html';await writeFile(join(out,name),html);manifest.files[name]=createHash('sha256').update(html).digest('hex');
}
await copyFile(join(source,'server.mjs'),join(out,'server.mjs'));
const fixture={
  mimetype:strToU8('application/epub+zip'),
  'META-INF/container.xml':strToU8('<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
  'EPUB/book.opf':strToU8('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">reader-original-river-1</dc:identifier><dc:title>山河小记</dc:title><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-04T00:00:00Z</meta></metadata><manifest><item id="story" href="story.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="image" href="river.png" media-type="image/png"/><item id="font" href="reader-probe.ttf" media-type="font/ttf"/></manifest><spine toc="ncx"><itemref idref="story"/></spine></package>'),
  'EPUB/nav.xhtml':strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="story.xhtml#river">沿着河流走</a><ol><li><a href="story.xhtml#bridge">桥边</a></li><li><a href="story.xhtml#ferry">渡口</a></li></ol></li></ol></nav></body></html>'),
  'EPUB/toc.ncx':strToU8('<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>山河小记</text></docTitle><navMap><navPoint id="river" playOrder="1"><navLabel><text>沿着河流走</text></navLabel><content src="story.xhtml#river"/><navPoint id="bridge" playOrder="2"><navLabel><text>桥边</text></navLabel><content src="story.xhtml#bridge"/></navPoint><navPoint id="ferry" playOrder="3"><navLabel><text>渡口</text></navLabel><content src="story.xhtml#ferry"/></navPoint></navPoint></navMap></ncx>'),
  'EPUB/story.xhtml':strToU8(documentHtml('river.png','reader-probe.ttf').replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/,'')),
  'EPUB/river.png':image,'EPUB/reader-probe.ttf':font,
};
await writeFile(join(out,'original-river.epub'),zipSync(fixture,{level:0}));
const marketplace=join(out,'marketplace'),plugin=join(marketplace,'plugins','reader-epub-probe');
await mkdir(join(plugin,'.codex-plugin'),{recursive:true});await mkdir(join(marketplace,'.agents','plugins'),{recursive:true});
const json=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n');
await json(join(plugin,'.codex-plugin','plugin.json'),{name:'reader-epub-probe',version:'0.1.10-epub-probe.1',description:'Isolated EPUB host compatibility sample. Development only.',mcpServers:'./.mcp.json',interface:{displayName:'Reader',shortDescription:'EPUB compatibility sample',capabilities:['Interactive','Write']}});
await json(join(plugin,'.mcp.json'),{mcpServers:{'reader-epub-probe':{command:process.execPath,args:[resolve(out,'server.mjs')]}}});
await json(join(marketplace,'.agents','plugins','marketplace.json'),{name:'reader-epub-lab',interface:{displayName:'Reader EPUB lab'},plugins:[{name:'reader-epub-probe',source:{source:'local',path:'./plugins/reader-epub-probe'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]});
await json(join(out,'build-manifest.json'),manifest);
console.log(JSON.stringify({output:out,marketplace,registered:false,installed:false,hostAcceptance:'not-performed'},null,2));
