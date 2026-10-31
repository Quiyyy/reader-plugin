import { openNotes ,openSettings,closeSettings,setReaderTheme} from './navigation';
import { expect,test,type APIRequestContext,type Locator,type Page } from '@playwright/test';

// Existing persistence/selection scenarios exercise the source editing mode.
test.beforeEach(async({request})=>{await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name:'reader_preferences',arguments:{patch:{noteMode:'source'}}}});});
import { strToU8,zipSync } from 'fflate';
import { pdfFixture } from '../pdf-fixture';

const passage='点击这段原创高亮文字，在原文旁记录自己的理解。';
const epub=Buffer.from(zipSync(Object.fromEntries(Object.entries({
  mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  'book.opf':'<package><metadata><title>批注与检索</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
  'one.xhtml':`<html><body><h1>原创章节</h1><p id="passage">${passage}</p><p>First <strong>Target</strong> phrase, second <em>target</em> phrase.</p></body></html>`,
}).map(([name,text])=>[name,strToU8(text)]))));
async function rpc(request:APIRequestContext,name:string,args:object={}){const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});const data=await response.json();expect(data.isError,JSON.stringify(data)).not.toBe(true);return data._meta.reader;}
async function select(target:Locator){await target.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,composed:true}));});}
async function open(page:Page,format:'txt'|'epub'|'pdf'){
  await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'批注与检索.'+format,mimeType:format==='txt'?'text/plain':format==='epub'?'application/epub+zip':'application/pdf',buffer:format==='txt'?Buffer.from('第一章 原创章节\n\n'+passage):format==='epub'?epub:pdfFixture()});
  const target=format==='txt'?page.locator('[data-reader-paragraph]').filter({hasText:passage}).first():format==='epub'?page.locator('.epub-document #passage'):page.locator('.textLayer span').filter({hasText:'Recall a concept'}).first();await expect(target).toBeVisible();await expect(page.locator('.epub-loading,.pdf-loading')).toHaveCount(0);return target;
}
async function clickHighlight(page:Page,format:'txt'|'epub'|'pdf',color='yellow'){
  if(format==='pdf'){await expect(page.locator('.pdf-marks .annotation-'+color).first()).toBeVisible();const rect=await page.locator('.pdf-marks .annotation-'+color).first().boundingBox();await page.mouse.click(rect!.x+Math.min(20,rect!.width/2),rect!.y+rect!.height/2);}
  else {await expect.poll(()=>page.evaluate(name=>(CSS as any).highlights.get(name)?.size??0,(format==='epub'?'epub-':'reader-')+color)).toBeGreaterThan(0);const point=await page.evaluate(name=>{const ranges=Array.from((CSS as any).highlights.get(name)??[]) as Range[];const rect=ranges[0]?.getClientRects()[0];if(!rect)throw Error('Rendered highlight missing');return{x:rect.left+Math.min(20,rect.width/2),y:rect.top+rect.height/2};},(format==='epub'?'epub-':'reader-')+color);await page.mouse.click(point.x,point.y);}
}

