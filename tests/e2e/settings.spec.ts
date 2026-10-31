import {defaultSettings} from '../../src/shared/types';
import { expect,test,type APIRequestContext,type Page } from '@playwright/test';
import { strToU8,zipSync } from 'fflate';
import { defaultAppearance } from '../../src/shared/workspace';

test.beforeEach(async({request})=>{await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name:'reader_settings',arguments:{settings:{...defaultSettings,epub:{style:'original',flow:'scroll'}}}}});});
test.afterEach(async({request})=>{await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name:'reader_settings',arguments:{settings:{...defaultSettings,epub:{style:'original',flow:'scroll'}}}}});});
async function rpc(request:APIRequestContext,name:string,args:object={}) {const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}}),value=await response.json();expect(value.isError,JSON.stringify(value)).not.toBe(true);return value._meta.reader;}
async function openSettings(page:Page) {await page.getByRole('button',{name:'设置',exact:true}).click();const settings=page.getByRole('region',{name:'设置',exact:true});await expect(settings).toBeVisible();return settings;}
test.beforeEach(async({request})=>{await rpc(request,'reader_preferences',{patch:{noteMode:'visual',noteToolbar:false,librarySort:'visited'}});await rpc(request,'reader_appearance',{appearance:{...defaultAppearance,mode:'light'}});});

