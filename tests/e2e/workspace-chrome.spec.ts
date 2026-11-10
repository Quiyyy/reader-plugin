import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {zipSync,strToU8} from 'fflate';
import {pdfFixture} from '../pdf-fixture';

async function rpc(request:APIRequestContext,name:string,args:object={}){
  const result=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  expect(result.ok()).toBe(true);return (await result.json())._meta.reader;
}
async function createNote(request:APIRequestContext,title:string){return rpc(request,'reader_note_create',{title,body:'# 对照理解\n\n阅读时，将原文和自己的理解放在一起。',folderId:null,tags:[],sourceIds:[],imageIds:[]});}
async function openNote(page:Page,title:string){
  await page.getByRole('button',{name:'打开页面',exact:true}).first().click();await page.getByRole('menuitem',{name:'笔记',exact:true}).click();
  await page.locator('[data-visible=true] .study-notes-list').getByRole('button',{name:new RegExp(title)}).click();
  await expect(page.locator('[data-focused=true]').getByLabel('笔记标题')).toHaveValue(title);
}
async function split(page:Page,edge:string){await page.locator('.reader-tab-group.is-focused').getByRole('button',{name:'分栏操作'}).click();await page.getByRole('menuitem',{name:'移到'+edge+'分栏'}).click();}
async function chrome(page:Page){return page.locator('[data-workspace-page][data-visible=true]').evaluateAll(panes=>panes.map(pane=>{
  const rect=(element:Element|null)=>{if(!element)throw Error('Missing page chrome');const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
  return {page:rect(pane),header:rect(pane.querySelector('.reader-toolbar,.study-editor-head,.study-mobile-nav')),footer:rect(pane.querySelector('.reading-footer,.epub-footer,.study-note-status,.study-page-status'))};
}));}

for(const format of ['library','txt','epub','pdf'] as const)test(`${format} and notes share aligned chrome and one-pixel separators`,async({page,request})=>{
  const title='对照笔记 '+format;await createNote(request,title);await page.goto('/');
  let readingTab='书库';
  if(format!=='library'){
    const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>','book.opf':'<package><metadata><title>对照阅读 EPUB</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>','one.xhtml':'<html><body><h1>对照阅读</h1><p>阅读与笔记采用一致的页面结构。</p></body></html>'};
    const buffer=format==='txt'?Buffer.from('第一章 对照阅读\n\n阅读与笔记采用一致的页面结构。\n\n'+Array.from({length:15},()=> '留下自己的思考，再回到原文核对。').join('\n\n')):format==='pdf'?pdfFixture():Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)]))));
    await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'对照阅读.'+format,mimeType:'application/octet-stream',buffer});
    await expect(page.locator('[data-visible=true] .reader-toolbar')).toBeVisible();readingTab=(await page.getByRole('tab',{selected:true}).innerText()).trim();
    if(format==='pdf')await expect(page.locator('.pdf-loading')).toHaveCount(0);
    if(format==='epub')await expect(page.locator('.epub-loading')).toHaveCount(0);
  }
  await openNote(page,title);await split(page,'右侧');await page.getByRole('tab',{name:readingTab,exact:true}).click();
  for(const width of [1280,800,640]){
    await page.setViewportSize({width,height:900});
    await expect.poll(async()=>(await chrome(page)).map(v=>({header:v.header.height,footer:v.footer.height,top:v.header.y,bottom:v.footer.bottom}))).toEqual([{header:40,footer:32,top:36,bottom:900},{header:40,footer:32,top:36,bottom:900}]);
    const values=(await chrome(page)).sort((a,b)=>a.page.x-b.page.x);expect(values[1]!.page.x-values[0]!.page.right).toBe(1);
    const divider=page.getByRole('separator',{name:'调整左右分栏'});expect((await divider.boundingBox())!.width).toBe(9);expect(await divider.evaluate(el=>getComputedStyle(el,'::before').width)).toBe('1px');
    for(const pane of await page.locator('[data-visible=true]').all())expect(await pane.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    if(width===1280){const dismiss=page.getByRole('button',{name:'关闭操作提示'});if(await dismiss.count())await dismiss.click();await page.screenshot({path:`artifacts/workspace-chrome-${format}.png`});}
  }
  // Controls stay functional after moving PDF view tools into the status bar.
  if(format==='pdf'){await page.getByRole('button',{name:'放大页面'}).click();await page.getByRole('button',{name:'旋转页面'}).click();await expect(page.locator('.pdf-loading')).toHaveCount(0);}
});

test('neighboring horizontal splits snap into one continuous divider',async({page,request})=>{
  for(const title of ['左上笔记','右上笔记','左下笔记','右下笔记'])await createNote(request,title);
  await page.goto('/');await openNote(page,'左上笔记');await openNote(page,'右上笔记');await split(page,'右侧');
  await openNote(page,'左下笔记');await split(page,'下方');
  await openNote(page,'右下笔记');
  const tab=(await page.getByRole('tab',{name:'右下笔记',exact:true}).boundingBox())!,target=(await page.getByRole('tabpanel',{name:'右上笔记',exact:true}).boundingBox())!;
  await page.mouse.move(tab.x+30,tab.y+18);await page.mouse.down();await page.mouse.move(tab.x+45,tab.y+55,{steps:6});await page.mouse.move(target.x+target.width/2,target.y+target.height-20,{steps:10});await page.mouse.move(target.x+target.width/2+1,target.y+target.height-19);await expect(page.locator('.reader-drop-preview.bottom')).toBeVisible();await page.mouse.up();
  await page.getByRole('tab',{name:'左上笔记',exact:true}).click();
  const separators=page.getByRole('separator',{name:'调整上下分栏'});await expect(separators).toHaveCount(2);
  const boxes=await Promise.all((await separators.all()).map(el=>el.boundingBox()));const sorted=boxes.filter(Boolean).sort((a,b)=>a!.x-b!.x);
  await page.mouse.move(sorted[0]!.x+50,sorted[0]!.y+4);await page.mouse.down();await page.mouse.move(sorted[0]!.x+50,390,{steps:8});await page.mouse.up();
  await page.mouse.move(sorted[1]!.x+50,sorted[1]!.y+4);await page.mouse.down();await page.mouse.move(sorted[1]!.x+50,396,{steps:8});await page.mouse.up();
  await expect.poll(async()=>{const boxes=await Promise.all((await separators.all()).map(el=>el.boundingBox()));return boxes[0]!.y===boxes[1]!.y;}).toBe(true);
  const panes=(await chrome(page)).sort((a,b)=>a.header.y-b.header.y||a.page.x-b.page.x);expect(panes).toHaveLength(4);expect(panes[0]!.footer.y).toBe(panes[1]!.footer.y);expect(panes[2]!.header.y).toBe(panes[3]!.header.y);
  await page.screenshot({path:'artifacts/workspace-chrome-grid.png'});
});
