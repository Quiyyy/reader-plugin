import { openNotes ,openSettings,closeSettings} from './navigation';
import { expect,test,type APIRequestContext,type Page } from '@playwright/test';

test.beforeEach(async({request})=>{await rpc(request,'reader_preferences',{patch:{noteMode:'visual',noteToolbar:false}});});

async function rpc(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}}),value=await response.json();
  expect(value.isError,JSON.stringify(value)).not.toBe(true);return value._meta.reader;
}
async function open(page:Page,request:APIRequestContext,title:string,body:string) {
  const note=(await rpc(request,'reader_note_create',{title,body,folderId:null,tags:[],sourceIds:[],imageIds:[]})).value;
  await page.goto('/');await openNotes(page);await page.locator('.study-notes-list').getByRole('button',{name:new RegExp('^'+title)}).click();
  await expect(page.locator('.note-rich-content')).toBeVisible();return note;
}
async function select(page:Page,text:string) {
  await page.locator('.note-rich-content p').filter({hasText:text}).first().evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await expect(page.getByRole('toolbar',{name:'笔记选区操作'})).toBeVisible();
}
test('visual and source modes share Markdown, render editable structure and keep formatting controls hidden by default',async({page,request})=>{
  const markdown='# 主题\n\n这里有 **重点** 和 *强调*。\n\n- [ ] 待办\n\n| 名称 | 内容 |\n| --- | --- |\n| A | B |\n\n```js\nconst value = 1;\n```\n\n<script>alert(1)</script>';
  const note=await open(page,request,'双模式笔记',markdown),editor=page.locator('.note-rich-content');
  await expect(editor.locator('strong')).toHaveText('重点');await expect(editor.locator('table')).toBeVisible();await expect(editor.locator('pre code')).toContainText('const value');await expect(editor.locator('script')).toHaveCount(0);await expect(editor).toContainText('<script>alert(1)</script>');
  await expect(page.getByRole('toolbar',{name:'笔记格式'})).toHaveCount(0);
  if(await page.getByRole('button',{name:'切换到源码',exact:true}).count())await page.getByRole('button',{name:'切换到源码',exact:true}).click();await expect(page.getByLabel('笔记正文')).toHaveValue(markdown);expect((await rpc(request,'reader_note_get',{id:note.id})).body).toBe(markdown);
  if(await page.getByRole('button',{name:'返回排版编辑',exact:true}).count())await page.getByRole('button',{name:'返回排版编辑',exact:true}).click();await editor.getByRole('checkbox').check();await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toContain('[x]');
  await openSettings(page,'笔记');await page.getByRole('switch',{name:'显示格式工具栏'}).click();await closeSettings(page);await expect(page.getByRole('toolbar',{name:'笔记格式'})).toBeVisible();
  if(await page.getByRole('button',{name:'切换到源码',exact:true}).count())await page.getByRole('button',{name:'切换到源码',exact:true}).click();await expect(page.getByLabel('笔记正文')).toHaveValue(/<script>alert\(1\)<\/script>/);
  await page.getByLabel('笔记正文').fill('## 源码标题');await page.getByLabel('笔记正文').press('ControlOrMeta+A');await page.getByRole('toolbar',{name:'笔记选区操作'}).getByLabel('段落样式').selectOption('paragraph');await expect(page.getByLabel('笔记正文')).toHaveValue('源码标题');
});
test('custom Note Bots persist and @ assignment works in both editor modes without auto-sending',async({page,request})=>{
  await open(page,request,'指派助手','');await page.getByRole('button',{name:'笔记操作',exact:true}).click();await page.getByRole('button',{name:'管理 Note Bots',exact:true}).click();
  const manager=page.getByRole('region',{name:'Note Bot 配置',exact:true});await manager.getByRole('button',{name:'新建 Bot',exact:true}).click();await manager.getByLabel('Bot 名称').fill('学习搭档');await manager.getByLabel('Bot 用途').fill('把概念讲明白');await manager.getByLabel('Bot 指令').fill('用例子解释概念，不编造依据。');await manager.getByLabel('默认 Bot').check();await manager.getByRole('button',{name:'保存 Bot',exact:true}).click();
  await expect.poll(async()=>(await rpc(request,'reader_note_bots')).bots.some((bot:any)=>bot.name==='学习搭档')).toBe(true);await closeSettings(page);
  for(const mode of ['visual','source']){
    const toggle=page.getByRole('button',{name:mode==='visual'?'返回排版编辑':'切换到源码',exact:true});if(await toggle.count())await toggle.click();const editor=page.getByLabel('笔记正文');await editor.fill('');await editor.pressSequentially('@');const chooser=page.getByRole('listbox',{name:'选择 Note Bot'});await expect(chooser).toBeVisible();await chooser.getByRole('option',{name:/学习搭档/}).click();
    const panel=page.getByRole('region',{name:'笔记对话',exact:true});await expect(panel).toBeVisible();const config=await rpc(request,'reader_note_bots');await expect(panel.getByLabel('指派 Note Bot')).toHaveValue(config.defaultId);await expect(panel.getByRole('button',{name:'发送',exact:true})).toBeDisabled();await page.getByLabel('笔记正文').click();
  }
});
test('Note Bot tasks write to the note directly with a concise conversation and undo',async({page,request})=>{
  const original='需要改善的表达。\n\n保留下一段。',note=await open(page,request,'直接编辑任务',original);await select(page,'需要改善');await page.getByRole('button',{name:'提出修改要求',exact:true}).click();const panel=page.getByRole('region',{name:'笔记对话',exact:true});
  await page.route('**/api/tool',async route=>{const call=route.request().postDataJSON();if(call.name!=='reader_chat_send')return route.continue();const session=await rpc(request,'reader_chat_get',{id:call.arguments.id});expect(call.arguments.writeNote).toBe(true);expect(call.arguments.noteRevision).toBe(note.revision);expect(call.arguments.text).toContain('需要改善的表达。');const changed=await rpc(request,'reader_note_update',{id:note.id,revision:call.arguments.noteRevision,patch:{body:'更清楚的表达。\n\n保留下一段。'}});await route.fulfill({json:{content:[],_meta:{reader:{...session,noteTask:true,status:'idle',messages:[{id:'user',role:'user',text:call.arguments.text,sourceIds:[],createdAt:new Date().toISOString()},{id:'written',role:'tool',text:'已更新笔记',undoId:changed.undoId,sourceIds:[],createdAt:new Date().toISOString()},{id:'reply',role:'assistant',text:'已调整表达。',sourceIds:[],createdAt:new Date().toISOString()}]}}}});});
  await panel.getByLabel('给 Note Bot 的要求').fill('请改善表达。');await panel.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.note-rich-content')).toContainText('更清楚');await expect(page.locator('.note-rich-content')).toContainText('保留下一段');await expect(panel.getByRole('log')).toHaveCount(0);await panel.getByRole('button',{name:'展开对话',exact:true}).click();await expect(panel.getByRole('log')).toContainText('已调整表达');await expect(panel.getByRole('button',{name:'应用修改'})).toHaveCount(0);await panel.getByRole('button',{name:'撤销最近修改'}).click();await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toBe(original);
});

