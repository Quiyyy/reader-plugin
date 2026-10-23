// Maintainer probe: original text, isolated library, a newly created test chat.
// No personal books, notes or existing conversations are read or changed.
import { mkdtemp,writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ReaderStore } from '../dist/server/store.js';
import { ReaderService } from '../dist/server/service.js';
import {ChatService} from '../dist/server/chat-service.js';
import {CodexClient} from '../dist/server/codex-client.js';

await mkdir('artifacts/codex-reading',{recursive:true});
const dir=await mkdtemp(join(process.cwd(),'artifacts/codex-reading/library-'));
const service=new ReaderService(new ReaderStore(dir));
let chat=new ChatService(service.workspace);
const report={realInference:false,status:await chat.status(),checks:[],dataDir:dir,passed:false};
console.log(JSON.stringify({status:report.status}));
try{
  if(process.argv.includes('--run')){
    if(!report.status.authenticated)throw Error(report.status.message);
    const book=await service.store.importBook('原创阅读验证.txt',Buffer.from('第一章 原创验证\n\n回忆是理解的练习。验证词是雨后石桥。'));
    const paragraph=book.document.chapters[0].paragraphs.findIndex(x=>x.includes('雨后石桥'));const quote=book.document.chapters[0].paragraphs[paragraph];
    const source=await service.workspace.createSource({bookId:book.summary.id,quote,anchor:{kind:'text',start:{chapter:0,paragraph,offset:0},end:{chapter:0,paragraph,offset:quote.length}}});
    const session=await chat.create(book.summary.id);report.sessionId=session.id;
    const ask=async(text,sourceIds=[source.id])=>{await chat.send({id:session.id,messageId:crypto.randomUUID(),text,sourceIds});const deadline=Date.now()+180000;while(Date.now()<deadline){const current=await chat.get(session.id);if(current.status!=='running'){if(current.status!=='idle')throw Error(current.error||current.status);return current;}await new Promise(r=>setTimeout(r,750));}throw Error('Probe timed out');};
    const first=await ask('阅读所给原文，仅回答验证词，不调用任何工具。');
    if(!first.messages.some(m=>m.role==='assistant'&&m.text.includes('雨后石桥')))throw Error('First answer did not preserve source');
    report.checks.push('Actual model receives selected original text');report.realInference=true;report.threadId=first.threadId;
    if(process.argv.includes('--ownership')){
      const peer=new CodexClient();try{await peer.request('thread/resume',{threadId:first.threadId});report.checks.push('A separate app-server can resume the completed thread while Reader stays open');}finally{await peer.close();}
    }
    const second=await ask('继续刚才的话题。把上一轮的验证词用【】括起来，仅输出这一项。',[]);
    if(!second.messages.filter(m=>m.role==='assistant').at(-1)?.text.includes('雨后石桥'))throw Error('Follow-up lost context');
    if(second.threadId!==first.threadId)throw Error('Follow-up created a different thread');
    report.checks.push('Actual follow-up continues the same Codex thread');report.threadId=second.threadId;
    if(process.argv.includes('--ownership')){
      const peer=new CodexClient();try{
        await peer.request('thread/archive',{threadId:report.threadId});report.checks.push('A separate app-server archives the completed thread while Reader stays open');
        await peer.request('thread/delete',{threadId:report.threadId});report.checks.push('A separate app-server deletes the isolated archived test thread');report.testThreadDeleted=true;
      }finally{await peer.close();}
    }else{
    const third=await ask('请使用 Reader 的 reader_note_create 工具创建一篇标题为「原创验证笔记」的笔记，正文仅为雨后石桥，并关联本次提供的原文 sourceId。无需查找其他资料。');
    if(!(await service.workspace.store.snapshot()).notes.some(n=>n.title==='原创验证笔记'))throw Error('Scoped note tool did not write the test note');report.checks.push('Actual Codex tool call writes a note into the isolated Reader library');
    await chat.close();chat=new ChatService(service.workspace);
    const resumed=await ask('恢复这段讨论：之前的验证词是什么？只回答验证词。');
    if(!resumed.messages.filter(m=>m.role==='assistant').at(-1)?.text.includes('雨后石桥'))throw Error('Resumed thread lost history');report.checks.push('Codex thread resumes after reconnect');
    }
  }
  report.passed=true;
}catch(e){report.error=e.message;process.exitCode=1;}
finally{if(report.sessionId&&!report.threadId)report.threadId=(await chat.get(report.sessionId)).threadId;await chat.close();if(report.threadId&&!report.testThreadDeleted){const client=new CodexClient();try{await client.request('thread/archive',{threadId:report.threadId});}catch(e){report.cleanupError=e.message;report.passed=false;process.exitCode=1;}finally{await client.close();}}await service.chat.close();await writeFile('artifacts/codex-reading/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,realInference:report.realInference,checks:report.checks,error:report.error,cleanupError:report.cleanupError}));}
