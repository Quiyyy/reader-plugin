import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {strToU8,zipSync} from 'fflate';
import {openNotes,openSettings,closeSettings} from './navigation';

async function rpc(request:APIRequestContext,name:string,args:object={}){return (await(await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}})).json())._meta.reader;}
async function host(page:Page){const html=await readFile('dist/test-host/index.html','utf8');await page.route('**/__test_host',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('/__test_host');const app=page.frameLocator('#reader');await expect(app.getByRole('heading',{name:'书库',exact:true})).toBeVisible();return app;}
const paragraph=(i:number)=>`位置 ${i}：`+'这是用于检查宿主窗口重新布局的原创内容，改变宽度后仍应留在当前阅读位置。'.repeat(7);
const content='# 第一部分\n\n'+Array.from({length:70},(_,i)=>paragraph(i)).join('\n\n');

for(const mode of ['reading','epub','pages','visual','source'])test(`host pane relayout retains ${mode} scroll position`,async({page,request})=>{
  await rpc(request,'reader_preferences',{patch:{noteMode:mode==='source'?'source':'visual'}});const title='宿主布局 '+mode,isBook=['reading','epub','pages'].includes(mode),isEpub=mode==='epub'||mode==='pages';
  if(!isBook)await rpc(request,'reader_note_create',{title,body:content,folderId:null,tags:[],sourceIds:[],imageIds:[]});
  const app=await host(page);
  if(mode==='reading'){await app.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:title+'.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 重排\n\n'+content)});}
  else if(isEpub){const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>','book.opf':`<package><metadata><title>${title}</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`,'a.xhtml':'<html><body><h1>重排</h1>'+Array.from({length:70},(_,i)=>`<p>${paragraph(i)}</p>`).join('')+'</body></html>'};await app.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:title+'.epub',mimeType:'application/epub+zip',buffer:Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)]))))});await expect(app.locator('.epub-document .reader-book-body')).toBeVisible();await expect(app.locator('.epub-loading')).toHaveCount(0);if(mode==='pages'){await openSettings(app,'阅读');await app.getByRole('button',{name:'翻页',exact:true}).click();await closeSettings(app);await expect(app.getByRole('region',{name:'设置',exact:true})).toBeHidden();}}
  else{await app.getByRole('button',{name:new RegExp('^打开笔记 '+title)}).click();await expect(app.getByLabel('笔记正文')).toBeVisible();}
  const scroll=app.locator(mode==='reading'?'.reading-scroll':isEpub?'.epub-document':'.study-editor-body');await scroll.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await scroll.dispatchEvent('pointerdown');await scroll.evaluate((el,paged)=>{if(paged)el.scrollLeft=Math.floor((el.scrollWidth-el.clientWidth)*.55/el.clientWidth)*el.clientWidth;else el.scrollTop=el.scrollHeight*.55;},mode==='pages');await scroll.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect.poll(()=>scroll.evaluate((el,paged)=>paged?el.scrollLeft:el.scrollTop,mode==='pages')).toBeGreaterThan(1000);
  if(isEpub){const book=(await rpc(request,'reader_list')).books.find((book:any)=>book.title===title);await expect.poll(async()=>(await rpc(request,'reader_epub_open',{id:book.id})).state.location?.quote.exact??'重排').not.toBe('重排');}
  const before=await scroll.evaluate((el,paged)=>paged?el.scrollLeft:el.scrollTop,mode==='pages');
  for(const width of [780,600,390,620,1000,1280]){await page.locator('#reader').evaluate((el,width)=>el.style.width=width+'px',width);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect.poll(()=>scroll.evaluate((el,paged)=>paged?el.scrollLeft:el.scrollTop,mode==='pages'),{timeout:1500}).toBeGreaterThan(1000);}
  await expect.poll(()=>scroll.evaluate((el,paged)=>paged?el.scrollLeft:el.scrollTop,mode==='pages')).toBeCloseTo(before,-2);
});

