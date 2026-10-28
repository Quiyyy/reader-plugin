import { test,expect,type APIRequestContext } from '@playwright/test';
import { defaultAppearance } from '../../src/shared/workspace';

async function call(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  expect(response.ok(),await response.text()).toBe(true);
  const result=await response.json();expect(result.isError).not.toBe(true);return result._meta.reader;
}

test('compact library prioritizes reading and shares note rows with image and empty previews',async({page,request})=>{
  test.setTimeout(60000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await call(request,'reader_appearance',{appearance:{...defaultAppearance,mode:'light'}});
  await call(request,'reader_library_layout',{layout:'cards'});
  await page.goto('/');
  const add=page.getByRole('button',{name:'添加书籍',exact:true});await add.click();
  const dialog=page.getByRole('dialog',{name:'添加书籍',exact:true});
  await expect(dialog.getByRole('button',{name:'在线找书',exact:true})).toBeVisible();
  await expect(dialog.getByText('TXT · EPUB · PDF',{exact:true})).toHaveCount(0);
  const chooser=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'导入文件',exact:true}).click();
  const title='安静的书页与一个很长很长的原创书名';
  await (await chooser).setFiles({name:title+'.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 晨间\n\n从一页开始。\n\n第二章 午后\n\n读到这里，留下自己的理解。')});
  await expect(page.getByRole('heading',{name:'第一章 晨间',exact:true})).toBeVisible();
  await expect(page.locator('.chapter-kicker')).toHaveCount(0);
  await page.getByRole('button',{name:'目录（T）',exact:true}).click();await page.getByRole('button',{name:/02 第二章 午后/}).click();
  await page.getByRole('button',{name:'返回书架',exact:true}).click();
  await expect(page.getByRole('heading',{name:'书库',exact:true})).toBeVisible();
  const image=await call(request,'reader_image_put',{data:await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d')!;c.fillStyle='#657e73';c.fillRect(0,0,160,120);c.fillStyle='#f2ecda';c.fillRect(30,25,100,70);return canvas.toDataURL('image/png').split(',')[1];})});
  for(const note of [{title:'空白摘记',body:'\n   \n',imageIds:[]},{title:'图像摘记',body:'',imageIds:[image.id]},{title:'一行摘要',body:'第一行想法。\n\n第二行继续说明，长摘要应当只显示一行，而且不会挤出更新时间。',imageIds:[]}])await call(request,'reader_note_create',{...note,folderId:null,tags:[],sourceIds:[]});
  await page.reload();
  const notes=page.getByRole('complementary',{name:'最近的笔记'}),resume=page.getByRole('region',{name:'最近阅读'});
  await expect(resume.getByText('第 2 章',{exact:true})).toBeVisible();
  await expect(notes.getByRole('button',{name:'图像摘记',exact:true}).locator('img')).toBeVisible();
  await expect(notes.getByRole('button',{name:'空白摘记',exact:true}).locator('p')).toHaveCount(0);
  await expect(notes.getByRole('button',{name:'图像摘记',exact:true}).locator('p')).toHaveCount(0);
  await expect(page.locator('.study-format-filter,.study-library-title > span,.study-book-info small,.study-cover small')).toHaveCount(0);
  await expect(page.locator('.study-page-head').getByRole('button')).toHaveCount(1);
  await expect(add).toHaveClass(/secondary-button/);await expect(resume.getByRole('button',{name:'继续阅读',exact:true})).toHaveClass(/primary-button/);
  for(const width of [1280,744,390,320]){
    await page.setViewportSize({width,height:932});
    const box=(await resume.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(96);expect(box.height).toBeLessThanOrEqual(112);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const row=notes.getByRole('button',{name:'空白摘记',exact:true});expect((await row.boundingBox())!.height).toBeLessThanOrEqual(76);
    const summary=notes.getByRole('button',{name:/^一行摘要 /}).locator('p');await expect(summary).toHaveCSS('white-space','nowrap');
    await expect(notes.getByRole('button',{name:/^一行摘要 /}).locator('time')).toBeVisible();
    await expect(page.getByRole('button',{name:new RegExp('^打开 '+title+'，')})).toBeVisible();
    await page.screenshot({path:`artifacts/minimal-library-${width}.png`,fullPage:true,animations:'disabled'});
  }
  await notes.getByRole('button',{name:'图像摘记',exact:true}).click();
  await expect(page.locator('.note-image-stage img')).toBeVisible();
  await expect(page.locator('.study-note-status')).not.toContainText(/\d+ 字/);
  await page.getByRole('button',{name:'返回笔记列表',exact:true}).click();
  await expect(page.locator('.study-notes-list').getByRole('button',{name:'图像摘记',exact:true}).locator('img')).toBeVisible();
  await expect(page.locator('.study-notes-list').getByRole('button',{name:'空白摘记',exact:true}).locator('p')).toHaveCount(0);
  await page.screenshot({path:'artifacts/minimal-notes-320.png',animations:'disabled'});
  expect(errors).toEqual([]);
});