test('a task failure preserves edits made while the reply is pending',async({page,request})=>{
  await page.setViewportSize({width:390,height:850});const note=await open(page,request,'并发任务','选中这段内容。');await select(page,'选中这段');await page.getByRole('button',{name:'提出修改要求',exact:true}).click();const panel=page.getByRole('region',{name:'笔记对话',exact:true});
  let release!:()=>void,started=false;const held=new Promise<void>(resolve=>release=resolve);await page.route('**/api/tool',async route=>{const call=route.request().postDataJSON();if(call.name!=='reader_chat_send')return route.continue();started=true;await held;await route.fulfill({json:{content:[{type:'text',text:'笔记已有新修改，请重新指派任务'}],isError:true}});});
  await panel.getByLabel('给 Note Bot 的要求').fill('请改善表达。');await panel.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>started).toBe(true);try{await page.locator('.note-rich-content').fill('用户刚写的新内容');await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toBe('用户刚写的新内容');}finally{release();}await panel.getByRole('button',{name:'查看对话提示'}).click();await expect(panel.getByRole('alert')).toContainText('已有新修改');await panel.getByRole('button',{name:'查看对话提示'}).click();await expect(page.locator('.note-rich-content')).toHaveText('用户刚写的新内容');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'artifacts/quick-notes-ai-390.png'});
});