test('note navigation and outline reserve visible document space and hide the composer',async({page,request})=>{
  await rpc(request,'reader_preferences',{patch:{noteMode:'visual'}});await rpc(request,'reader_note_create',{title:'并排侧栏',body:'# 标题\n\n正文必须可见。\n\n## 下一节\n\n其余内容。',folderId:null,tags:[],sourceIds:[],imageIds:[]});await page.goto('/');await openNotes(page);await page.locator('.study-notes-list').getByRole('button',{name:/^并排侧栏/}).click();
  for(const width of [1100,793,390,320]){await page.setViewportSize({width,height:850});const editor=page.locator('.note-rich-content'),composer=page.getByLabel('给 Note Bot 的要求');
    await page.getByRole('button',{name:'主导航',exact:true}).click();await expect(composer).toBeHidden();let nav=await page.getByRole('navigation',{name:'主导航',exact:true}).boundingBox(),body=await editor.boundingBox();expect(body!.x).toBeGreaterThanOrEqual(nav!.x+nav!.width);await expect(editor.getByText('正文必须可见。')).toBeInViewport();await page.getByRole('button',{name:'收起导航',exact:true}).click();
    await page.getByRole('button',{name:'目录（T）'}).click();await expect(composer).toBeHidden();nav=await page.getByRole('dialog',{name:'笔记目录'}).boundingBox();body=await editor.boundingBox();expect(body!.x).toBeGreaterThanOrEqual(nav!.x+nav!.width);await page.screenshot({path:`artifacts/note-docked-outline-${width}.png`});await page.getByRole('button',{name:'关闭目录',exact:true}).click();await expect(composer).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('the bottom composer toggle aligns with save status and preserves drafts through panels',async({page,request})=>{
  await rpc(request,'reader_preferences',{patch:{noteMode:'visual'}});await rpc(request,'reader_note_create',{title:'可收起的对话',body:'# 主题\n\n需要修改的段落。',folderId:null,tags:[],sourceIds:[],imageIds:[]});await page.goto('/');await page.getByRole('button',{name:'打开笔记 可收起的对话',exact:true}).click();
  await expect(page.locator('.study-editor-head').getByRole('button',{name:'Note Bot',exact:true})).toHaveCount(0);
  const input=page.getByLabel('给 Note Bot 的要求');await input.fill('保留这段尚未发送的要求');
  for(const width of [1280,390]){await page.setViewportSize({width,height:850});const toggle=page.getByRole('button',{name:'隐藏输入框',exact:true}),status=await page.locator('.study-note-status').boundingBox(),button=await toggle.boundingBox();expect(Math.abs(status!.y+status!.height/2-button!.y-button!.height/2)).toBeLessThan(1);const before=await page.locator('.study-editor-body').boundingBox();await toggle.click();await expect(input).toBeHidden();expect((await page.locator('.study-editor-body').boundingBox())!.height).toBeGreaterThan(before!.height);
    await page.getByRole('button',{name:'目录（T）'}).click();await page.getByRole('button',{name:'关闭目录',exact:true}).click();await expect(input).toBeHidden();await page.getByRole('button',{name:'显示输入框',exact:true}).click();await expect(input).toHaveValue('保留这段尚未发送的要求');
  }
  await page.getByRole('button',{name:'隐藏输入框',exact:true}).click();await page.locator('.note-rich-content p').hover();await page.getByRole('button',{name:'块操作',exact:true}).click();await page.getByRole('menuitem',{name:'提出修改要求',exact:true}).click();await expect(input).toBeVisible();await expect(input).toBeFocused();await expect(input).toHaveValue('保留这段尚未发送的要求');
});

test('empty visual paragraphs retain their position while the host pane is resized',async({page,request})=>{
  await rpc(request,'reader_preferences',{patch:{noteMode:'visual'}});const app=await host(page);await app.getByRole('button',{name:'快速笔记',exact:true}).click();const editor=app.getByLabel('笔记正文');await editor.fill('开始');await editor.press('ControlOrMeta+End');for(let i=0;i<45;i++)await editor.press('Enter');await editor.pressSequentially('结尾');const scroll=app.locator('.study-editor-body');await scroll.dispatchEvent('pointerdown');await scroll.evaluate(el=>el.scrollTop=800);await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(800);await scroll.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const index=await editor.locator('p').evaluateAll(elements=>elements.findIndex(el=>el.getBoundingClientRect().bottom>el.closest('.study-editor-body')!.getBoundingClientRect().top+42));const marker=editor.locator('p').nth(index),position=()=>marker.evaluate(el=>el.getBoundingClientRect().top-el.closest('.study-editor-body')!.getBoundingClientRect().top),before=await position();
  for(const width of [780,390,1000,1280]){await page.locator('#reader').evaluate((el,width)=>el.style.width=width+'px',width);await expect.poll(position).toBeCloseTo(before,0);}await expect(editor.locator('p')).toHaveCount(46);
});