for(const width of [1280,390,320])test(`unified settings searches, saves note preferences and embeds Note Bots at ${width}`,async({page,request})=>{
  await page.setViewportSize({width,height:850});await page.goto('/');const settings=await openSettings(page),nav=settings.getByRole('navigation',{name:'设置分类'});
  await expect(nav.getByRole('button')).toHaveCount(9);await expect(page.getByRole('dialog',{name:'外观',exact:true})).toHaveCount(0);await settings.getByLabel('搜索设置').fill('字号');await settings.locator('.settings-results').getByRole('button',{name:/^笔记/}).click();await expect(settings.getByRole('heading',{name:'笔记',exact:true})).toBeVisible();
  await settings.getByLabel('笔记默认字号').selectOption('18');await settings.getByLabel('默认编辑模式').selectOption('source');await settings.getByRole('switch',{name:'显示格式工具栏'}).click();await expect.poll(async()=>(await rpc(request,'reader_workspace')).preferences).toMatchObject({noteMode:'source',noteToolbar:true});
  await page.screenshot({path:`artifacts/settings-notes-${width}.png`});await nav.getByRole('button',{name:'Note Bots',exact:true}).click();const bots=settings.getByRole('region',{name:'Note Bot 配置'});await expect(bots.getByLabel('Bot 指令')).toBeVisible();await expect(bots.getByRole('button',{name:'保存 Bot'})).toBeInViewport();await expect(bots.getByRole('button',{name:'返回笔记',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`artifacts/settings-bots-${width}.png`});
  await settings.getByRole('button',{name:'返回 Reader'}).click();await page.getByRole('button',{name:'快速笔记',exact:true}).click();await expect(page.locator('textarea[aria-label="笔记正文"]')).toBeVisible();await expect(page.getByLabel('笔记正文')).toHaveCSS('font-size','18px');await expect(page.getByRole('toolbar',{name:'笔记格式'})).toBeVisible();await page.getByLabel('笔记正文').fill('设置返回后保留的笔记。');
  await page.getByRole('button',{name:'笔记操作',exact:true}).click();await page.getByRole('button',{name:'笔记设置',exact:true}).click();await expect(settings.getByLabel('笔记默认字号')).toHaveValue('18');await settings.getByRole('button',{name:'返回 Reader'}).click();await expect(page.getByLabel('笔记正文')).toHaveValue('设置返回后保留的笔记。');
});

test('appearance, library defaults, keyboard, sources and data share the same settings surface',async({page,request})=>{
  await page.goto('/');const settings=await openSettings(page),nav=settings.getByRole('navigation',{name:'设置分类'});
  await settings.getByLabel('默认书库视图').selectOption('list');await settings.getByLabel('默认书库排序').selectOption('name');await nav.getByRole('button',{name:'外观',exact:true}).click();await settings.getByRole('button',{name:'深色',exact:true}).click();await settings.getByRole('button',{name:'苔绿',exact:true}).click();await expect(page.locator('.study-workspace')).toHaveClass(/dark/);await expect.poll(async()=>(await rpc(request,'reader_workspace')).appearance.accent).toBe('#467b65');
  await nav.getByRole('button',{name:'快捷键',exact:true}).click();await expect(settings.getByRole('button',{name:'录制向上滚动',exact:true})).toBeVisible();await nav.getByRole('button',{name:'书源',exact:true}).click();await expect(settings.getByRole('button',{name:'导入书源',exact:true})).toBeVisible();if((await rpc(request,'reader_online_sources')).length)await expect(settings.getByLabel('搜索书源名称或域名')).toBeVisible();else await expect(settings.getByRole('heading',{name:'还没有书源'})).toBeVisible();
  await nav.getByRole('button',{name:'数据与关于',exact:true}).click();await expect(settings.getByLabel('书库位置',{exact:true})).not.toHaveValue('');await settings.getByRole('button',{name:'返回 Reader'}).click();await expect(page.locator('.library-grid')).toHaveClass(/list/);await expect(page.getByLabel('书架排序')).toHaveValue('name');
});

test('text reading settings use the central page and preserve the current paragraph',async({page,request})=>{
  await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'设置阅读位置.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 设置\n\n'+Array.from({length:70},(_,index)=>`第 ${index+1} 段：阅读样式调整后保留当前段落。`).join('\n\n'))});
  const paragraph=page.locator('[data-reader-paragraph]').filter({hasText:'第 40 段：'});await paragraph.scrollIntoViewIfNeeded();const book=(await rpc(request,'reader_list')).books.find((book:any)=>book.title==='设置阅读位置');await expect.poll(async()=>(await rpc(request,'reader_get',{id:book.id})).summary.locator.paragraph).toBeGreaterThan(30);const before=(await rpc(request,'reader_get',{id:book.id})).summary.locator;
  const settings=await openSettings(page);await expect(settings.getByRole('heading',{name:'阅读',exact:true})).toBeVisible();const size=(await rpc(request,'reader_list')).settings.fontSize;await settings.getByRole('button',{name:'增大字号',exact:true}).click();await expect.poll(async()=>(await rpc(request,'reader_list')).settings.fontSize).toBe(size+1);await settings.getByRole('button',{name:'返回 Reader'}).click();await expect(paragraph).toBeInViewport();expect((await rpc(request,'reader_get',{id:book.id})).summary.locator).toEqual(before);
});

test('EPUB uses global settings within the shared page',async({page,request})=>{
  const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>','book.opf':'<package><metadata><title>排版设置</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>','a.xhtml':'<html><body><h1>章节</h1><p>打开统一设置后仍保留原文。</p></body></html>'};
  await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'排版设置.epub',mimeType:'application/epub+zip',buffer:Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,strToU8(value)]))))});await expect(page.locator('.epub-document .reader-book-body')).toBeVisible();await expect(page.locator('.epub-loading')).toHaveCount(0);const settings=await openSettings(page);await expect(settings.getByLabel('阅读设置范围')).toHaveCount(0);await settings.getByRole('button',{name:'舒适',exact:true}).click();await settings.getByRole('button',{name:'翻页',exact:true}).click();await settings.getByRole('button',{name:'返回 Reader'}).click();await expect(settings).toBeHidden();const book=(await rpc(request,'reader_list')).books.find((book:any)=>book.title==='排版设置');expect((await rpc(request,'reader_epub_open',{id:book.id})).state.appearance).toMatchObject({style:'comfort',flow:'pages'});await expect(page.locator('.epub-document')).toContainText('保留原文');await expect(page.locator('.epub-document')).toHaveClass(/is-paged/);
});

