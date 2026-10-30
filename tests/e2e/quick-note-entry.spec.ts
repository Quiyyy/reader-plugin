import {openSettings,closeSettings} from './navigation';
import { expect,test,type APIRequestContext } from '@playwright/test';

test.beforeEach(async({request})=>{await rpc(request,'reader_preferences',{patch:{noteMode:'visual',noteToolbar:false}});});

async function rpc(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}}),value=await response.json();expect(value.isError,JSON.stringify(value)).not.toBe(true);return value._meta.reader;
}

test('quick notes creates one fresh document immediately and returns to the current library folder',async({page,request})=>{
  const folder=(await rpc(request,'reader_folder_save',{name:'快速记录入口',parentId:null})).value;
  await page.goto('/');await page.getByRole('button',{name:'打开文件夹 快速记录入口',exact:true}).click();const before=(await rpc(request,'reader_workspace')).notes;
  await page.getByRole('button',{name:'快速笔记',exact:true}).evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect(page.getByLabel('笔记标题')).toHaveValue('');await expect(page.locator('.note-rich-content')).toBeFocused();await expect(page.locator('.study-notes-list')).toHaveCount(0);
  const created=(await rpc(request,'reader_workspace')).notes.filter((note:any)=>!before.some((old:any)=>old.id===note.id));expect(created).toHaveLength(1);expect(created[0].folderId).toBe(folder.id);
  await page.getByLabel('笔记正文').fill('一闪而过的想法');await expect(page.locator('.study-note-status')).toContainText('已保存到 Reader');await page.getByRole('button',{name:'返回书库',exact:true}).click();await expect(page.getByRole('heading',{name:folder.name,exact:true})).toBeVisible();expect((await rpc(request,'reader_note_get',{id:created[0].id})).body).toBe('一闪而过的想法');
});

for(const width of [1280,390,320])test(`Note Bot configuration is a full page without clipping at ${width}`,async({page,request})=>{
  await page.setViewportSize({width,height:720});await page.goto('/');await page.getByRole('button',{name:'快速笔记',exact:true}).click();await page.getByLabel('笔记正文').fill('返回后保留的笔记草稿 '+width);
  await page.getByRole('button',{name:'笔记操作',exact:true}).click();await page.getByRole('button',{name:'管理 Note Bots',exact:true}).click();const settings=page.getByRole('region',{name:'Note Bot 配置',exact:true});
  await expect(settings).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.study-route')).toHaveAttribute('aria-hidden','true');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await settings.getByRole('button',{name:'新建 Bot',exact:true}).click();await settings.getByLabel('Bot 名称').fill('整理伙伴 '+width);await settings.getByLabel('Bot 用途').fill('把零散想法整理成可以行动的记录');await settings.getByLabel('Bot 指令').fill('按主题归纳并保留用户原意。'.repeat(40));
  await settings.getByLabel('Bot 指令').scrollIntoViewIfNeeded();expect(await settings.locator('.note-bot-page-scroll').evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(1);await expect(settings.getByRole('button',{name:'保存 Bot',exact:true})).toBeInViewport();await page.screenshot({path:`artifacts/note-bot-page-${width}.png`});
  await closeSettings(page);await expect(page.getByLabel('笔记正文')).toContainText('返回后保留的笔记草稿');await page.getByRole('button',{name:'笔记操作',exact:true}).click();await page.getByRole('button',{name:'管理 Note Bots',exact:true}).click();await expect(settings.getByLabel('Bot 名称')).toHaveValue('整理伙伴 '+width);
  await settings.getByRole('button',{name:'保存 Bot',exact:true}).click();await expect.poll(async()=>(await rpc(request,'reader_note_bots')).bots.some((bot:any)=>bot.name==='整理伙伴 '+width)).toBe(true);
});

test('notebook covers use a paper motif without leaking or changing stored Markdown',async({page,request})=>{
  await rpc(request,'reader_library_layout',{layout:'cards'});
  const folder=(await rpc(request,'reader_folder_save',{name:'笔记封面样本',parentId:null})).value;
  const note=(await rpc(request,'reader_note_create',{title:'计算机网络',body:'## 截图暴露的问题\n\n**强调内容**，保留原始 Markdown。',folderId:folder.id,tags:[],sourceIds:[],imageIds:[]})).value;
  await rpc(request,'reader_note_create',{title:'空白笔记',body:'',folderId:folder.id,tags:[],sourceIds:[],imageIds:[]});
  await page.goto('/');await page.getByRole('button',{name:'打开文件夹 笔记封面样本',exact:true}).click();const cover=page.locator(`[data-note-id="${note.id}"] .library-notebook`);await expect(cover).toHaveText('');await expect(cover.locator('.library-notebook-emblem')).toBeVisible();await expect(cover.locator('.library-notebook-lines')).toBeVisible();await expect(page.locator('.library-page-preview')).toHaveCount(0);expect((await rpc(request,'reader_note_get',{id:note.id})).body).toBe(note.body);
  await page.screenshot({path:'artifacts/notebook-cover-motif.png'});
});
