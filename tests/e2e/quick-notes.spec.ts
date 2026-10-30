import { expect,test,type APIRequestContext,type Page } from '@playwright/test';

async function rpc(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}}),value=await response.json();
  expect(value.isError,JSON.stringify(value)).not.toBe(true);return value._meta.reader;
}
async function open(page:Page,request:APIRequestContext,title:string,body:string) {
  const note=(await rpc(request,'reader_note_create',{title,body,folderId:null,tags:[],sourceIds:[],imageIds:[]})).value;
  await page.goto('/');await page.getByRole('button',{name:'快速笔记',exact:true}).click();await page.locator('.study-notes-list').getByRole('button',{name:new RegExp('^'+title)}).click();
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
  await page.getByRole('button',{name:'笔记操作',exact:true}).click();await page.getByLabel('显示格式工具栏').check();await page.getByRole('dialog',{name:'笔记操作'}).getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('toolbar',{name:'笔记格式'})).toBeVisible();
  if(await page.getByRole('button',{name:'切换到源码',exact:true}).count())await page.getByRole('button',{name:'切换到源码',exact:true}).click();await expect(page.getByLabel('笔记正文')).toHaveValue(/<script>alert\(1\)<\/script>/);
  await page.getByLabel('笔记正文').fill('## 源码标题');await page.getByLabel('笔记正文').press('ControlOrMeta+A');await page.getByRole('toolbar',{name:'笔记选区操作'}).getByLabel('段落样式').selectOption('paragraph');await expect(page.getByLabel('笔记正文')).toHaveValue('源码标题');
});
test('custom Note Bots persist and @ assignment works in both editor modes without auto-sending',async({page,request})=>{
  await open(page,request,'指派助手','');await page.getByRole('button',{name:'笔记操作',exact:true}).click();await page.getByRole('button',{name:'管理 Note Bots',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'Note Bots',exact:true});await manager.getByRole('button',{name:'新建 Bot',exact:true}).click();await manager.getByLabel('Bot 名称').fill('学习搭档');await manager.getByLabel('Bot 用途').fill('把概念讲明白');await manager.getByLabel('Bot 指令').fill('用例子解释概念，不编造依据。');await manager.getByLabel('默认 Bot').check();await manager.getByRole('button',{name:'保存 Bot',exact:true}).click();
  await expect.poll(async()=>(await rpc(request,'reader_note_bots')).bots.some((bot:any)=>bot.name==='学习搭档')).toBe(true);await manager.getByRole('button',{name:'关闭',exact:true}).click();
  for(const mode of ['visual','source']){
    const toggle=page.getByRole('button',{name:mode==='visual'?'返回排版编辑':'切换到源码',exact:true});if(await toggle.count())await toggle.click();const editor=page.getByLabel('笔记正文');await editor.fill('');await editor.pressSequentially('@');const chooser=page.getByRole('listbox',{name:'选择 Note Bot'});await expect(chooser).toBeVisible();await chooser.getByRole('option',{name:/学习搭档/}).click();
    const panel=page.getByRole('region',{name:'笔记对话',exact:true});await expect(panel).toBeVisible();const config=await rpc(request,'reader_note_bots');await expect(panel.getByLabel('指派 Note Bot')).toHaveValue(config.defaultId);await expect(panel.getByRole('button',{name:'发送',exact:true})).toBeDisabled();await page.getByLabel('笔记正文').click();
  }
});
test('selected text drives a bot suggestion that applies only on request and can be undone',async({page,request})=>{
  const note=await open(page,request,'选区编辑','需要改善的表达。\n\n保留下一段。');await select(page,'需要改善');await page.getByRole('button',{name:'提出修改要求',exact:true}).click();const panel=page.getByRole('region',{name:'笔记对话',exact:true});
  await page.route('**/api/tool',async route=>{const call=route.request().postDataJSON();if(call.name!=='reader_chat_send')return route.continue();const session=await rpc(request,'reader_chat_get',{id:call.arguments.id});expect(session.proposal).toBe(true);expect(call.arguments.text).toContain('需要改善的表达。');await route.fulfill({json:{content:[],_meta:{reader:{...session,status:'idle',messages:[{id:'reply',role:'assistant',text:'更清楚的表达。',sourceIds:[],createdAt:new Date().toISOString()}]}}}});});
  await panel.getByLabel('给 Note Bot 的要求').fill('请改善表达。');await panel.getByRole('button',{name:'发送',exact:true}).click();await expect(panel.getByRole('log',{name:'笔记对话消息'})).toContainText('更清楚');expect((await rpc(request,'reader_note_get',{id:note.id})).body).toContain('需要改善');await panel.getByRole('button',{name:'应用修改'}).click();await expect(panel).toBeVisible();
  await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toContain('更清楚');await expect(page.locator('.note-rich-content')).toContainText('保留下一段');await page.getByRole('button',{name:'撤销 AI 修改'}).click();await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toBe('需要改善的表达。\n\n保留下一段。');
});
test('late AI suggestions cannot overwrite a newer draft and fit a narrow editor',async({page,request})=>{
  await page.setViewportSize({width:390,height:850});const note=await open(page,request,'并发建议','选中这段内容。');await select(page,'选中这段');await page.getByRole('button',{name:'提出修改要求',exact:true}).click();const panel=page.getByRole('region',{name:'笔记对话',exact:true});
  await page.route('**/api/tool',async route=>{const call=route.request().postDataJSON();if(call.name!=='reader_chat_send')return route.continue();const session=await rpc(request,'reader_chat_get',{id:call.arguments.id});await route.fulfill({json:{content:[],_meta:{reader:{...session,status:'idle',messages:[{id:'reply',role:'assistant',text:'核心观点：各模块通过明确的接口协作。',sourceIds:[],createdAt:new Date().toISOString()}]}}}});});
  await panel.getByLabel('给 Note Bot 的要求').fill('请改善表达。');await panel.getByRole('button',{name:'发送',exact:true}).click();await expect(panel.getByRole('log',{name:'笔记对话消息'})).toContainText('核心观点');await page.locator('.note-rich-content').fill('用户刚写的新内容');await expect(panel.getByRole('button',{name:'原文已更新，请重新生成'})).toBeDisabled();await expect(panel.locator('.note-chat-error,.note-chat-context,.note-chat-apply')).toHaveCount(0);await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toBe('用户刚写的新内容');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'artifacts/quick-notes-ai-390.png'});
});

