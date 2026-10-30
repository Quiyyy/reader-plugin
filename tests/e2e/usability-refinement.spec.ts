import { openNotes } from './navigation';
import { test,expect,type APIRequestContext,type Page } from '@playwright/test';
import { pdfFixture } from '../pdf-fixture';
import { defaultAppearance } from '../../src/shared/workspace';

async function rpc(request:APIRequestContext,name:string,args:object={}) {
  const response=await request.post('/api/tool',{headers:{'X-Reader-Client':'preview'},data:{name,arguments:args}});
  const value=await response.json();expect(value.isError,JSON.stringify(value)).not.toBe(true);return value._meta.reader;
}
const makeNote=(request:APIRequestContext,title:string,folderId:string|null=null,body='原始正文')=>rpc(request,'reader_note_create',{title,body,folderId,tags:[],imageIds:[],sourceIds:[]}).then(r=>r.value);
async function importText(page:Page,name:string) {await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:name+'.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 原创验证\n\n阅读正文和自己的理解应始终可以找回。'+name)});await expect(page.locator('.reading-scroll')).toBeVisible();}
function twoPagePdf() {
  const stream=(text:string)=>{const body=`BT /F1 18 Tf 50 730 Td (${text}) Tj ET`;return `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`;};
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',stream('Shared first page'),'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',stream('Shared second page')];
  let text='%PDF-1.7\n';const offsets:number[]=[];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;});const at=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`;return Buffer.from(text);
}

test('recursive search respects folder scope, selection exits with Escape and single trash can undo',async({page,request})=>{
  const root=(await rpc(request,'reader_folder_save',{name:'递归范围',parentId:null})).value;
  const child=(await rpc(request,'reader_folder_save',{name:'范围子目录',parentId:root.id})).value;
  const note=await makeNote(request,'检索目标',child.id),outside=await makeNote(request,'检索目标（其他目录）');
  await page.goto('/');await page.getByRole('button',{name:'打开文件夹 递归范围',exact:true}).click();
  await expect(page.locator(`[data-note-id="${note.id}"]`)).toHaveCount(0);
  await page.getByLabel('搜索书籍、笔记和文件夹').fill('检索目标');
  await expect(page.locator(`[data-note-id="${note.id}"]`)).toBeVisible();await expect(page.locator(`[data-note-id="${outside.id}"]`)).toHaveCount(0);
  await expect(page.locator('.library-result-path')).toContainText('范围子目录');
  await page.getByRole('button',{name:'选择',exact:true}).click();await page.getByRole('button',{name:'全选',exact:true}).click();await expect(page.locator('.library-entry.selected')).toHaveCount(1);
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'选择',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'管理 检索目标',exact:true}).click();await page.getByRole('menuitem',{name:'移到回收站'}).click();await page.getByRole('dialog',{name:'移到回收站'}).getByRole('button',{name:'移到回收站',exact:true}).click();
  await expect(page.locator(`[data-note-id="${note.id}"]`)).toHaveCount(0);await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator(`[data-note-id="${note.id}"]`)).toBeVisible();
  expect((await rpc(request,'reader_note_get',{id:note.id})).body).toBe('原始正文');
});

test('folder trash preserves contents by default and folders are restorable',async({page,request})=>{
  const folder=(await rpc(request,'reader_folder_save',{name:'回收文件夹',parentId:null})).value,note=await makeNote(request,'文件夹内保留',folder.id);
  await page.goto('/');await page.getByLabel('搜索书籍、笔记和文件夹').fill('回收文件夹');await page.getByRole('button',{name:'管理 回收文件夹',exact:true}).click();await page.getByRole('menuitem',{name:'移到回收站'}).click();
  const dialog=page.getByRole('dialog',{name:'移到回收站'});await expect(dialog.getByRole('checkbox')).not.toBeChecked();await dialog.getByRole('button',{name:'移到回收站',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(await rpc(request,'reader_note_get',{id:note.id})).toMatchObject({folderId:null,body:'原始正文'});
  await page.getByRole('button',{name:'回收站',exact:true}).click();const row=page.locator('.study-trash-row').filter({hasText:'回收文件夹'});await expect(row).toBeVisible();await row.getByRole('button',{name:'恢复',exact:true}).click();await expect(row).toHaveCount(0);
  expect((await rpc(request,'reader_workspace')).folders.find((f:any)=>f.id===folder.id).trashedAt).toBeUndefined();
});

test('batch trash reports partial failure and leaves remaining notes intact',async({page,request})=>{
  const a=await makeNote(request,'批量回收 A'),b=await makeNote(request,'批量回收 B');
  await page.route('**/api/tool',async route=>{const call=route.request().postDataJSON();if(call.name==='reader_study_trash'&&call.arguments.id===b.id)return route.fulfill({json:{isError:true,content:[{type:'text',text:'模拟版本冲突'}]}});return route.continue();});
  await page.goto('/');await page.getByLabel('搜索书籍、笔记和文件夹').fill('批量回收');await page.getByRole('button',{name:'选择',exact:true}).click();await page.getByRole('button',{name:'全选',exact:true}).click();await page.getByRole('button',{name:'移到回收站',exact:true}).click();
  await page.getByRole('dialog',{name:'移到回收站'}).getByRole('button',{name:'移到回收站',exact:true}).click();await expect(page.getByRole('dialog',{name:'移到回收站'})).toContainText('已完成 1 项');
  const state=await rpc(request,'reader_workspace');expect(state.notes.find((n:any)=>n.id===a.id).trashedAt).toBeTruthy();expect(state.notes.find((n:any)=>n.id===b.id).trashedAt).toBeUndefined();
  expect((await rpc(request,'reader_note_get',{id:b.id})).body).toBe('原始正文');
});

test('notes search and management preserve Markdown code, tables, nested lists and raw HTML as text',async({page,request,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const content='## 学习记录\n\n```js\nconst html = "<img src=x onerror=alert(1)>";\nconsole.log(html);\n```\n\n| 概念 | 说明 |\n| --- | --- |\n| **协议** | 有序交换 |\n\n1. 第一步\n   - 子项目\n   - 第二项\n2. 第二步\n\n<script>alert(1)</script>\n\n- [x] 已整理';
  const note=await makeNote(request,'Markdown 验收',null,content);await page.goto('/');await openNotes(page);await page.getByLabel('搜索笔记标题或摘要').fill('Markdown 验收');
  await page.getByRole('button',{name:'管理笔记 Markdown 验收',exact:true}).click();await page.getByRole('menuitem',{name:'重命名'}).click();await page.getByLabel('笔记名称').focus();await expect(page.getByLabel('笔记名称')).toHaveCSS('outline-style','solid');await page.getByLabel('笔记名称').fill('Markdown 技术笔记');await page.getByRole('dialog',{name:'重命名'}).getByRole('button',{name:'完成'}).click();await expect(page.getByRole('dialog',{name:'重命名'})).toHaveCount(0);await page.getByLabel('搜索笔记标题或摘要').fill('Markdown 技术笔记');
  await page.locator('.study-note-row').click();if(await page.getByRole('button',{name:'返回排版编辑',exact:true}).count())await page.getByRole('button',{name:'返回排版编辑',exact:true}).click();
  await expect(page.locator('.note-code-block pre')).toContainText('console.log(html)');await expect(page.locator('.note-rich-content table tr:has(td)')).toHaveCount(1);await expect(page.locator('.note-rich-content ol > li')).toHaveCount(2);await expect(page.locator('.note-rich-content ol ul > li')).toHaveCount(2);await expect(page.locator('.note-rich-content script,.note-rich-content img')).toHaveCount(0);
  await page.getByRole('button',{name:'复制代码'}).click();await expect(page.getByRole('button',{name:'复制代码'})).toContainText('已复制');expect((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n')).toBe('const html = "<img src=x onerror=alert(1)>";\nconsole.log(html);');expect((await rpc(request,'reader_note_get',{id:note.id})).body).toBe(content);
  await page.setViewportSize({width:390,height:850});await page.screenshot({path:'artifacts/usability-markdown-390.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('narrow TXT and PDF keep learning controls visible and PDF search/zoom remain usable',async({page,request})=>{
  test.setTimeout(60000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await rpc(request,'reader_appearance',{appearance:{...defaultAppearance,mode:'light'}});await page.setViewportSize({width:320,height:850});await page.goto('/');await importText(page,'窄屏控制验证');
  await expect(page.getByRole('button',{name:'批注与笔记',exact:true})).toBeInViewport();await page.getByRole('button',{name:'批注与笔记',exact:true}).click();await expect(page.locator('.study-reading-panel')).toBeVisible();await page.getByRole('button',{name:'关闭学习面板'}).click();await page.getByRole('button',{name:'返回书架',exact:true}).click();
  await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'窄屏文档.pdf',mimeType:'application/pdf',buffer:pdfFixture()});await expect(page.locator('.pdf-loading')).toHaveCount(0);await expect(page.locator('.pdf-sheet canvas')).toBeVisible();
  await expect(page.locator('.pdf-reader .reader-toolbar').getByRole('button',{name:'批注与笔记',exact:true})).toBeInViewport();await expect(page.locator('.study-pdf-actions')).toHaveCount(0);await page.getByRole('button',{name:'放大页面'}).click();await page.getByRole('button',{name:'适应页宽'}).click();
  await page.getByRole('button',{name:'搜索 PDF',exact:true}).click();await page.getByLabel('搜索 PDF 内容').fill('Recall');await page.getByRole('button',{name:'查找',exact:true}).click();await expect(page.locator('.pdf-search-hit')).toHaveCount(1);await page.locator('.pdf-search-hit').click();await expect(page.locator('.pdf-search-match')).not.toHaveCount(0);
  await expect(page.locator('.pdf-panel')).toHaveCount(0);await page.screenshot({path:'artifacts/usability-pdf-320.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);expect(errors).toEqual([]);
});

test('PDF search navigates indexed pages and clears old highlights when the query changes',async({page,request})=>{
  await page.goto('/');await page.getByLabel('选择 TXT、EPUB 或 PDF 书籍').setInputFiles({name:'跨页搜索.pdf',mimeType:'application/pdf',buffer:twoPagePdf()});await expect(page.locator('.textLayer')).toContainText('Shared first page');
  const book=(await rpc(request,'reader_list')).books.find((b:any)=>b.title==='跨页搜索');
  await expect.poll(async()=>(await rpc(request,'reader_pdf_index',{id:book.id})).complete).toBe(true);
  await page.getByRole('button',{name:'搜索 PDF',exact:true}).click();await page.getByLabel('搜索 PDF 内容').fill('Shared');await page.getByRole('button',{name:'查找',exact:true}).click();await expect(page.locator('.pdf-search-hit')).toHaveCount(2);
  await page.locator('.pdf-search-hit').first().click();await page.getByRole('button',{name:'下个结果'}).click();await expect(page.getByLabel('PDF 页码')).toHaveValue('2');await expect(page.locator('.pdf-search-match')).toContainText('Shared second page');
  await page.getByRole('button',{name:'上个结果'}).click();await expect(page.getByLabel('PDF 页码')).toHaveValue('1');await page.getByLabel('搜索 PDF 内容').fill('不存在');await expect(page.locator('.pdf-search-match')).toHaveCount(0);
});
