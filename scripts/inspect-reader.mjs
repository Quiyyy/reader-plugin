// Development-only inspector. Reuses production UI/server + the existing AppBridge harness.
// No MCP control endpoint is exposed, and all library data belongs to this run.
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { epubFixture } from './epub-fixture.mjs';
import assert from 'node:assert/strict';
import { buildInputs, serverFingerprint } from './build-fingerprint.mjs';

const {values}=parseArgs({options:{surface:{type:'string',default:'bridge'},scenario:{type:'string',default:'epub'},book:{type:'string'},output:{type:'string'},serve:{type:'boolean'},headed:{type:'boolean'},package:{type:'string'},'build-only':{type:'boolean'},'no-build':{type:'boolean'}}});
if(!['bridge','standalone'].includes(values.surface)||values.scenario!=='epub')throw Error('Use --surface bridge|standalone --scenario epub');
if(values.serve&&values.surface!=='standalone')throw Error('--serve is available with --surface standalone');
if(values.package&&(values.surface!=='bridge'||!values['no-build']))throw Error('--package requires --surface bridge --no-build; inspect the exact already-built package');
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const hash=value=>createHash('sha256').update(value).digest('hex');
const inputs=()=>buildInputs(root),serverHash=()=>serverFingerprint(root);
const fingerprint=await inputs(),stampPath=join(root,'dist','inspection-build.json');
if(values['no-build']){const stamp=JSON.parse(await readFile(stampPath,'utf8'));if(stamp.inputs!==fingerprint||stamp.ui!==hash(await readFile('dist/ui/index.html'))||stamp.server!==await serverHash())throw Error('Build does not match current sources. Run without --no-build.');}
else{
  for(const args of [['scripts/build-reader.mjs'],['scripts/build-test-host.mjs']]){const run=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});if(run.status!==0)throw Error('Reader inspection build failed');}
}
if(values['build-only']){console.log(await readFile(stampPath,'utf8'));process.exit(0);}
await mkdir('artifacts',{recursive:true});
const output=values.output?resolve(values.output):await mkdtemp(join(root,'artifacts','inspection-'));
await mkdir(output,{recursive:true});const dataDir=await mkdtemp(join(output,'data-'));
const bytes=values.book?await readFile(resolve(values.book)):await epubFixture(),id=hash(bytes);
const report={surface:values.surface==='bridge'?'simulated-AppBridge-with-native-MCP':'standalone-production-preview',realCodexHost:false,inputs:fingerprint,uiSha256:hash(await readFile('dist/ui/index.html')),book:{id,bytes:bytes.length,authorizedFile:values.book??'original fixture'},output,dataDir,checks:[],screenshots:[],console:[],pageErrors:[],failedRequests:[],csp:[],calls:[],passed:false};
report.serverSha256=await serverHash();report.gitHead=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout?.trim();report.gitStatus=spawnSync('git',['status','--short'],{encoding:'utf8',windowsHide:true}).stdout?.trim();
let server,browser,client,context;
const writeReport=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
try{
  let origin;
  if(values.surface==='standalone'){
    server=spawn(process.execPath,['dist/server/index.js','--http'],{cwd:root,env:{...process.env,READER_DATA_DIR:dataDir,PORT:'0'},stdio:['ignore','ignore','pipe'],windowsHide:true});
    origin=await new Promise((resolveReady,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Preview startup timed out')),15000);server.once('error',reject);server.stderr.on('data',chunk=>{log+=chunk;const found=log.match(/Reader preview: (http:\/\/127\.0\.0\.1:\d+)/);if(found){clearTimeout(timer);resolveReady(found[1]);}});});
    if(values.serve){await writeReport();console.log(JSON.stringify({url:origin,dataDir,output,isolated:true,realCodexHost:false}));await new Promise(resolveStop=>{process.once('SIGINT',resolveStop);process.once('SIGTERM',resolveStop);});}
  }else{
    client=new Client({name:'Reader development inspector',version:'1.0.0'});
    let config={command:process.execPath,args:[join(root,'dist/server/index.js')],env:{...process.env,READER_DATA_DIR:dataDir},stderr:'pipe'};
    if(values.package){
      const packageRoot=resolve(values.package),manifest=JSON.parse(await readFile(join(packageRoot,'runtime-manifest.json'),'utf8'));
      const inventory=JSON.parse(await readFile(join(packageRoot,'PACKAGE-SHA256.json'),'utf8'));
      for(const [name,expected] of Object.entries(inventory)){assert.ok(!name.includes('\\')&&!name.split('/').includes('..')&&!name.startsWith('/'));assert.equal(hash(await readFile(join(packageRoot,name))),expected,name);}
      assert.equal(manifest.source.commit,report.gitHead);assert.equal(manifest.source.dirty,false);assert.equal(report.gitStatus,'');assert.equal(manifest.testFixture,false);assert.equal(manifest.target,'win32-x64');
      assert.equal(manifest.files['app/dist/ui/index.html'],report.uiSha256);
      report.package={root:packageRoot,version:manifest.version,source:manifest.source,manifestSha256:hash(await readFile(join(packageRoot,'runtime-manifest.json'))),inventorySha256:hash(await readFile(join(packageRoot,'PACKAGE-SHA256.json')))};
      config={command:join(packageRoot,'reader-launcher.exe'),args:[],cwd:packageRoot,env:{...process.env,READER_DATA_DIR:dataDir,PLUGIN_ROOT:packageRoot,PLUGIN_DATA:join(output,'runtime-cache'),NODE_OPTIONS:'',NODE_PATH:'',PATH:''},stderr:'pipe'};
    }
    await client.connect(new StdioClientTransport(config));
    report.mcpVersion=client.getServerVersion();if(report.package)assert.equal(report.mcpVersion.version,report.package.version);
    const list=await client.listResources(),resource=await client.readResource({uri:list.resources[0].uri});
    assert.equal(hash(resource.contents[0].text),report.uiSha256,'Native UI resource must match the verified build');
    report.resourceUri=list.resources[0].uri;report.resourceCsp=resource.contents[0]._meta.ui.csp;
    report.nativeHtml=resource.contents[0].text;
    // Playwright routes below implement only this controlled harness. No TCP control server exists.
    origin='http://127.0.0.1:41789';
  }
  if(!values.serve){
    browser=await chromium.launch({headless:!values.headed,executablePath:process.env.CHROMIUM_PATH??(process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':undefined)});
    context=await browser.newContext({viewport:{width:1100,height:900}});await context.tracing.start({screenshots:true,snapshots:true,sources:false});
    await context.addInitScript(()=>{window.__readerInspectionCsp=[];document.addEventListener('securitypolicyviolation',event=>window.__readerInspectionCsp.push({directive:event.effectiveDirective,blocked:event.blockedURI}));});
    const page=await context.newPage();
    page.on('console',msg=>{if(['error','warning'].includes(msg.type()))report.console.push({type:msg.type(),text:msg.text()});});page.on('pageerror',error=>report.pageErrors.push(error.message));page.on('requestfailed',request=>report.failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
    const hostHtml=values.surface==='bridge'?await readFile('dist/test-host/index.html','utf8'):'';
    await page.route('**/*',async route=>{
      const url=route.request().url();if(!url.startsWith(origin)){await route.abort('blockedbyclient');return;}
      if(values.surface!=='bridge'){await route.continue();return;}
      const path=new URL(url).pathname;
      if(path==='/__test_host')return route.fulfill({contentType:'text/html',body:hostHtml});
      if(path==='/')return route.fulfill({contentType:'text/html',body:report.nativeHtml});
      if(path==='/api/tool'&&route.request().method()==='POST'){
        try{const call=route.request().postDataJSON();report.calls.push(call.name);return route.fulfill({contentType:'application/json',body:JSON.stringify(await client.callTool(call))});}catch(error){return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:error.message})});}
      }
      await route.fulfill({status:404,body:''});
    });
    const start=async()=>{await page.goto(origin+(values.surface==='bridge'?'/__test_host':'/'));const frame=values.surface==='bridge'?page.frameLocator('#reader'):page;await frame.getByRole('heading',{name:'书架',exact:true}).waitFor();return frame;};
    let app=await start();
    await app.locator('input[type=file][accept*=".epub"]').setInputFiles({name:'inspection.epub',mimeType:'application/epub+zip',buffer:Buffer.from(bytes)});
    await app.locator('.epub-reader').waitFor();await app.locator('.epub-loading').waitFor({state:'hidden',timeout:30000});
    await expect(app.locator('.epub-document .reader-book-body')).toBeVisible();
    report.assets=await app.locator('.epub-document').evaluate(el=>({images:[...el.shadowRoot.querySelectorAll('img')].map(img=>({loaded:img.complete&&img.naturalWidth>0,alt:img.alt})),fonts:[...document.fonts].filter(font=>font.family.startsWith('Reader_')).map(font=>({family:font.family,status:font.status})),tables:el.shadowRoot.querySelectorAll('table').length}));
    if(!values.book){
      if(!report.assets.images.every(img=>img.loaded)||!report.assets.fonts.some(font=>font.status==='loaded')||!report.assets.tables)throw Error('Original sample resources did not load');
      const body=app.locator('.epub-document');
      await body.locator('#illustration').click();await expect(app.getByRole('dialog',{name:'插图预览'})).toBeVisible();await app.getByRole('button',{name:'关闭插图',exact:true}).click();
      await body.locator('#note-ref').click();await expect(app.getByRole('button',{name:'返回正文',exact:true})).toBeVisible();await app.getByRole('button',{name:'返回正文',exact:true}).click();await app.locator('.epub-loading').waitFor({state:'hidden'});
      await expect(app.getByRole('button',{name:'返回正文',exact:true})).toHaveCount(0);
      report.checks.push('Image enlargement, embedded font, table, footnote and return');
    }
    const capture=async name=>{const screenshot=join(output,`${name}.png`);await page.screenshot({path:screenshot});report.screenshots.push(screenshot);
      const dom=await app.locator('.epub-document').evaluate(el=>({html:el.shadowRoot?.innerHTML.replace(/data:[^"']+/g,'[embedded resource]').slice(0,100000),text:el.shadowRoot?.textContent?.slice(-12000),scrollTop:el.scrollTop,scrollLeft:el.scrollLeft,width:el.clientWidth,scrollWidth:el.scrollWidth}));
      await writeFile(join(output,`${name}.dom.json`),JSON.stringify(dom,null,2));await writeFile(join(output,`${name}.aria.txt`),await app.locator('.epub-reader').ariaSnapshot());};
    await capture('reading-wide');report.checks.push('Production EPUB body rendered under existing CSP');
    await app.getByRole('button',{name:'目录（T）',exact:true}).click();
    await capture('contents-wide');
    const tocButtons=app.locator('.epub-toc button');const count=await tocButtons.count();if(count>1)await tocButtons.nth(1).click();else await tocButtons.first().click();
    await expect(app.locator('.epub-panel')).toHaveCount(0);
    await app.locator('.epub-loading').waitFor({state:'hidden'});
    if(!values.book){await expect.poll(async()=>{report.tocAnchorTop=await app.locator('.epub-document').evaluate(el=>el.shadowRoot.querySelector('#bridge').getBoundingClientRect().top-el.getBoundingClientRect().top);return report.tocAnchorTop>=0&&report.tocAnchorTop<=60;}).toBe(true);}
    report.checks.push('Table of contents navigation completed');
    if(!values.book){await app.getByRole('button',{name:'目录（T）',exact:true}).click();await expect(app.locator('.epub-toc button.current')).toHaveCount(1);await capture('contents-current');await app.getByRole('button',{name:'关闭目录',exact:true}).click();}
    await app.getByRole('button',{name:'阅读外观',exact:true}).click();await app.getByRole('button',{name:'放大字号',exact:true}).click();await app.getByRole('button',{name:'舒适',exact:true}).click();await capture('appearance-wide');
    await app.getByRole('button',{name:'关闭阅读外观',exact:true}).click();
    await app.locator('.epub-document').hover();await page.mouse.wheel(0,430);await page.waitForTimeout(600);
    await app.getByRole('button',{name:'收藏当前位置（B）',exact:true}).click();
    await app.getByRole('button',{name:'返回书架',exact:true}).click();
    report.positionBeforeReopen=JSON.parse(await readFile(join(dataDir,'books',id,'epub-v2.json'),'utf8'));
    await page.reload();app=values.surface==='bridge'?page.frameLocator('#reader'):page;await app.locator('.book-card').first().click();await app.locator('.epub-reader').waitFor();await app.locator('.epub-loading').waitFor({state:'hidden'});
    report.restored=await app.locator('.epub-document').evaluate((el,location)=>{const node=el.shadowRoot.querySelector(`[data-reader-node="${location.element}"]`);return {text:node?.textContent,top:node?.getBoundingClientRect().top-el.getBoundingClientRect().top,viewport:el.clientHeight};},report.positionBeforeReopen.location);
    if(!report.restored.text||report.restored.top>report.restored.viewport||report.restored.top< -600)throw Error('Saved location was not restored in the reading viewport');
    if(JSON.stringify(JSON.parse(await readFile(join(dataDir,'books',id,'epub-v2.json'),'utf8')).bookmarks)!==JSON.stringify(report.positionBeforeReopen.bookmarks))throw Error('Bookmarks changed during reopen');
    await capture('reopened');report.checks.push('Sidecar and bookmarks survive page close/reopen');
    for(const width of [390,320]){await page.setViewportSize({width,height:900});await page.waitForTimeout(150);await capture(`reading-${width}`);await expect(app.locator('.epub-reader')).toBeVisible();const overflow=await app.locator('.epub-reader').evaluate(el=>el.scrollWidth>el.clientWidth);if(overflow)throw Error(`Reader controls overflow at ${width}px`);}
    await app.getByRole('button',{name:'阅读外观',exact:true}).click();await app.getByRole('button',{name:'翻页',exact:true}).click();await app.getByRole('button',{name:'关闭阅读外观',exact:true}).click();await app.getByRole('button',{name:'下一页',exact:true}).click();await capture('pages-320');
    report.csp=await (values.surface==='bridge'?page.frames().find(frame=>frame!==page.mainFrame()):page).evaluate(()=>window.__readerInspectionCsp??[]);
    await app.getByRole('button',{name:'返回书架',exact:true}).click();report.positionAfter=JSON.parse(await readFile(join(dataDir,'books',id,'epub-v2.json'),'utf8'));
    if(report.pageErrors.length)throw Error('Uncaught page errors were recorded');
    if(report.csp.some(event=>!['eval'].includes(event.blocked)))throw Error('Resource CSP violations were recorded');
    report.passed=true;
  }
}catch(error){report.failure=error.message;throw error;}
finally{delete report.nativeHtml;await writeReport();await context?.tracing.stop({path:join(output,'trace.zip')}).catch(()=>{});await context?.close();await browser?.close();await client?.close();server?.kill();console.log(JSON.stringify({report:join(output,'report.json'),passed:report.passed,surface:report.surface,realCodexHost:false}));}