test('Space-style document selection supports formatting, durable comments and a permanent composer',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1000});
  const note=await open(page,request,'从想法到结构','先确认目标，再拆分模块与职责。\n\n一个阅读应用可以分为内容解析、笔记存储和交互界面三层，各层通过清晰的接口协作。\n\n用一次小范围验证，确定下一步需要完善的内容。');
  const dock=page.getByRole('region',{name:'笔记对话'});await expect(dock).toBeInViewport();await expect(dock.getByLabel('给 Note Bot 的要求')).toBeVisible();
  await select(page,'一个阅读应用');const toolbar=page.getByRole('toolbar',{name:'笔记选区操作'});await expect(toolbar.getByRole('button',{name:'提出修改要求'})).toBeVisible();await expect(toolbar.getByLabel('段落样式')).toBeVisible();
  await page.screenshot({path:'artifacts/quick-notes-space-selection-1440.png'});
  await toolbar.getByRole('button',{name:'下划线',exact:true}).click();await expect(page.locator('.note-rich-content u')).toContainText('一个阅读应用');if(await page.getByRole('button',{name:'切换到源码',exact:true}).count())await page.getByRole('button',{name:'切换到源码',exact:true}).click();await expect(page.getByLabel('笔记正文')).toHaveValue(/<u>一个阅读应用/);if(await page.getByRole('button',{name:'返回排版编辑',exact:true}).count())await page.getByRole('button',{name:'返回排版编辑',exact:true}).click();await expect(page.locator('.note-rich-content u')).toContainText('一个阅读应用');
  await select(page,'一个阅读应用');await toolbar.getByRole('button',{name:'评论',exact:true}).click();const comments=page.getByRole('dialog',{name:'笔记评论'});await comments.getByLabel('评论内容').fill('补充各层之间的输入和输出。');await comments.getByRole('button',{name:'添加评论',exact:true}).click();await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).comments?.[0]?.text).toBe('补充各层之间的输入和输出。');
  await comments.getByRole('button',{name:'关闭评论'}).click();await dock.getByLabel('给 Note Bot 的要求').fill('下一步帮我整理接口约定');await expect.poll(async()=>(await rpc(request,'reader_chat_list',{noteId:note.id,proposal:true}))[0]?.draft).toBe('下一步帮我整理接口约定');
  await page.reload();await page.getByRole('button',{name:'快速笔记',exact:true}).click();await page.locator('.study-notes-list').getByRole('button',{name:/^从想法到结构/}).click();await expect(dock.getByLabel('给 Note Bot 的要求')).toHaveValue('下一步帮我整理接口约定');await page.getByRole('button',{name:'评论',exact:true}).click();await expect(page.getByRole('dialog',{name:'笔记评论'})).toContainText('补充各层之间');
});

test('document block handles reorder paragraphs and keep the chat composer outside the scroll area',async({page,request})=>{
  const note=await open(page,request,'段落整理','第一段先写的想法。\n\n第二段需要先解释的背景。\n\n第三段保留的结论。');
  const editor=page.locator('.note-rich-content'),first=editor.locator('p').first(),last=editor.locator('p').last();await first.hover();const handle=page.locator('.note-block-handle');await expect(handle).toBeVisible();
  await handle.dragTo(last,{targetPosition:{x:30,y:20}});await expect(editor.locator('p').first()).toContainText('第二段');
  await expect.poll(async()=>(await rpc(request,'reader_note_get',{id:note.id})).body).toMatch(/^第二段/);await expect(page.getByRole('region',{name:'笔记对话'})).toBeInViewport();
});
