// Render only this isolated design prototype. No Reader or Codex data is accessed.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createLabServer } from '../../../tools/ui-lab/serve.mjs';

const root=fileURLToPath(new URL('./',import.meta.url)),assets=join(root,'assets');
await mkdir(assets,{recursive:true});
const server=await createLabServer(root);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
const report={kind:'static-design-prototype',realCodexHost:false,realModel:false,externalRequests:[],pageErrors:[],checks:[],screenshots:[],viewports:[],passed:false};
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':undefined)});
  const page=await browser.newPage({viewport:{width:1600,height:1140},deviceScaleFactor:1});
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith(origin))report.externalRequests.push(r.url());});
  const capture=async name=>{await page.screenshot({path:join(assets,name+'.png'),fullPage:false});report.screenshots.push('assets/'+name+'.png');};
  for(const v of ['a','b','c']){
    await page.setViewportSize({width:1600,height:1140});
    await page.goto(`${origin}/boards.html?v=${v}`);
    await expect(page.frameLocator('#library').getByRole('heading',{name:/^书库/})).toBeVisible();
    await expect(page.frameLocator('#chat').getByRole('dialog',{name:'阅读对话'})).toBeVisible();
    await capture('proposal-'+v);
    for(const width of [1280,390,320]){
      for(const view of ['library','reader']){
        const height=width===1280?900:844;
        await page.setViewportSize({width,height});
        await page.goto(`${origin}/prototype.html?v=${v}&view=${view}`);
        await expect(page.locator('.workspace')).toBeVisible();
        const sizes=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,containers:[...document.querySelectorAll('.library-main,.chat-window,.composer')].map(e=>({name:e.className,client:e.clientWidth,scroll:e.scrollWidth}))}));
        report.viewports.push({variant:v,view,...sizes});
        expect(sizes.document).toBeLessThanOrEqual(width);
        expect(sizes.body).toBeLessThanOrEqual(width);
        for(const c of sizes.containers)expect(c.scroll).toBeLessThanOrEqual(c.client+1);
        if(width!==320)await capture(`${v}-${view}-${width}`);
      }
    }
  }
  await page.setViewportSize({width:1280,height:900});
  await page.goto(`${origin}/prototype.html?v=a&view=library`);
  await page.getByLabel('搜索书名或作者').fill('山河');
  await expect(page.locator('.book-row')).toHaveCount(1);
  await page.getByLabel('搜索书名或作者').fill('');
  await page.getByRole('button',{name:'PDF',exact:true}).click();
  await expect(page.locator('.book-row')).toHaveCount(1);
  await page.getByRole('button',{name:'全部',exact:true}).click();
  await page.getByRole('button',{name:/接着读/}).click();
  await expect(page.getByRole('dialog',{name:'阅读对话'})).toBeVisible();
  await page.locator('.context-chip').click();
  await expect(page.locator('.source-preview')).toBeVisible();
  await page.getByRole('button',{name:'移除此引用',exact:true}).click();
  await expect(page.locator('.context-chip')).toHaveCount(0);
  await page.getByRole('button',{name:'添加引用',exact:true}).click();
  await expect(page.locator('.context-chip')).toBeVisible();
  await page.getByLabel('继续追问',{exact:true}).fill('给我一个练习');
  await page.getByLabel('发送问题',{exact:true}).click();
  await expect(page.getByRole('log')).toContainText('示例回答：');
  await page.getByLabel('收起对话',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'阅读对话'})).toHaveCount(0);
  await page.getByLabel('继续阅读对话',{exact:true}).click();
  await expect(page.getByRole('log')).toContainText('给我一个练习');
  report.checks.push('Three variants render at 1280, 390 and 320px with no horizontal overflow','Book search, format filter and reading navigation','Source expansion, removal and reattachment','Local demo reply, minimize and restore');
  await page.goto(origin+'/lab.html');
  await page.getByRole('button',{name:'B · 轻盈书房',exact:true}).click();
  await expect(page.frameLocator('#preview').locator('body')).toHaveClass(/variant-b/);
  await page.getByRole('button',{name:'阅读与聊天',exact:true}).click();
  await expect(page.frameLocator('#preview').getByRole('dialog',{name:'阅读对话'})).toBeVisible();
  report.checks.push('Comparison lab switches variant and screen');
  expect(report.pageErrors).toEqual([]);expect(report.externalRequests).toEqual([]);report.passed=true;
}finally{
  await writeFile(join(root,'verification.json'),JSON.stringify(report,null,2));
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({passed:report.passed,screenshots:report.screenshots.length,report:join(root,'verification.json')}));
