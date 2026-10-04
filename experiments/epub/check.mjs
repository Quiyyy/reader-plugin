// Targeted probe and design QA only. Never label this as native-host acceptance.
import { chromium } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../../',import.meta.url)),out=join(root,'artifacts','epub-probe');
const result={surface:'protocol-and-standalone-design-only',hostAcceptance:'not-performed',checks:[],screenshots:[]};
const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
const client=new Client({name:'epub-probe-check',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:[join(out,'server.mjs')],stderr:'pipe'});
await client.connect(transport);
try{
  const resources=await client.listResources();
  const resource=await client.readResource({uri:resources.resources[0].uri});
  assert.deepEqual(resource.contents[0]._meta.ui.csp,{connectDomains:[],resourceDomains:[],frameDomains:[]});
  check('Probe declares the unchanged empty host CSP allowlists',true);
  const tools=await client.listTools();
  check('Only the open tool is model-visible',tools.tools.filter(t=>!t._meta?.ui?.visibility?.includes('app')).length===1);
  check('No real Reader storage tools are registered',tools.tools.every(t=>t.name.startsWith('reader_epub_probe_')));
}finally{await client.close();}

const child=spawn(process.execPath,[join(out,'server.mjs'),'--http'],{cwd:root,stdio:['ignore','ignore','pipe']});
const origin=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Preview startup timeout')),10000);let text='';
  child.on('error',reject);child.stderr.on('data',b=>{text+=b;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
});
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const context=await browser.newContext();
  const external=[];
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin))return route.continue();external.push(url);return route.abort();});
  const page=await context.newPage();
  const errors=[],consoleErrors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});await page.goto(origin+'/design');
    await page.waitForFunction(()=>document.querySelector('#notice').hidden);
    check(`Design at ${width}px has no page-level horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    check(`Design at ${width}px retains every toolbar control`,await page.locator('.toolbar').evaluate(el=>[...el.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth;})));
    const path=join(out,`design-${width}.png`);await page.screenshot({path});result.screenshots.push(path);
    if(width===390){await page.getByRole('button',{name:'阅读外观',exact:true}).click();await page.screenshot({path:join(out,'design-390-appearance.png')});result.screenshots.push(join(out,'design-390-appearance.png'));await page.getByRole('button',{name:'关闭外观',exact:true}).click();}
    if(width===320){await page.getByRole('button',{name:'目录',exact:true}).click();await page.screenshot({path:join(out,'design-320-toc.png')});result.screenshots.push(join(out,'design-320-toc.png'));await page.getByRole('button',{name:'二、渡口',exact:true}).click();check('Nested TOC design navigates to the in-document anchor',await page.locator('#ferry').evaluate(el=>{const r=el.getBoundingClientRect();return r.y>=50&&r.y<150;}));}
  }
  check('Design produces no uncaught browser errors',errors.length===0);
  await page.setViewportSize({width:1000,height:760});
  await page.goto(origin+'/probe');
  await page.waitForFunction(()=>window.__epubProbe?.report.renderTimeout,{timeout:10000});
  const report=await page.evaluate(()=>window.__epubProbe.report);
  result.previewProbe=report;result.browserConsoleErrors=consoleErrors;
  await writeFile(join(out,'preview-probe-result.json'),JSON.stringify({report,consoleErrors},null,2));
  check('Strict preview blocks the Foliate blob document',!report.frameLoaded&&(report.cspViolations.some(v=>v.directive==='frame-src'&&v.blocked.startsWith('blob'))||consoleErrors.some(m=>/frame-src.*none/.test(m))));
  check('Preview is explicitly not classified as a real host',report.surface==='standalone-preview'&&report.hostAcceptance==='not-performed');
  check('No external requests from the sample UI',external.length===0);
  result.previewProbe=report;
  await page.screenshot({path:join(out,'probe-blocked-preview.png')});
  result.screenshots.push(join(out,'probe-blocked-preview.png'));
  await context.close();
}finally{
  await browser?.close();child.kill();
  await writeFile(join(out,'checks.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify(result,null,2));
