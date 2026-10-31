import {defaultSettings} from '../../src/shared/types';
import {test,expect} from '@playwright/test';
import {strToU8,zipSync} from 'fflate';
import {openSettings,closeSettings} from './navigation';

test.beforeEach(async({request})=>{await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name:'reader_settings',arguments:{settings:{...defaultSettings,epub:{style:'original',flow:'scroll'}}}}});});
test.afterEach(async({request})=>{await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name:'reader_settings',arguments:{settings:{...defaultSettings,epub:{style:'original',flow:'scroll'}}}}});});
for(const format of ['txt','epub','pages'])test(`continuous pane resizing retains the passage in ${format}`,async({page})=>{
  const passage=(i:number)=>`第 ${i} 段。`+'阅读窗口宽度变化时，正在阅读的内容应该留在视野中，不能重新跳到章节开头。'.repeat(8);
  const title='连续调整宽度 '+format;
  const files={mimetype:'application/epub+zip','META-INF/container.xml':'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>','book.opf':`<package><metadata><title>${title}</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`,'a.xhtml':'<html><body><h1>章节</h1>'+Array.from({length:60},(_,i)=>`<p id="p${i}">${passage(i)}</p>`).join('')+'</body></html>'};
  const epub=format!=='txt';await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:title+(epub?'.epub':'.txt'),mimeType:epub?'application/epub+zip':'text/plain',buffer:epub?Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])))):Buffer.from('第一章 章节\n\n'+Array.from({length:60},(_,i)=>passage(i)).join('\n\n'))});
  const scroller=page.locator(epub?'.epub-document':'.reading-scroll');await expect(scroller).toBeVisible();await expect(page.locator('.epub-loading')).toHaveCount(0);
  if(format==='pages'){await openSettings(page,'阅读');await page.getByRole('button',{name:'翻页',exact:true}).click();await closeSettings(page);await expect(page.getByRole('region',{name:'设置',exact:true})).toBeHidden();}
  await scroller.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const target=epub?page.locator('.epub-document #p30'):page.locator('[data-reader-paragraph]').filter({hasText:'第 30 段。'});
  await scroller.dispatchEvent('pointerdown');await target.evaluate((el,paged)=>{const host=el.getRootNode() instanceof ShadowRoot?(el.getRootNode() as ShadowRoot).host:el.closest('.reading-scroll')!;const rect=el.getBoundingClientRect(),box=host.getBoundingClientRect();if(paged)host.scrollLeft+=rect.left-box.left;else host.scrollTop+=rect.top-box.top-40;},format==='pages');
  await expect(target).toBeInViewport();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const rpc=async(name:string,args:object={})=>(await(await page.request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}})).json())._meta.reader;
  const book=(await rpc('reader_list')).books.find((book:any)=>book.title===title);
  if(epub)await expect.poll(async()=>(await rpc('reader_epub_open',{id:book.id})).state.location?.quote.exact??'章节').not.toBe('章节');
  const anchor=epub?(await rpc('reader_epub_open',{id:book.id})).state.location:undefined;
  const anchorVisible=()=>scroller.evaluate((host,anchor)=>{const element=[...host.shadowRoot!.querySelectorAll<HTMLElement>('[data-reader-node]')].find(el=>el.dataset.readerNode===anchor.element)!;const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null,offset=anchor.offset;while((node=walker.nextNode())){const length=node.textContent!.length;if(offset<length){const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);const rect=range.getBoundingClientRect(),box=host.getBoundingClientRect();return rect.right>box.left&&rect.left<box.right&&rect.bottom>box.top&&rect.top<box.bottom;}offset-=length;}return false;},anchor);
  for(const width of [1100,920,780,660,540,390,520,760,1040,1280]){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));if(epub)await expect.poll(anchorVisible).toBe(true);else await expect(target).toBeInViewport();}
  if(epub)expect((await rpc('reader_epub_open',{id:book.id})).state.location).toEqual(anchor);
  if(epub){
    // A desktop pane can be collapsed for a layout pass and return to the same
    // dimensions. The last non-zero dimensions alone cannot detect this cycle.
    await scroller.evaluate(async el=>{el.style.display='none';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));el.style.display='';});
    await expect.poll(anchorVisible).toBe(true);
    // Chromium can deliver a delayed native offset reset after resize settles.
    // With no new reading gesture, this must never become the saved progress.
    await scroller.evaluate((el,paged)=>{if(paged)el.scrollLeft=0;else el.scrollTop=0;},format==='pages');
    await expect.poll(anchorVisible).toBe(true);
    expect((await rpc('reader_epub_open',{id:book.id})).state.location).toEqual(anchor);
  }
  expect(await scroller.evaluate((el,paged)=>paged?el.scrollLeft:el.scrollTop,format==='pages')).toBeGreaterThan(1000);
  if(epub){
    if(format==='pages')await scroller.press('PageDown');
    else{await scroller.hover();await page.mouse.wheel(0,600);}
    await expect.poll(async()=>(await rpc('reader_epub_open',{id:book.id})).state.location).not.toEqual(anchor);
  }
});