test('Space-style document selection supports formatting, durable comments and a permanent composer',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});
  const note=await open(page,request,'从想法到结构','先确认目标，再拆分模块与职责。\n\n一个阅读应用可以分为内容解析、笔记存储和交互界面三层，各层通过清晰的接口协作。\n\n用一次小范围验证，确定下一步需要完善的内容。');
  const dock=page.getByRole('region',{name:'笔记对话'});await expect(dock).toBeInViewport();await expect(dock.getByLabel('给 Note Bot 的要求')).toBeVisible();
  await select(page,'一个阅读应用');const toolbar=page.getByRole('toolbar',{name:'笔记选区操作'});await expect(toolbar.getByRole('button',{name:'提出修改要求'})).toBeVisible();await expect(toolbar.getByLabel('段落样式')).toBeVisible();
  await page.screenshot({path:'artifacts/quick-notes-space-selection-1440.png'});
  await toolbar.getByRole('button',{name:'下划线',exact:true}).click();await expect(page.locator('.note-rich-content u')).toContainText('一个阅读应用');if(await page.getByRole('button',{name:'切换到源码',exact:true}).count())await page.getByRole('button',{name:'切换到源码',exact:true}).click();await expect(page.getByLabel('笔记正文')).toHaveValue(/<u>一个阅读应用/);if(await page.getByRole('button',{name:'返回排版编辑',exact:true}).count())await page.getByRole('button',{name:'返回排版编辑',exact:true}).click();await expect(page.locator('.note-rich-content u')).toContainText('一个阅读应用');
  await select(page,'一个阅读应用');await toolbar.getByRole('button',{name:'评论',exact:true}).click();const comments=page.getByRole('dialog',{name:'笔记评论'});await comments.getByLabel('评论内容').fill('补充各层之间的输入和输出。');await comments.getByRole('button',{name:'添加评论',exact:true}).click();await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).comments?.[0]?.text).toBe('补充各层之间的输入和输出。');
  await comments.getByRole('button',{name:'关闭评论'}).click();await dock.getByLabel('给 Note Bot 的要求').fill('下一步帮我整理接口约定');await expect.poll(async()=>(await rpc(request,'reader_chat_list',{noteId:note.id,allNoteSessions:true}))[0]?.draft).toBe('下一步帮我整理接口约定');
  await page.reload();await openNotes(page);await page.locator('.study-notes-list').getByRole('button',{name:/^从想法到结构/}).click();await expect(dock.getByLabel('给 Note Bot 的要求')).toHaveValue('下一步帮我整理接口约定');await page.getByRole('button',{name:'评论',exact:true}).click();await expect(page.getByRole('dialog',{name:'笔记评论'})).toContainText('补充各层之间');
});

test('document block handles reorder paragraphs and keep the chat composer outside the scroll area',async({page,request})=>{
  const note=await open(page,request,'段落整理','第一段先写的想法。\n\n第二段需要先解释的背景。\n\n第三段保留的结论。');
  const editor=page.locator('.note-rich-content'),first=editor.locator('p').first(),last=editor.locator('p').last();await first.hover();const handle=page.locator('.note-block-handle');await expect(handle).toBeVisible();
  await handle.dragTo(last,{targetPosition:{x:30,y:20}});await expect(editor.locator('p').first()).toContainText('第二段');
  await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toMatch(/^第二段/);await expect(page.getByRole('region',{name:'笔记对话'})).toBeInViewport();
});

