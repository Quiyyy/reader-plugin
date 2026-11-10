import {test,expect,type APIRequestContext,type Page,type Locator} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function rpc(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  expect(response.ok(),await response.text()).toBe(true);return (await response.json())._meta.reader;
}
async function makeNote(request:APIRequestContext,title:string){return (await rpc(request,'reader_note_create',{title,body:'# 对照笔记\n\n阅读时记录自己的理解。',folderId:null,tags:[],sourceIds:[],imageIds:[]})).value;}
async function openNotes(page:Page){await page.getByRole('button',{name:'打开页面',exact:true}).first().click();await page.getByRole('menuitem',{name:'笔记',exact:true}).click();}
async function openNote(page:Page,title:string){await openNotes(page);await page.locator('[data-visible=true] .study-notes-list').getByRole('button',{name:new RegExp(title)}).click();await expect(page.locator('[data-visible=true]').getByLabel('笔记正文')).toBeVisible();}
async function dragTab(page:Page,title:string,target:Locator,edge:'left'|'right'|'top'|'bottom'){
  const tab=page.getByRole('tab',{name:title,exact:true}),from=(await tab.boundingBox())!,to=(await target.boundingBox())!;
  const x=to.x+to.width*(edge==='left'?.08:edge==='right'?.92:.5),y=to.y+to.height*(edge==='top'?.08:edge==='bottom'?.92:.5);
  await page.mouse.move(from.x+Math.min(35,from.width/2),from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+50,from.y+50,{steps:8});await page.mouse.move(x,y,{steps:12});await page.mouse.move(x+1,y+1);
  await expect(page.locator('.reader-drop-preview.'+edge)).toBeVisible();await page.mouse.up();await expect(page.locator('.reader-drop-surface')).toHaveCount(0);
}

test('book and note tabs drag into nested splits, resize, merge and restore without remounting editors',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await makeNote(request,'分栏学习笔记');await makeNote(request,'第二篇对照笔记');
  await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'分栏阅读样本.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 对照阅读\n\n'+Array.from({length:60},(_,i)=>`第${i+1}段：阅读与笔记保留各自的位置。`).join('\n\n'))});
  await expect(page.getByRole('heading',{name:'第一章 对照阅读'})).toBeVisible();await expect(page.getByRole('tab',{name:'书库',exact:true})).toBeVisible();
  const reading=page.locator('[data-visible=true] .reading-scroll');await reading.evaluate(el=>{el.scrollTop=600;});
  await openNote(page,'分栏学习笔记');const editor=page.getByLabel('笔记正文');await editor.fill('# 我的理解\n\n左右对照不丢失草稿。');await editor.evaluate(el=>el.setAttribute('data-kept','yes'));
  await dragTab(page,'分栏学习笔记',page.locator('[data-visible=true]'),'right');await expect(page.getByRole('tablist')).toHaveCount(2);
  await page.getByRole('tab',{name:'分栏阅读样本',exact:true}).click();await expect(page.locator('[data-visible=true] .reading-scroll')).toBeVisible();expect(await reading.evaluate(el=>el.scrollTop)).toBeGreaterThan(500);
  await expect(editor).toHaveAttribute('data-kept','yes');await expect(editor).toHaveValue('# 我的理解\n\n左右对照不丢失草稿。');
  const separator=page.getByRole('separator',{name:'调整左右分栏'}),before=(await editor.locator('xpath=ancestor::section[@data-workspace-page]').boundingBox())!.width,bar=(await separator.boundingBox())!;
  await page.mouse.move(bar.x+3,bar.y+bar.height/2);await page.mouse.down();await page.mouse.move(bar.x-130,bar.y+bar.height/2,{steps:8});await page.mouse.up();expect((await editor.locator('xpath=ancestor::section[@data-workspace-page]').boundingBox())!.width).toBeGreaterThan(before+100);
  await openNote(page,'第二篇对照笔记');await dragTab(page,'第二篇对照笔记',page.locator('[data-kept=yes]').locator('xpath=ancestor::section[@data-workspace-page]'),'bottom');
  await expect(page.getByRole('tablist')).toHaveCount(3);await expect(page.getByRole('separator',{name:'调整上下分栏'})).toBeVisible();
  for(const pane of await page.locator('[data-visible=true]').all()){
    const bounds=(await pane.boundingBox())!;
    for(const control of await pane.locator('.study-editor-head button').all()){
      const box=(await control.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(bounds.x);expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width+1);
    }
  }
  await page.getByRole('tab',{name:'分栏阅读样本',exact:true}).click();
  const beforeReload=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reader-workspace-tabs-v1')!).root);
  await page.screenshot({path:'artifacts/workspace-tabs-nested.png'});await page.reload();await expect(page.getByRole('tablist')).toHaveCount(3);await expect(page.getByRole('heading',{name:'第一章 对照阅读'})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reader-workspace-tabs-v1')!).root)).toEqual(beforeReload);
  await page.getByRole('button',{name:'分栏操作'}).first().click();await page.getByRole('menuitem',{name:'合并所有分栏'}).click();await expect(page.getByRole('tablist')).toHaveCount(1);await expect(page.getByRole('separator')).toHaveCount(0);
  await page.getByRole('tab',{name:'分栏学习笔记',exact:true}).click();await expect(page.locator('[data-visible=true]').getByLabel('笔记正文')).toHaveValue('# 我的理解\n\n左右对照不丢失草稿。');expect(errors).toEqual([]);
});

