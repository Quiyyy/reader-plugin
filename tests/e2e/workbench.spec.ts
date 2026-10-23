import { test,expect,type APIRequestContext } from '@playwright/test';
import { defaultAppearance } from '../../src/shared/workspace';
import type { BookSummary } from '../../src/shared/types';

async function call(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  expect(response.ok(),await response.text()).toBe(true);const result=await response.json();expect(result.isError).not.toBe(true);return result._meta.reader;
}
const quote='当我们能用自己的话解释一个观点，并把它放进新的情境里，阅读才开始成为自己的经验。';
const original=`第一章 把阅读变成理解\n\n${quote}\n\n合上书，用自己的语言解释，再找一个与日常生活有关的例子。\n\n第二章 给问题留一个位置\n\n问题不必立即有答案，可以先记录，再回到书中核对。`;

test('workbench layout is independent of appearance, responsive and preserves reading context',async({page,request})=>{
  test.setTimeout(60000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await call(request,'reader_appearance',{appearance:{...defaultAppearance,mode:'light'}});
  await call(request,'reader_library_layout',{layout:'list'});
  await page.goto('/');
  const titles=['慢读的方法','山河小记','日常设计札记','长夜里的灯塔','时间的形状','缓慢的观察'];
  await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles(titles.map((title,i)=>({name:title+'.txt',mimeType:'text/plain',buffer:Buffer.from(original+'\n\n'+title+' · 原创验收 '+i)})));
  for(const title of titles)await expect(page.getByRole('button',{name:new RegExp('^打开 '+title+'，')})).toBeVisible();
  const library=await call(request,'reader_list'),books=titles.map(title=>(library.books as BookSummary[]).find(b=>b.title===title)!);
  const folder=(await call(request,'reader_folder_save',{name:'我的书库',parentId:null})).value;
  for(const [index,book] of books.entries())await call(request,'reader_book_metadata',{id:book.id,revision:0,metadata:{title:titles[index],folderId:folder.id,tags:['界面验收']}});
  const openShelf=async()=>{await expect(page.getByRole('heading',{name:'书库',exact:true})).toBeVisible();await page.getByRole('searchbox',{name:'搜索书名或作者'}).fill('界面验收');};
  for(const index of [0,1,2,3])await call(request,'reader_progress',{id:books[index]!.id,locator:{chapter:0,paragraph:index%2}});
  const finished=await call(request,'reader_get',{id:books[5]!.id}),lastChapter=finished.document.chapters.length-1;
  await call(request,'reader_progress',{id:books[5]!.id,locator:{chapter:lastChapter,paragraph:finished.document.chapters[lastChapter].paragraphs.length-1}});
  const detail=await call(request,'reader_get',{id:books[0]!.id}),paragraph=detail.document.chapters[0].paragraphs.indexOf(quote);
  expect(paragraph).toBeGreaterThanOrEqual(0);
  const source=await call(request,'reader_source_create',{source:{bookId:books[0]!.id,quote,anchor:{kind:'text',start:{chapter:0,paragraph,offset:0},end:{chapter:0,paragraph,offset:quote.length}}}});
  for(const [title,body] of [['把阅读变成自己的经验','理解不只是记住原句，而是能够用自己的话解释，再放进新的情境。'],['给问题留一个位置','先记录一个疑问，下次阅读时再回来，看看它是否连接起了新的线索。']])await call(request,'reader_note_create',{title,body,folderId:folder.id,tags:[],sourceIds:[source.id],imageIds:[],relatedBookId:books[0]!.id});
  await page.reload();await openShelf();
  await expect(page.getByRole('region',{name:'正在阅读'}).locator('.book-card')).toHaveCount(4);
  await expect(page.getByRole('region',{name:'稍后阅读'}).locator('.book-card')).toHaveCount(1);
  await expect(page.getByRole('region',{name:'已读完'}).locator('.book-card')).toHaveCount(1);
  const geometry=()=>page.locator('.study-library-workspace,.study-library-notes,.study-continue').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  let baseline:Awaited<ReturnType<typeof geometry>>|undefined;
  for(const mode of ['light','dark'] as const){
    await page.getByRole('button',{name:'外观',exact:true}).click();
    await page.getByRole('button',{name:mode==='light'?'浅色':'深色',exact:true}).click();
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'外观',exact:true})).toHaveCount(0);
    await expect(page.locator('.study-workspace')).toHaveClass(new RegExp(mode));
    const current=await geometry();if(baseline)expect(current).toEqual(baseline);else baseline=current;
    await page.screenshot({animations:'disabled',path:`artifacts/workbench-library-${mode}-1280.png`});
  }
  await page.getByRole('button',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'暖纸',exact:true}).click();
  await page.getByLabel('强调色十六进制值').fill('#8551B2');await page.getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'外观',exact:true})).toHaveCount(0);
  expect(await geometry()).toEqual(baseline);await page.screenshot({animations:'disabled',path:'artifacts/workbench-library-cream-1280.png'});
  await page.reload();await openShelf();await expect(page.locator('.study-workspace')).toHaveCSS('--study-accent','#8551B2');await expect(page.locator('.study-workspace')).toHaveAttribute('data-layout','workbench');
  await page.getByRole('searchbox',{name:'搜索书名或作者'}).fill('山河');await expect(page.locator('.book-card')).toHaveCount(1);
  await page.getByRole('searchbox',{name:'搜索书名或作者'}).fill('界面验收');
  await page.getByRole('button',{name:/^正在阅读 4$/}).click();await expect(page.getByRole('region',{name:'正在阅读'}).locator('.book-card')).toHaveCount(0);
  await page.getByRole('button',{name:/^正在阅读 4$/}).click();await expect(page.locator('.book-card')).toHaveCount(6);
  await page.getByRole('button',{name:'切换卡片',exact:true}).click();await expect(page.locator('.study-book-grid.cards')).toHaveCount(3);
  await page.getByRole('button',{name:'切换列表',exact:true}).click();await expect(page.locator('.study-book-grid.list')).toHaveCount(3);
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('.study-library-workspace').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button',{name:'切换卡片',exact:true})).toBeInViewport();
    await page.screenshot({animations:'disabled',path:`artifacts/workbench-library-${width}.png`});
  }
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:/^打开 慢读的方法，/}).click();
  await page.locator('[data-reader-paragraph]').filter({hasText:quote}).first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  // Fixture replies exercise the production message UI without calling a model.
  await page.route('**/api/tool',async route=>{
    const name=route.request().postDataJSON()?.name;
    if(name!=='reader_chat_create'&&name!=='reader_chat_get')return route.continue();
    const response=await route.fetch(),body=await response.json(),session=body._meta.reader;
    session.title='从读懂，到真正理解';session.messages=[{id:'fixture-question',role:'user',text:'这段话里的“自己的经验”，应该怎么理解？',sourceIds:[source.id],createdAt:new Date().toISOString()},{id:'fixture-answer',role:'assistant',text:'关键是从**记住作者说了什么**，走到**我能用它解释什么**。\n\n可以试着做两件小事：\n\n1. **换一种说法。** 合上书，用自己的话向朋友解释。\n2. **放进一个新例子。** 找一件生活中的事，看看这个观点是否适用。',sourceIds:[source.id],createdAt:new Date().toISOString()}];
    await route.fulfill({response,json:body});
  });
  const before=await page.locator('.study-book-view').boundingBox();
  await page.getByRole('toolbar',{name:'选区操作'}).getByRole('button',{name:'问 Codex',exact:true}).click();
  const chat=page.getByRole('dialog',{name:'阅读对话',exact:true});await expect(chat).toBeVisible();await expect(chat).toContainText('我能用它解释什么');
  expect((await page.locator('.study-book-view').boundingBox())!.width).toBe(before!.width);
  await page.getByRole('button',{name:'查看提问来源',exact:true}).click();await expect(page.locator('.study-chat-compose .study-source')).toContainText(quote);
  await page.getByRole('button',{name:'查看提问来源',exact:true}).click();
  await page.getByLabel('阅读问题',{exact:true}).fill('用一个日常例子继续解释。');await page.getByRole('button',{name:'收起对话',exact:true}).click();await page.getByRole('button',{name:'继续阅读对话',exact:true}).click();await expect(page.getByLabel('阅读问题',{exact:true})).toHaveValue('用一个日常例子继续解释。');
  for(const mode of ['light','dark'] as const){
    await page.getByRole('button',{name:'界面外观',exact:true}).click();await page.getByRole('button',{name:mode==='light'?'浅色':'深色',exact:true}).click();await page.getByRole('button',{name:'白纸',exact:true}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'外观',exact:true})).toHaveCount(0);
    await page.screenshot({animations:'disabled',path:`artifacts/workbench-chat-${mode}-1280.png`});
  }
  // A dragged window must remain inside the viewport after its width changes.
  const head=(await page.locator('.study-chat-head').boundingBox())!;await page.mouse.move(head.x+180,head.y+15);await page.mouse.down();await page.mouse.move(700,110,{steps:5});await page.mouse.up();await page.setViewportSize({width:800,height:700});
  let box=(await chat.boundingBox())!;expect(box.x+box.width).toBeLessThanOrEqual(800);expect(box.y+box.height).toBeLessThanOrEqual(700);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});box=(await chat.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(844);await expect(page.getByLabel('阅读问题',{exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'交给原生对话',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({animations:'disabled',path:`artifacts/workbench-chat-${width}.png`});}
  expect(errors).toEqual([]);
});