for(const format of ['txt','epub','pdf'] as const)test(`${format}: existing highlights open contextual editing, preserve drafts and support color/delete/undo`,async({page,request})=>{
  await page.setViewportSize({width:390,height:900});const target=await open(page,format);await select(target);await page.getByRole('toolbar',{name:'选区操作'}).getByRole('button',{name:'高亮',exact:true}).click();
  await expect.poll(async()=>(await rpc(request,'reader_workspace')).annotations.filter((a:any)=>!a.trashedAt&&a.color==='yellow').length).toBeGreaterThan(0);
  await clickHighlight(page,format);const editor=page.getByRole('dialog',{name:'批注',exact:true});await expect(editor).toBeVisible();await expect(editor).toHaveAttribute('aria-modal','false');await expect(page.locator('dialog[open]')).toHaveCount(0);
  await editor.getByLabel('我的想法').fill('原位编辑的理解');await page.getByRole('button',{name:'返回书架',exact:true}).click();await expect(editor.getByLabel('我的想法')).toHaveValue('原位编辑的理解');await expect(editor).toContainText('请先保存或取消');
  await editor.getByRole('button',{name:'蓝色',exact:true}).click();await editor.getByRole('button',{name:'保存批注'}).click();await expect(editor).toHaveCount(0);
  await clickHighlight(page,format,'blue');await expect(editor.getByLabel('我的想法')).toHaveValue('原位编辑的理解');await editor.getByRole('button',{name:'移除批注',exact:true}).click();await expect(editor).toHaveCount(0);await page.getByRole('button',{name:'撤销',exact:true}).click();
  await clickHighlight(page,format,'blue');await expect(editor.getByLabel('我的想法')).toHaveValue('原位编辑的理解');await page.screenshot({path:`artifacts/context-annotation-${format}-390.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);if(format==='txt'){await page.setViewportSize({width:1280,height:900});await expect(editor).toBeInViewport();await setReaderTheme(page,'dark');await expect(page.locator('.study-workspace')).toHaveClass(/dark/);await closeSettings(page);await page.screenshot({path:'artifacts/context-annotation-wide-dark.png'});}
});

test('annotation version conflicts preserve the draft until explicit cancellation',async({page,request})=>{
  const target=await open(page,'txt');await select(target);await page.getByRole('toolbar',{name:'选区操作'}).getByRole('button',{name:'批注',exact:true}).click();const editor=page.getByRole('dialog',{name:'批注',exact:true});await editor.getByLabel('我的想法').fill('初始想法');await editor.getByRole('button',{name:'保存批注'}).click();
  await expect(editor).toHaveCount(0);
  const state=await rpc(request,'reader_workspace'),annotation=state.annotations.find((a:any)=>a.comment==='初始想法');expect(annotation).toBeDefined();await clickHighlight(page,'txt');await editor.getByLabel('我的想法').fill('保留我的草稿');await rpc(request,'reader_annotation_save',{id:annotation.id,revision:annotation.revision,sourceId:annotation.sourceId,color:'yellow',comment:'另一个窗口的修改'});
  await editor.getByRole('button',{name:'保存批注'}).click();await expect(editor.getByRole('alert')).toContainText('另一个窗口');await expect(editor.getByLabel('我的想法')).toHaveValue('保留我的草稿');await page.keyboard.press('Escape');await expect(editor).toBeVisible();await editor.getByRole('button',{name:'取消',exact:true}).click();await expect(editor).toHaveCount(0);
  expect((await rpc(request,'reader_workspace')).annotations.find((a:any)=>a.id===annotation.id).comment).toBe('另一个窗口的修改');
});

test('TXT search finds repeated matches, advances across chapters and clears its highlights',async({page})=>{
  await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'连续搜索.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 两次命中\n\nTarget before target after.\n\n第二章 下一处\n\nOne more target here.')});await page.getByRole('button',{name:'搜索本书（F）'}).click();await page.getByLabel('搜索本书内容').fill('target');await expect(page.locator('.search-results button')).toHaveCount(3);await expect(page.locator('.search-results mark')).not.toHaveCount(0);await page.locator('.search-results button').first().click();
  const active=()=>page.evaluate(()=>Array.from((CSS as any).highlights.get('reader-find-active')??[]).map((r:any)=>r.toString()).join(''));await expect.poll(active).toMatch(/target/i);const nav=page.getByRole('toolbar',{name:'搜索定位'});await nav.getByRole('button',{name:'下一处匹配'}).click();await nav.getByRole('button',{name:'下一处匹配'}).click();await expect(page.getByRole('heading',{name:'第二章 下一处',exact:true})).toBeVisible();await nav.getByRole('button',{name:'结束查找'}).click();await expect.poll(active).toBe('');
});

test('EPUB search highlights across inline elements and advances without modifying content',async({page})=>{
  await open(page,'epub');await page.getByRole('button',{name:'搜索本章',exact:true}).click();await page.getByLabel('搜索本章内容').fill('target phrase');await page.getByRole('button',{name:'查找',exact:true}).click();const nav=page.getByRole('toolbar',{name:'搜索定位'});
  const active=()=>page.evaluate(()=>Array.from((CSS as any).highlights.get('epub-find-active')??[]).map((r:any)=>r.toString()).join(''));await expect.poll(active).toBe('Target phrase');await nav.getByRole('button',{name:'下一处匹配'}).click();await expect.poll(active).toBe('target phrase');await nav.getByRole('button',{name:'结束查找'}).click();await expect.poll(active).toBe('');await expect(page.locator('.epub-document strong')).toHaveText('Target');
});

test('PDF search can advance within a page and preserve existing excerpt marks',async({page})=>{
  const target=await open(page,'pdf');await select(target);await page.getByRole('toolbar',{name:'选区操作'}).getByRole('button',{name:'高亮',exact:true}).click();await expect(page.locator('.pdf-marks .annotation-yellow')).not.toHaveCount(0);await page.getByRole('button',{name:'搜索 PDF',exact:true}).click();await page.getByLabel('搜索 PDF 内容').fill('a');await page.getByRole('button',{name:'查找',exact:true}).click();await page.locator('.pdf-search-hit').first().click();const nav=page.getByRole('toolbar',{name:'搜索定位'});await expect(nav).toBeVisible();await nav.getByRole('button',{name:'下一处匹配'}).click();await expect(nav.getByRole('button',{name:'上一处匹配'})).toBeEnabled();await nav.getByRole('button',{name:'结束查找'}).click();await expect(page.locator('.pdf-search-match')).toHaveCount(0);await expect(page.locator('.pdf-marks .annotation-yellow')).not.toHaveCount(0);
});

test('library and note searches reach scoped full-text results with the matching excerpt and folder',async({page,request})=>{
  const folder=(await rpc(request,'reader_folder_save',{name:'检索课程',parentId:null})).value;
  await rpc(request,'reader_note_create',{title:'技术札记',body:'前文'.repeat(300)+'深处关键词'+'后文'.repeat(200),folderId:folder.id,tags:[],sourceIds:[],imageIds:[]});
  await page.goto('/');await openNotes(page);await page.getByLabel('搜索笔记标题或摘要').fill('深处关键词');await page.getByRole('button',{name:'搜索笔记全文',exact:true}).click();await expect(page.getByRole('group',{name:'搜索范围'}).getByRole('button',{name:'笔记',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.study-search-hit mark')).toContainText('深处关键词');await expect(page.locator('.study-search-hit small')).toContainText('检索课程');await page.locator('.study-search-hit').click();await expect(page.getByLabel('笔记正文')).toHaveValue(/深处关键词/);await page.goto('/');await page.getByLabel('搜索书籍、笔记和文件夹').fill('深处关键词');await page.getByLabel('搜索书籍、笔记和文件夹').press('Enter');await expect(page.getByRole('group',{name:'搜索范围'}).getByRole('button',{name:'全部',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.study-search-hit mark')).toContainText('深处关键词');
});

for(const format of ['txt','epub','pdf'] as const)test(`${format}: a global passage result opens its actual location and highlights the query`,async({page,request})=>{
  const query=format==='pdf'?'Recall':'独有检索词'+format;
  const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>','book.opf':'<package><metadata><title>全局检索定位</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>','a.xhtml':'<html><body><h1>起始章节</h1><p>这里没有搜索词。</p></body></html>','b.xhtml':`<html><body><h1>目标章节</h1><p>${query}位于第二章。</p></body></html>`};
  await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'全局检索.'+format,mimeType:format==='txt'?'text/plain':format==='epub'?'application/epub+zip':'application/pdf',buffer:format==='txt'?Buffer.from('第一章 起点\n\n这里没有搜索词。\n\n第二章 目标\n\n'+query+'位于第二章。'):format==='epub'?Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)])))):pdfFixture()});
  await expect(page.getByRole('button',{name:'返回书架',exact:true})).toBeVisible();await expect(page.locator('.epub-loading,.pdf-loading')).toHaveCount(0);await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.getByLabel('搜索书籍、笔记和文件夹').fill(query);await page.getByLabel('搜索书籍、笔记和文件夹').press('Enter');await page.getByRole('group',{name:'搜索范围'}).getByRole('button',{name:'原文',exact:true}).click();await page.locator('.study-search-hit').first().click();
  const key=(format==='txt'?'reader':format)+'-find-active';await expect.poll(()=>page.evaluate(key=>Array.from((CSS as any).highlights.get(key)??[]).map((r:any)=>r.toString()).join(''),key)).toContain(query);
  if(format==='epub')await expect(page.locator('.epub-document h1')).toHaveText('目标章节');
  if(format==='txt')await expect(page.getByRole('heading',{name:'第二章 目标',exact:true})).toBeVisible();
});
