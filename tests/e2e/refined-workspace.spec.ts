import { test,expect,type APIRequestContext } from '@playwright/test';

// Existing persistence/selection scenarios exercise the source editing mode.
test.beforeEach(async({request})=>{await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name:'reader_preferences',arguments:{patch:{noteMode:'source'}}}});});
import { openDiscovery ,openNotes} from './navigation';

async function rpc(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  expect(response.ok(),await response.text()).toBe(true);const result=await response.json();expect(result.isError).not.toBe(true);return result._meta.reader;
}
for(const width of [1280,390,320])test(`minimal workspace, model choice and preserved metadata at ${width}`,async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:900});
  let sent:any;
  await page.route('**/api/tool',async route=>{
    const call=route.request().postDataJSON();
    if(call.name==='reader_chat_models')return route.fulfill({json:{content:[],_meta:{reader:{defaultModel:'model-a',models:[{id:'model-a',name:'Model A',supportedReasoningEfforts:[]},{id:'model-b',name:'Model B',supportedReasoningEfforts:[]}]}}}});
    if(call.name==='reader_chat_send'){
      sent=call.arguments;const session=await rpc(request,'reader_chat_get',{id:sent.id});
      return route.fulfill({json:{content:[],_meta:{reader:{...session,draft:'',status:'idle',revision:session.revision+1,messages:[{id:'user',role:'user',text:sent.text,sourceIds:[],createdAt:new Date().toISOString()},{id:'reply',role:'assistant',text:'界面测试回复。',sourceIds:[],createdAt:new Date().toISOString()}]}}}});
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:/文件夹/})).toHaveCount(0);
  await expect(page.getByText('留下一点阅读的想法',{exact:true})).toHaveCount(0);
  await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:`精简界面-${width}.txt`,mimeType:'text/plain',buffer:Buffer.from(`第一章 界面\n\n这是用于精简界面与模型切换检查的原创文本。${width}\n\n阅读内容保持不变。`)});
  await page.getByRole('button',{name:'打开阅读对话',exact:true}).click();
  const chat=page.getByRole('dialog',{name:'阅读对话',exact:true}),input=page.getByLabel('阅读问题',{exact:true}),picker=page.getByRole('button',{name:'选择模型',exact:true});
  await expect(chat).toBeVisible();await expect(chat.getByRole('checkbox')).toHaveCount(0);
  for(const text of ['允许读取本书','选中原文，或直接输入问题','从一个问题开始','当前话题 · 新话题'])await expect(chat.getByText(text,{exact:true})).toHaveCount(0);
  await expect(input).toHaveCSS('resize','none');await input.focus();await expect(input).toHaveCSS('outline-style','none');
  await picker.click();await expect(page.getByRole('menu',{name:'模型'})).toBeInViewport();await page.getByRole('menuitemradio',{name:'Model B',exact:true}).click();
  await expect(picker).toContainText('Model B');
  await input.fill('保留这条草稿');await page.getByRole('button',{name:'收起对话',exact:true}).click();await page.getByRole('button',{name:'继续阅读对话',exact:true}).click();await expect(input).toHaveValue('保留这条草稿');await expect(picker).toContainText('Model B');
  await picker.click();await page.getByRole('menuitemradio',{name:/默认模型/}).click();await expect(picker).toContainText('默认模型');
  await picker.click();await page.getByRole('menuitemradio',{name:'Model B',exact:true}).click();await picker.click();
  const menu=await page.getByRole('menu',{name:'模型'}).boundingBox();expect(menu!.x).toBeGreaterThanOrEqual(0);expect(menu!.x+menu!.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:`artifacts/refined-model-picker-${width}.png`,animations:'disabled'});
  await page.keyboard.press('Escape');await expect(picker).toBeFocused();await expect(picker).toHaveCSS('outline-style','none');await expect(picker).not.toHaveCSS('box-shadow','none');
  await page.getByRole('button',{name:'发送阅读问题',exact:true}).click();await expect.poll(()=>sent?.model).toBe('model-b');expect(sent.allowBook).toBeUndefined();
  const saved=await rpc(request,'reader_chat_get',{id:sent.id});expect(saved.model).toBe('model-b');expect(saved.allowBook).toBe(true);
  await expect(chat).toContainText('界面测试回复。');await chat.getByRole('button',{name:'保存回答为笔记',exact:true}).click();await expect(page.locator('.study-toast')).toContainText('已保存为笔记');await expect(chat).toBeVisible();await expect(page.locator('.reading-scroll')).toBeVisible();await input.focus();await page.keyboard.press('Escape');await expect(chat).toHaveCount(0);await page.getByRole('button',{name:'继续阅读对话',exact:true}).click();await expect(chat).toBeVisible();await page.screenshot({path:`artifacts/refined-chat-${width}.png`,animations:'disabled'});
  await page.getByRole('button',{name:'关闭对话',exact:true}).click();await page.getByRole('button',{name:'返回书架',exact:true}).click();
  const folder=(await rpc(request,'reader_folder_save',{name:`旧分类 ${width}`,parentId:null})).value;
  const note=(await rpc(request,'reader_note_create',{title:`保留笔记 ${width}`,body:'保留已有正文。',folderId:folder.id,tags:['历史标签'],sourceIds:[],imageIds:[]})).value;
  await page.reload();await openNotes(page);await page.locator('.study-notes-list').getByRole('button',{name:new RegExp(`^保留笔记 ${width}`)}).click();
  await expect(page.getByLabel('笔记正文')).toHaveValue('保留已有正文。');await expect(page.getByLabel('笔记文件夹')).toHaveCount(0);await expect(page.getByLabel('笔记标签')).toHaveCount(0);await expect(page.locator('.study-note-meta')).toHaveCount(0);await expect(page.locator('.study-notes-list').getByText(/处来源/)).toHaveCount(0);
  await page.getByLabel('笔记正文').fill('保留已有正文，并补充新的想法。');await expect(page.locator('.study-note-status')).toContainText('已保存到 Reader');
  const updated=await rpc(request,'reader_note_get',{id:note.id});expect(updated.tags).toEqual(['历史标签']);expect(updated.folderId).toBe(folder.id);
  await page.getByLabel('笔记正文').focus();await expect(page.getByLabel('笔记正文')).toHaveCSS('outline-style','none');await expect(page.getByLabel('笔记正文')).toHaveCSS('resize','none');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:`artifacts/refined-note-${width}.png`,animations:'disabled'});
  await page.getByRole('button',{name:'主导航',exact:true}).click();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'书库',exact:true}).click();await page.getByRole('button',{name:'新建',exact:true}).click();await expect(page.getByRole('menuitem',{name:'文件夹',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  if(width===1280){await openDiscovery(page);await expect(page.locator('.search-hint')).toHaveCount(0);await expect(page.getByText('输入书名或关键词，从已启用的书源查找。',{exact:true})).toHaveCount(0);}
  expect(errors).toEqual([]);
});