test('closing an unsaved note preserves its tab and draft until the save succeeds',async({page,request})=>{
  const note=await makeNote(request,'关闭保存检查');await page.goto('/');await openNote(page,'关闭保存检查');
  await page.route('**/api/tool',route=>{if(route.request().postDataJSON().name==='reader_note_update')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟保存失败'})});return route.continue();});
  await page.getByLabel('笔记正文').fill('必须保存的草稿');await page.getByRole('button',{name:'关闭页面 关闭保存检查',exact:true}).click();
  await expect(page.getByRole('tab',{name:'关闭保存检查',exact:true})).toBeVisible();await expect(page.getByLabel('笔记正文')).toHaveValue('必须保存的草稿');await expect(page.locator('.reader-tabs-error')).toContainText('尚未关闭');
  await page.unroute('**/api/tool');await page.getByRole('button',{name:'关闭页面 关闭保存检查',exact:true}).click();await expect(page.getByRole('tab',{name:'关闭保存检查',exact:true})).toHaveCount(0);expect((await rpc(request,'reader_note_get',{id:note.id})).body).toBe('必须保存的草稿');
});

test('keyboard tab navigation and 320px layout retain usable controls',async({page,request})=>{
  await makeNote(request,'窄屏标签笔记');await page.setViewportSize({width:320,height:844});await page.goto('/');await openNote(page,'窄屏标签笔记');
  await page.getByRole('tab',{name:'窄屏标签笔记',exact:true}).focus();await page.keyboard.press('Home');await expect(page.getByRole('tab',{name:'书库',exact:true})).toBeFocused();await page.keyboard.press('End');await expect(page.getByRole('tab',{name:'窄屏标签笔记',exact:true})).toBeFocused();
  await expect(page.getByLabel('笔记正文')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);await page.screenshot({path:'artifacts/workspace-tabs-narrow.png'});
});

test('tab splitting works inside the restricted AppBridge frame',async({page,request})=>{
  await makeNote(request,'桥接分栏笔记');const html=await readFile('dist/test-host/index.html','utf8');await page.route('**/__test_host',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('/__test_host');
  const app=page.frameLocator('#reader');await app.getByRole('button',{name:'笔记',exact:true}).click();await app.locator('[data-visible=true] .study-notes-list').getByRole('button',{name:/桥接分栏笔记/}).click();await expect(app.getByLabel('笔记正文')).toBeVisible();
  await app.getByRole('button',{name:'分栏操作'}).click();await app.getByRole('menuitem',{name:'移到右侧分栏'}).click();await expect(app.getByRole('tablist')).toHaveCount(2);await app.getByRole('tab',{name:'书库',exact:true}).click();await expect(app.getByRole('heading',{name:'书库',exact:true})).toBeVisible();await expect(app.getByLabel('笔记正文')).toBeVisible();
  await page.screenshot({path:'artifacts/workspace-tabs-bridge.png'});
});

test('two reading panes keep highlights, selection tools and navigation scoped to their books',async({page})=>{
  await page.goto('/');
  for(const name of ['多书甲','多书乙']){
    await page.locator('[data-visible=true]').getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:name+'.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 '+name+'\n\n'+name+'的摘录只属于这本书。\n\n'+Array.from({length:30},(_,i)=>`第 ${i+1} 段，独立记录阅读位置。`).join('\n\n'))});
    await expect(page.getByRole('heading',{name:'第一章 '+name})).toBeVisible();
    await page.locator('[data-visible=true] [data-reader-paragraph]').filter({hasText:name+'的摘录'}).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
    await page.getByRole('toolbar',{name:'选区操作'}).getByRole('button',{name:'高亮',exact:true}).click();
  }
  await dragTab(page,'多书乙',page.locator('[data-visible=true]'),'left');await expect(page.getByRole('heading',{name:'第一章 多书甲'})).toBeVisible();await expect(page.getByRole('heading',{name:'第一章 多书乙'})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>[...(CSS as any).highlights.get('reader-yellow')].map((range:Range)=>range.toString()).sort())).toEqual(['多书乙的摘录只属于这本书。','多书甲的摘录只属于这本书。'].sort());
  const right=page.locator('[data-visible=true]').filter({has:page.getByRole('heading',{name:'第一章 多书甲'})});
  await right.locator('[data-reader-paragraph]').filter({hasText:'多书甲的摘录'}).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  const tools=(await right.getByRole('toolbar',{name:'选区操作'}).boundingBox())!,bounds=(await right.boundingBox())!;expect(tools.x).toBeGreaterThanOrEqual(bounds.x);expect(tools.x+tools.width).toBeLessThanOrEqual(bounds.x+bounds.width);
  await right.getByRole('button',{name:'关闭选区操作'}).click();await page.getByRole('button',{name:'关闭页面 多书乙',exact:true}).click();await expect(page.getByRole('tablist')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>[...(CSS as any).highlights.get('reader-yellow')].map((range:Range)=>range.toString()))).toEqual(['多书甲的摘录只属于这本书。']);
});
