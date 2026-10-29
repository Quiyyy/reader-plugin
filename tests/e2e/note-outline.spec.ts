import { test,expect,type APIRequestContext } from '@playwright/test';

async function rpc(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  expect(response.ok(),await response.text()).toBe(true);const result=await response.json();expect(result.isError).not.toBe(true);return result._meta.reader;
}
const paragraphs=Array.from({length:32},(_,i)=>`第 ${i+1} 段。网络协议通过明确的接口与层次组织信息，长行在窄窗口中应正确换行。`).join('\n\n');
const content='# 概述\n\n'+paragraphs+'\n\n## 重复标题\n\n'+paragraphs+'\n\n### 深入机制\n\n```md\n## 代码示例不属于目录\n```\n\n## 重复标题\n\n'+paragraphs;

for(const width of [1280,390,320])test(`note outline is closed by default and navigates only the current note at ${width}`,async({page,request})=>{
  test.setTimeout(45000);await page.setViewportSize({width,height:1000});
  await page.addInitScript(()=>localStorage.setItem('reader-notes-list-collapsed','false'));
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const note=(await rpc(request,'reader_note_create',{title:`目录验收 ${width}`,body:content,folderId:null,tags:[],sourceIds:[],imageIds:[]})).value;
  await rpc(request,'reader_note_create',{title:`其他笔记 ${width}`,body:'# 不应该出现在当前目录',folderId:null,tags:[],sourceIds:[],imageIds:[]});
  await page.goto('/');await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('.study-notes-list').getByRole('button',{name:new RegExp(`^目录验收 ${width}`)}).click();
  const toggle=page.getByRole('button',{name:'目录（T）',exact:true}),panel=page.getByRole('dialog',{name:'笔记目录',exact:true}),editor=page.getByLabel('笔记正文'),scroller=page.locator('.study-editor-body');
  await expect(panel).toHaveCount(0);await expect(page.locator('.study-notes-list')).toHaveCount(0);await expect(page.getByRole('button',{name:/折叠笔记|展开笔记/})).toHaveCount(0);
  await toggle.click();await expect(panel).toBeVisible();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(panel.getByRole('navigation',{name:'笔记大纲'}).getByRole('button')).toHaveCount(4);
  await expect(panel).not.toContainText('其他笔记');await expect(panel).not.toContainText('代码示例不属于目录');
  await page.screenshot({path:`artifacts/note-outline-${width}.png`,animations:'disabled'});
  await panel.getByRole('button',{name:'重复标题',exact:true}).nth(1).click();await expect(panel).toHaveCount(0);await expect(editor).toBeFocused();
  expect(await editor.evaluate((el:HTMLTextAreaElement)=>el.selectionStart)).toBe(content.lastIndexOf('## 重复标题'));expect(await scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(500);
  await page.screenshot({path:`artifacts/note-outline-edit-jump-${width}.png`,animations:'disabled'});
  const insertion=content.lastIndexOf('## 重复标题');
  await editor.press('t');await expect(panel).toHaveCount(0);await expect(editor).toHaveValue(content.slice(0,insertion)+'t'+content.slice(insertion));
  await toggle.focus();await page.keyboard.press('t');await expect(panel).toBeVisible();await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(toggle).toBeFocused();
  await page.getByRole('button',{name:'预览笔记',exact:true}).click();await toggle.click();await panel.getByRole('button',{name:'深入机制',exact:true}).click();
  await expect(page.getByRole('heading',{name:'深入机制',exact:true})).toBeInViewport();await expect(panel).toHaveCount(0);
  await page.screenshot({path:`artifacts/note-outline-preview-jump-${width}.png`,animations:'disabled'});
  await page.getByRole('button',{name:'编辑笔记',exact:true}).click();await editor.fill('## 新标题\n\n'+paragraphs);await toggle.click();await expect(panel.getByRole('button',{name:'新标题',exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'重复标题',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'关闭目录',exact:true}).click();
  await expect(page.locator('.study-note-status')).toContainText('已保存到 Reader');await page.reload();await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('.study-notes-list').getByRole('button',{name:new RegExp(`^目录验收 ${width}`)}).click();await expect(panel).toHaveCount(0);
  const saved=await rpc(request,'reader_note_get',{id:note.id});expect(saved.body).toBe('## 新标题\n\n'+paragraphs);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
});