test('EPUB defaults are available from the shelf and persist across different books',async({page,request})=>{
  await page.goto('/');const settings=await openSettings(page);
  await settings.getByLabel('搜索设置').fill('EPUB');await settings.getByRole('button',{name:'EPUB 阅读方式 阅读',exact:true}).click();
  await settings.getByRole('button',{name:'舒适',exact:true}).click();await settings.getByRole('button',{name:'翻页',exact:true}).click();
  await settings.getByRole('button',{name:'增大字号',exact:true}).click();await settings.getByLabel('阅读字体').selectOption('sans');
  await settings.getByRole('button',{name:'返回 Reader'}).click();
  for(const title of ['共享排版甲','共享排版乙']){
    const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>','book.opf':`<package><metadata><title>${title}</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`,'a.xhtml':`<html><body><h1>${title}</h1><p>统一设置适用于每本书。</p></body></html>`};
    await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:title+'.epub',mimeType:'application/epub+zip',buffer:Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([key,value])=>[key,strToU8(value)]))))});
    await expect(page.locator('.epub-document')).toHaveClass(/is-paged/);await expect(page.locator('.epub-document .reader-book-body')).toHaveCSS('font-size','21px');
    await expect(page.getByRole('button',{name:'更多',exact:true})).toHaveCount(0);await expect(page.locator('.epub-loading')).toHaveCount(0);
    await page.getByRole('button',{name:'收藏当前位置（B）'}).click();await page.getByRole('button',{name:'目录（T）'}).click();await page.getByRole('button',{name:'书签',exact:true}).click();await expect(page.locator('.bookmark-jump')).toHaveCount(1);
    await page.getByRole('button',{name:'关闭书签',exact:true}).click();await page.getByRole('button',{name:'返回书架',exact:true}).click();
  }
  const saved=(await rpc(request,'reader_list')).settings;expect(saved).toMatchObject({fontSize:21,fontFamily:'sans',epub:{style:'comfort',flow:'pages'}});
  await page.reload();await openSettings(page);await settings.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'阅读',exact:true}).click();await expect(settings.getByRole('button',{name:'翻页',exact:true})).toHaveAttribute('aria-pressed','true');
  for(const width of [1280,390,320]){await page.setViewportSize({width,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`artifacts/epub-global-settings-${width}.png`});}
});

test('a later settings edit retains earlier unsaved values after a transient write failure',async({page,request})=>{
  await page.goto('/');const settings=await openSettings(page),nav=settings.getByRole('navigation',{name:'设置分类'});let rejectPreferences=true,rejectReading=true;
  await page.route('**/api/tool',async route=>{const name=route.request().postDataJSON()?.name;if(name==='reader_preferences'&&rejectPreferences){rejectPreferences=false;return route.fulfill({json:{isError:true,content:[{type:'text',text:'测试写入暂不可用'}]}});}if(name==='reader_settings'&&rejectReading){rejectReading=false;return route.fulfill({json:{isError:true,content:[{type:'text',text:'测试写入暂不可用'}]}});}return route.continue();});
  await nav.getByRole('button',{name:'笔记',exact:true}).click();await settings.getByLabel('默认编辑模式').selectOption('source');await expect(settings.getByRole('alert')).toContainText('暂不可用');await settings.getByRole('switch',{name:'显示格式工具栏'}).click();await expect.poll(async()=>(await rpc(request,'reader_workspace')).preferences).toMatchObject({noteMode:'source',noteToolbar:true});
  await nav.getByRole('button',{name:'阅读',exact:true}).click();const before=(await rpc(request,'reader_list')).settings;await settings.getByRole('button',{name:'增大字号',exact:true}).click();await expect(settings.getByRole('alert')).toContainText('暂不可用');await settings.getByLabel('阅读字体').selectOption(before.fontFamily==='serif'?'sans':'serif');await expect.poll(async()=>(await rpc(request,'reader_list')).settings.fontSize).toBe(before.fontSize+1);await settings.getByRole('button',{name:'返回 Reader'}).click();await expect(settings).toBeHidden();
});
