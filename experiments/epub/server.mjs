// Separate diagnostic server. It has no ReaderStore and cannot open user books.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';

const root=new URL('./',import.meta.url), statePath=new URL('probe-state.json',root);
export const previewCsp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'";
if(process.argv.includes('--http')){
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    const address=server.address(), host=`127.0.0.1:${address.port}`;
    if(req.headers.host!==host || req.headers.origin && req.headers.origin!==`http://${host}` || req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    const path=req.url?.split('?')[0];
    if(req.method!=='GET'||!['/design','/probe'].includes(path)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Security-Policy',previewCsp);res.setHeader('Content-Type','text/html; charset=utf-8');
    try{res.end(await readFile(new URL(path==='/design'?'design.html':'probe.html',root)));}catch{res.writeHead(500);res.end();}
  });
  server.listen(0,'127.0.0.1',()=>console.error(`EPUB probe preview: http://127.0.0.1:${server.address().port}`));
}else{
  const server=new McpServer({name:'reader-epub-probe',version:'0.1.10-epub-probe.1'});
  new OpenAIExtensions(server);
  const uri='ui://reader/epub-host-probe/v1.html';
  const meta={ui:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[]},prefersBorder:false},'openai/ui':{preferredDisplayMode:'fullscreen',availableDisplayModes:['inline','fullscreen']}};
  registerAppResource(server,'Reader',uri,{_meta:meta},async()=>({contents:[{uri,mimeType:RESOURCE_MIME_TYPE,text:await readFile(new URL('probe.html',root),'utf8'),_meta:meta}]}));
  registerAppTool(server,'reader_epub_probe_open',{title:'Reader',description:'Open the isolated EPUB compatibility sample. No personal books or Reader data are accessed.',inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false,destructiveHint:false},_meta:{ui:{resourceUri:uri},'openai/ui':{entrypoints:[{type:'global'},{type:'thread'}]}}},async()=>({content:[{type:'text',text:'Open the sample and inspect compatibility results in its menu.'}]}));
  server.registerTool('reader_epub_probe_load',{inputSchema:{},annotations:{readOnlyHint:true,openWorldHint:false,destructiveHint:false},_meta:{ui:{visibility:['app']}}},async()=>{
    try{return {content:[],_meta:{probe:JSON.parse(await readFile(statePath,'utf8'))}};}catch(e){if(e.code!=='ENOENT')throw e;return {content:[],_meta:{probe:null}};}
  });
  const locator=z.object({version:z.literal(2),resource:z.literal('EPUB/story.xhtml'),cfi:z.string().max(3000),text:z.string().max(120)});
  const schema={report:z.record(z.string(),z.unknown()),state:z.object({current:locator.optional(),bookmark:z.union([locator,z.object({anchor:z.literal('river')})]).optional(),size:z.number().int().min(14).max(32),style:z.enum(['original','comfort']),flow:z.enum(['scrolled','paginated'])})};
  let writes=Promise.resolve();
  server.registerTool('reader_epub_probe_save',{inputSchema:schema,annotations:{readOnlyHint:false,openWorldHint:false,destructiveHint:false},_meta:{ui:{visibility:['app']}}},async(args)=>{
    const text=JSON.stringify(args,null,2);if(text.length>65536)throw Error('Probe report exceeds limit');
    const write=writes.catch(()=>{}).then(async()=>{const temp=fileURLToPath(statePath)+'.tmp';await writeFile(temp,text,{mode:0o600});await rename(temp,statePath);});writes=write;await write;
    return {content:[],_meta:{probe:{saved:true}}};
  });
  await server.connect(new StdioServerTransport());
}
