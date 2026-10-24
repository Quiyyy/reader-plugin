import { test,expect,type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
async function rpc(request:APIRequestContext,name:string,args:object={}){const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});expect(response.ok(),await response.text()).toBe(true);const result=await response.json();expect(result.isError).not.toBe(true);return result._meta.reader;}

for(const width of [1280,390,320])test(`note fills the editor, collapses its list and supports screenshot collaboration at ${width}`,async({page,request})=>{
  test.setTimeout(60000);await page.setViewportSize({width,height:1320});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const note=(await rpc(request,'reader_note_create',{title:'协作笔记 '+width,body:'已有正文。',folderId:null,tags:['保留'],sourceIds:[],imageIds:[]})).value;
  await page.goto('/');await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('.study-notes-list').getByRole('button',{name:'协作笔记 '+width+' 已有正文。',exact:true}).click();
  const editor=page.getByLabel('笔记正文'),body=page.locator('.study-editor-body');await expect(editor).toBeVisible();
  const before=(await editor.boundingBox())!,footer=(await page.locator('.study-note-status').boundingBox())!;
  expect(before.height).toBeGreaterThan(700);expect(footer.y-(before.y+before.height)).toBeLessThan(50);
  await page.mouse.click(before.x+20,before.y+before.height-20);await expect(editor).toBeFocused();
  await editor.fill(Array.from({length:100},(_,i)=>`第 ${i+1} 行：原有笔记内容。`).join('\n'));
  expect(await editor.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(2);expect(await body.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await editor.fill('已有正文。');await expect(page.locator('.study-note-status')).toContainText('已保存到 Reader');
  if(width>=720){await page.getByRole('button',{name:'折叠笔记列表',exact:true}).click();await expect(page.locator('.study-notes-list')).toBeHidden();expect((await editor.boundingBox())!.width).toBeGreaterThan(before.width);await page.getByRole('button',{name:'展开笔记列表',exact:true}).click();await expect(page.locator('.study-notes-list')).toBeVisible();}
  await page.screenshot({path:`artifacts/note-full-editor-${width}.png`,animations:'disabled'});
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=480;canvas.height=260;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#f9faf7';ctx.fillRect(0,0,480,260);ctx.fillStyle='#629778';ctx.fillRect(40,70,150,110);ctx.fillStyle='#5b7eaa';ctx.fillRect(290,70,150,110);ctx.fillStyle='#222';ctx.font='22px sans-serif';ctx.fillText('A',100,40);ctx.fillText('B',350,40);return canvas.toDataURL('image/png').split(',')[1]!;});
  await editor.evaluate((element,png)=>{const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0)),clipboard=new DataTransfer();clipboard.items.add(new File([bytes],'截图.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));},png);
  await expect(page.locator('.note-image-stage img')).toBeVisible();await expect(page.locator('.study-note-status')).toContainText('已保存到 Reader');
  const initial=await rpc(request,'reader_note_get',{id:note.id}),imageId=initial.imageIds[0];expect(imageId).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole('button',{name:'请 Codex 标注截图',exact:true}).click();const chat=page.getByRole('dialog',{name:'笔记协作',exact:true});await expect(chat).toBeVisible();await expect(chat.locator('.study-chat-images img')).toHaveCount(1);
  let sent:any;
  await page.route('**/api/tool',async route=>{
    const call=route.request().postDataJSON();if(call.name!=='reader_chat_send')return route.continue();sent=call.arguments;
    const session=await rpc(request,'reader_chat_get',{id:sent.id});expect(session.noteId).toBe(note.id);expect(sent.imageIds).toEqual([imageId]);
    const current=await rpc(request,'reader_note_get',{id:note.id});const changed=await rpc(request,'reader_note_update',{id:note.id,revision:current.revision,patch:{body:current.body+'\n\n补充：A 与 B 分别表示两个节点。'}});
    await rpc(request,'reader_note_image_annotate',{id:note.id,revision:changed.value.revision,imageId,marks:[{kind:'rect',x:.08,y:.26,width:.32,height:.44,color:'red'},{kind:'arrow',x:.43,y:.48,x2:.58,y2:.48,color:'blue'},{kind:'label',x:.08,y:.76,text:'重点节点',color:'red'}]});
    return route.fulfill({json:{content:[],_meta:{reader:{...session,status:'idle',revision:session.revision+1,draft:'',draftImageIds:[],messages:[{id:'reply',role:'assistant',text:'已补充说明并标注截图。',sourceIds:[],createdAt:new Date().toISOString()}]}}}});
  });
  await page.getByLabel('阅读问题',{exact:true}).fill('补充说明，并标出 A 节点。');await page.getByRole('button',{name:'发送阅读问题',exact:true}).click();await expect(chat).toContainText('已补充说明');
  await page.getByRole('button',{name:'关闭对话',exact:true}).click();await expect(editor).toContainText('补充：A 与 B');await expect(page.getByRole('img',{name:'截图标注',exact:true})).toBeVisible();
  await page.locator('.note-image').scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/note-collaboration-${width}.png`,animations:'disabled'});
  await page.getByRole('button',{name:'笔记操作',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Markdown',exact:true}).click();const download=await downloading,files=unzipSync(await readFile((await download.path())!));expect(files['images/annotated-'+imageId+'.png']).toBeDefined();expect(new TextDecoder().decode(files['note.md'])).toContain('annotated-'+imageId);
  await page.reload();await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('.study-notes-list').getByRole('button',{name:new RegExp('协作笔记 '+width)}).click();await expect(page.getByRole('img',{name:'截图标注',exact:true})).toBeVisible();expect((await rpc(request,'reader_note_get',{id:note.id})).tags).toEqual(['保留']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
});

test('a screenshot attached while the previous message is sending remains in the next draft',async({page,request})=>{
  const note=(await rpc(request,'reader_note_create',{title:'附图草稿并发',body:'正文',folderId:null,tags:[],sourceIds:[],imageIds:[]})).value;
  await page.goto('/');await page.getByRole('button',{name:'笔记',exact:true}).click();await page.locator('.study-notes-list').getByRole('button',{name:'附图草稿并发 正文',exact:true}).click();await page.getByRole('button',{name:'Codex 辅助编写',exact:true}).click();
  const chat=page.getByRole('dialog',{name:'笔记协作',exact:true}),draftImages=chat.locator('.study-chat-compose .study-chat-images img');await expect(chat).toBeVisible();
  const png=async(color:string)=>page.evaluate(color=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=30;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,40,30);return canvas.toDataURL('image/png').split(',')[1]!;},color);
  await page.getByLabel('选择聊天截图').setInputFiles({name:'第一张.png',mimeType:'image/png',buffer:Buffer.from(await png('#ee7766'),'base64')});await expect(draftImages).toHaveCount(1);
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);let sent:any;
  await page.route('**/api/tool',async route=>{const call=route.request().postDataJSON();if(call.name!=='reader_chat_send')return route.continue();sent=call.arguments;await held;const session=await rpc(request,'reader_chat_get',{id:sent.id});await route.fulfill({json:{content:[],_meta:{reader:{...session,draft:'',draftImageIds:[],status:'idle',revision:session.revision+1}}}});});
  await page.getByLabel('阅读问题',{exact:true}).fill('第一条消息');await page.getByRole('button',{name:'发送阅读问题',exact:true}).click();await expect.poll(()=>sent?.id).toBeTruthy();
  try{await page.getByLabel('选择聊天截图').setInputFiles({name:'下一条.png',mimeType:'image/png',buffer:Buffer.from(await png('#5577bb'),'base64')});await expect(draftImages).toHaveCount(2);}finally{release();}
  await expect(draftImages).toHaveCount(1);await expect(page.getByLabel('阅读问题',{exact:true})).toHaveValue('');
  await expect.poll(async()=>{const saved=await rpc(request,'reader_chat_get',{id:sent.id});return saved.draftImageIds;}).not.toContain(sent.imageIds[0]);
  const saved=await rpc(request,'reader_chat_get',{id:sent.id});expect(saved.noteId).toBe(note.id);expect(saved.draftImageIds).toHaveLength(1);
});
