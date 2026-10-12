// Local development only. Serves one explicit static root; no data or control API.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { renderDocument } from './document.mjs';

export async function createLabServer(rootPath) {
  const root=await realpath(resolve(rootPath));
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.md':'text/markdown; charset=utf-8','.json':'application/json; charset=utf-8'};
  const server=createServer(async(req,res)=>{
    const port=server.address()?.port,hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'");
    if(!hosts.has(req.headers.host)||req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403);res.end('Local same-origin access only');return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    try{
      const pathname=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname);
      if(pathname.includes('\\')||pathname.includes('\0'))throw Error('Invalid path');
      const name=pathname==='/'?'lab.html':pathname.slice(1);
      if(name==='design.html'){
        const markdown=await readFile(join(root,'PRODUCT_DESIGN.md'),'utf8');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?undefined:renderDocument(markdown));return;
      }
      const requested=await realpath(resolve(root,name)),rel=relative(root,requested);
      if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||!(await stat(requested)).isFile()||!mime[extname(requested)])throw Error('Outside static root');
      res.writeHead(200,{'Content-Type':mime[extname(requested)]});res.end(req.method==='HEAD'?undefined:await readFile(requested));
    }catch{res.writeHead(404);res.end('Not found');}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{root:{type:'string',default:'docs/design/reader-workspace'},port:{type:'string',default:'4186'}}});
  const port=Number(values.port);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
  const server=await createLabServer(values.root);server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,root:resolve(values.root),mode:'static-design-lab',realCodexHost:false})));
  const stop=()=>server.close(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
