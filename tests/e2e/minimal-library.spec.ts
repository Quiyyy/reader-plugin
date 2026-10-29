import { test,expect,type APIRequestContext } from '@playwright/test';
import { defaultAppearance } from '../../src/shared/workspace';

async function call(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  expect(response.ok(),await response.text()).toBe(true);const result=await response.json();expect(result.isError).not.toBe(true);return result._meta.reader;
}
test('cover library mixes entries, persists visits and moves books and notebooks atomically',async({page,request})=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await call(request,'reader_appearance',{appearance:{...defaultAppearance,mode:'light'}});await call(request,'reader_library_layout',{layout:'cards'});
  await page.goto('/');await page.getByRole('button',{name:'新建',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'笔记本',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:'文件夹',exact:true})).toBeVisible();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'导入书籍',exact:true}).click();
  const title='时间与阅读：一份很长的原创整理验收书名';
  await (await chooser).setFiles({name:title+'.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 晨间\n\n从一页开始。\n\n第二章 午后\n\n读到这里，留下自己的理解。')});
  await expect(page.getByRole('heading',{name:'第一章 晨间',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回书架',exact:true}).click();
  await expect(page.getByRole('heading',{name:'书库',exact:true})).toBeVisible();
  const book=(await call(request,'reader_list')).books.find((item:any)=>item.title===title);
  await expect.poll(async()=>(await call(request,'reader_workspace')).visits['book:'+book.id]).toBeTruthy();
  const image=await call(request,'reader_image_put',{data:await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d')!;c.fillStyle='#657e73';c.fillRect(0,0,160,120);c.fillStyle='#f2ecda';c.fillRect(30,25,100,70);return canvas.toDataURL('image/png').split(',')[1];})});
  const illustrated=(await call(request,'reader_note_create',{title:'图像整理验收',body:'',imageIds:[image.id],folderId:null,tags:['保留'],sourceIds:[]})).value;
  const blank=(await call(request,'reader_note_create',{title:'空白整理验收',body:'\n  \n',imageIds:[],folderId:null,tags:[],sourceIds:[]})).value;
  await page.reload();await expect(page.locator('.study-continue,.study-library-notes,.study-book-group,.study-format-filter')).toHaveCount(0);
  const picture=page.locator(`[data-note-id="${illustrated.id}"]`);await picture.scrollIntoViewIfNeeded();await expect(picture.locator('img')).toBeVisible();
  await expect(page.locator(`[data-note-id="${blank.id}"] .library-page-preview`)).toHaveCount(0);
  await page.getByRole('button',{name:'打开笔记本 空白整理验收',exact:true}).click();await expect(page.getByLabel('笔记正文')).toHaveValue(blank.body);
  await expect.poll(async()=>(await call(request,'reader_workspace')).visits['note:'+blank.id]).toBeTruthy();
  await page.getByRole('button',{name:'返回笔记列表',exact:true}).click();await expect(page.getByRole('heading',{name:'书库',exact:true})).toBeVisible();
  await expect(page.locator('.library-entry').first()).toHaveAttribute('data-note-id',blank.id);
  expect(await call(request,'reader_note_get',{id:blank.id})).toEqual(blank);
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('menuitem',{name:'文件夹',exact:true}).click();
  await page.getByLabel('名称',{exact:true}).fill('整理验收课程');await page.getByRole('dialog',{name:'新建文件夹'}).getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByRole('button',{name:'打开文件夹 整理验收课程',exact:true})).toBeVisible();
  const folder=(await call(request,'reader_workspace')).folders.find((item:any)=>item.name==='整理验收课程');
  const before=(await call(request,'reader_workspace')).visits;
  await page.getByRole('button',{name:'选择',exact:true}).click();await page.getByRole('button',{name:'选择书籍 '+title,exact:true}).click();await page.getByRole('button',{name:'选择笔记本 图像整理验收',exact:true}).click();
  await page.getByRole('button',{name:'移动',exact:true}).click();const move=page.getByRole('dialog',{name:'移动到',exact:true});await expect(move.getByRole('button',{name:'移动',exact:true})).toBeDisabled();
  await move.getByLabel('目标文件夹').selectOption({label:'整理验收课程'});await move.getByRole('button',{name:'移动',exact:true}).click();await expect(move).toHaveCount(0);
  await expect(page.locator(`[data-book-id="${book.id}"]`)).toHaveCount(0);await expect(picture).toHaveCount(0);
  const after=await call(request,'reader_workspace');expect(after.books[book.id].folderId).toBe(folder.id);expect(after.notes.find((item:any)=>item.id===illustrated.id).folderId).toBe(folder.id);expect(after.visits).toEqual(before);
  await page.getByRole('button',{name:'打开文件夹 整理验收课程',exact:true}).click();await expect(page.getByRole('heading',{name:'整理验收课程',exact:true})).toBeVisible();await expect(page.locator('.library-entry')).toHaveCount(2);
  await page.getByRole('button',{name:new RegExp('^打开 '+title+'，')}).click();await expect(page.getByRole('heading',{name:'第一章 晨间',exact:true})).toBeVisible();await page.getByRole('button',{name:'返回书架',exact:true}).click();await expect(page.getByRole('heading',{name:'整理验收课程',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('menuitem',{name:'笔记本',exact:true}).click();await page.getByLabel('笔记标题').fill('课堂整理验收');await page.getByLabel('笔记正文').fill('保留一行自己的理解。');await expect(page.locator('.study-note-status')).toContainText('已保存到 Reader');await page.getByRole('button',{name:'返回笔记列表',exact:true}).click();
  await expect(page.getByRole('heading',{name:'整理验收课程',exact:true})).toBeVisible();const created=(await call(request,'reader_workspace')).notes.find((item:any)=>item.title==='课堂整理验收');expect(created.folderId).toBe(folder.id);
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByRole('menuitem',{name:'文件夹',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('课后资料');await page.getByRole('dialog',{name:'新建文件夹'}).getByRole('button',{name:'完成',exact:true}).click();
  await expect(page.getByRole('button',{name:'打开文件夹 课后资料',exact:true})).toBeVisible();
  for(const width of [1280,744,390,320]){
    await page.setViewportSize({width,height:932});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole('button',{name:'新建',exact:true})).toBeInViewport();await expect(picture.locator('img')).toBeVisible();
    await page.screenshot({path:`artifacts/organized-library-${width}.png`,animations:'disabled'});
  }
  await page.getByRole('button',{name:'管理 课后资料',exact:true}).click();await page.getByRole('menuitem',{name:'重命名',exact:true}).click();await page.getByLabel('名称',{exact:true}).fill('课后笔记');await page.getByRole('dialog',{name:'重命名'}).getByRole('button',{name:'完成',exact:true}).click();await expect(page.getByRole('button',{name:'打开文件夹 课后笔记',exact:true})).toBeVisible();
  const visited=(await call(request,'reader_workspace')).visits;
  const restart=await (await request.post('http://127.0.0.1:4179/restart')).json();expect(restart.previous).not.toBe(restart.current);await page.reload();
  expect((await call(request,'reader_workspace')).visits).toEqual(visited);
  await page.getByRole('button',{name:'打开文件夹 整理验收课程',exact:true}).click();await expect(page.locator('.library-entry')).toHaveCount(4);await expect(page.getByRole('button',{name:'打开文件夹 课后笔记',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'视图选项',exact:true}).click();await page.getByRole('menuitemradio',{name:'列表视图',exact:true}).click();await expect(page.locator('.library-grid.list')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});