test('compact block handle opens useful actions without changing a note until an action is chosen',async({page,request})=>{
  const original='第一段想法。\n\n第二段结论。',note=await open(page,request,'块菜单',original),editor=page.locator('.note-rich-content'),handle=page.getByRole('button',{name:'块操作',exact:true});
  await editor.locator('p').first().hover();await expect(handle.locator('svg')).toHaveAttribute('width','14');await handle.click();const menu=page.getByRole('menu',{name:'块操作',exact:true});await expect(menu).toBeVisible();await expect(menu.getByRole('menuitem',{name:'上移',exact:true})).toBeDisabled();expect((await rpc(request,'reader_note_get',{id:note.id})).body).toBe(original);
  await menu.getByRole('menuitem',{name:'下移',exact:true}).click();await expect(editor.locator('p').first()).toHaveText('第二段结论。');await editor.press('ControlOrMeta+z');await expect(editor.locator('p').first()).toHaveText('第一段想法。');
  await editor.locator('p').first().hover();await handle.click();await menu.getByRole('menuitem',{name:'创建副本'}).click();await expect(editor.locator('p')).toHaveCount(3);await editor.locator('p').first().hover();await handle.click();await menu.getByRole('menuitem',{name:'删除块'}).click();await expect(editor.locator('p')).toHaveCount(2);
  await editor.locator('p').first().hover();await handle.click();await menu.press('Escape');await expect(menu).toHaveCount(0);await handle.click();await menu.getByRole('menuitem',{name:'提出修改要求'}).click();await expect(page.getByLabel('给 Note Bot 的要求')).toBeFocused();await expect(page.getByRole('region',{name:'笔记对话'})).toContainText('第一段想法');
});

for(const width of [1280,390])test(`note typography, aligned status and anchored outside-dismiss menu at ${width}`,async({page,request})=>{
  const state=await rpc(request,'reader_workspace');await rpc(request,'reader_appearance',{appearance:{...state.appearance,noteFontSize:14}});await page.setViewportSize({width,height:850});const note=await open(page,request,'字号与对话操作 '+width,'统一字号的正文。');
  const dock=page.getByRole('region',{name:'笔记对话'});await expect(page.locator('.note-rich-content')).toHaveCSS('font-size','14px');await page.getByRole('button',{name:'切换到源码',exact:true}).click();await expect(page.getByLabel('笔记正文')).toHaveCSS('font-size','14px');
  await openSettings(page,'笔记');await page.getByLabel('笔记默认字号').selectOption('18');await expect.poll(async()=>(await rpc(request,'reader_workspace')).appearance.noteFontSize).toBe(18);await closeSettings(page);await expect(page.getByLabel('笔记正文')).toHaveCSS('font-size','18px');await page.getByRole('button',{name:'返回排版编辑',exact:true}).click();await expect(page.locator('.note-rich-content')).toHaveCSS('font-size','18px');
  await page.route('**/api/tool',async route=>{const call=route.request().postDataJSON();if(call.name!=='reader_chat_send')return route.continue();const session=await rpc(request,'reader_chat_get',{id:call.arguments.id});await route.fulfill({json:{content:[],_meta:{reader:{...session,noteTask:true,status:'idle',messages:[{id:'user',role:'user',text:call.arguments.text,sourceIds:[],createdAt:new Date().toISOString()},{id:'question',role:'assistant',text:'希望侧重概念理解还是实践？',sourceIds:[],createdAt:new Date().toISOString()}]}}}});});
  await dock.getByLabel('给 Note Bot 的要求').fill('完善这篇笔记');await dock.getByRole('button',{name:'发送',exact:true}).click();await expect(dock.getByRole('log')).toContainText('希望侧重');const status=await page.locator('.study-note-status').boundingBox(),toggle=await dock.getByRole('button',{name:'收起对话'}).boundingBox();expect(Math.abs(status!.y+status!.height/2-toggle!.y-toggle!.height/2)).toBeLessThan(1);
  const plus=dock.getByRole('button',{name:'对话附件与操作'});await plus.click();const menu=page.getByRole('menu',{name:'对话操作'});await expect(menu).toBeInViewport();const menuBox=await menu.boundingBox(),plusBox=await plus.boundingBox();expect(Math.abs(menuBox!.y+menuBox!.height-plusBox!.y)).toBeLessThanOrEqual(8);const title=await page.getByLabel('笔记标题').boundingBox();await page.mouse.click(title!.x+20,title!.y+10);await expect(menu).toHaveCount(0);await page.screenshot({path:`artifacts/note-task-composer-${width}.png`});
  expect((await rpc(request,'reader_note_get',{id:note.id})).body).toBe('统一字号的正文。');await rpc(request,'reader_appearance',{appearance:state.appearance});
});
