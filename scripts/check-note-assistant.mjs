// Explicit, bounded real-model check using only original data in an isolated library.
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { ReaderStore } from '../dist/server/store.js';
import { ReaderService } from '../dist/server/service.js';
import { CodexClient } from '../dist/server/codex-client.js';

if(!process.argv.includes('--run'))throw Error('Pass --run to use the signed-in Codex account for one original test turn.');
await mkdir('artifacts/note-assistant-live',{recursive:true});
const directory=await mkdtemp(join(process.cwd(),'artifacts/note-assistant-live/library-'));
const service=new ReaderService(new ReaderStore(directory));
const report={passed:false,realInference:false,dataDir:directory,checks:[]};let sessionId,threadId;
try{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':undefined)});
  let png;
  try{const page=await browser.newPage();png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=480;canvas.height=260;const ctx=canvas.getContext('2d');ctx.fillStyle='#f8faf7';ctx.fillRect(0,0,480,260);ctx.fillStyle='#438965';ctx.fillRect(40,70,150,110);ctx.fillStyle='#527ab4';ctx.fillRect(290,70,150,110);ctx.fillStyle='#222';ctx.font='24px sans-serif';ctx.fillText('A',100,45);ctx.fillText('B',350,45);return canvas.toDataURL('image/png').split(',')[1];});}finally{await browser.close();}
  const image=await service.workspace.store.putImage(png);
  const input={title:'原创协作验收笔记',body:'保留原句：阅读需要主动思考。',folderId:null,tags:[],sourceIds:[],imageIds:[]};
  const note=(await service.workspace.store.createNote(input)).value;
  const other=(await service.workspace.store.createNote({...input,title:'不应修改的笔记',body:'原样保留。'})).value;
  const session=await service.chat.create(undefined,null,note.id);sessionId=session.id;
  await service.chat.send({id:session.id,messageId:crypto.randomUUID(),sourceIds:[],imageIds:[image.id],text:'请实际使用工具编辑当前笔记：先读取笔记，保留原有正文，再追加一行“协作验证完成”。用 reader_image_get 查看我提供的截图，把截图插入当前笔记，再给左侧 A 绿色矩形添加一个红色矩形边框标注。不要创建其他笔记。每次修改使用最新 revision。完成后简短回答。'});
  const deadline=Date.now()+180000;let result;
  while(Date.now()<deadline){result=await service.chat.get(session.id);threadId=result.threadId;if(result.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,750));}
  assert.equal(result.status,'idle',result.error??'Model check timed out');
  const saved=await service.workspace.store.note(note.id);assert.ok(saved.body.includes(input.body));assert.ok(saved.body.includes('协作验证完成'));assert.ok(saved.imageIds.includes(image.id));
  assert.ok(saved.imageAnnotations?.some(item=>item.imageId===image.id&&item.marks.some(mark=>mark.kind==='rect'&&mark.color==='red'&&mark.x<.4)));
  assert.equal((await service.workspace.store.note(other.id)).body,'原样保留。');assert.equal((await service.workspace.store.image(image.id)).data,png);
  report.realInference=true;report.passed=true;report.noteId=note.id;report.threadId=threadId;
  report.checks=['Actual Codex preserves and extends the current note','Actual Codex inserts the supplied image and marks its left-hand region','Other notes and original image bytes remain unchanged'];
}catch(error){report.error=String(error.message??error);process.exitCode=1;}
finally{
  if(sessionId&&!threadId)threadId=(await service.chat.get(sessionId)).threadId;
  await service.close();if(threadId){const client=new CodexClient();try{await client.request('thread/archive',{threadId});report.testThreadArchived=true;}catch(error){report.cleanupError=error.message;report.passed=false;process.exitCode=1;}finally{await client.close();}}
  await writeFile('artifacts/note-assistant-live/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
