import fs from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { ReaderStore } from '../dist/server/store.js';
import { OnlineSourceService } from '../dist/server/online/service.js';
const dir=await mkdtemp(join(tmpdir(),'reader-original-http-')), report={startedAt:new Date().toISOString(), proxy:false, dnsOverride:false, transportOverride:false};
const source=JSON.parse(await fs.readFile('examples/online/reader-script-cdn.json','utf8'));
report.source=source.bookSourceUrl;
try {
  const online=new OnlineSourceService(new ReaderStore(dir)), signal=()=>AbortSignal.timeout(45000);
  const p=await online.preview(JSON.stringify(source)); await online.commit(p.token);await online.manage(p.sources[0].id,true);report.import='passed';
  const results=await online.search(p.sources[0].id,'纸桥',1,signal());report.search={count:results.length};
  const detail=await online.detail(results[0],signal());report.detail={title:detail.title};
  const book=await online.add(detail,signal());report.toc={chapters:book.document.chapters.length};
  report.content={firstParagraphCount:book.document.chapters[0].paragraphs.length,sha256:createHash('sha256').update(book.document.chapters[0].paragraphs.join('\n')).digest('hex')};
  const chapter=book.document.chapters[1]; await online.chapter(book.summary.id,chapter.id,signal());
  const locator={chapter:1,paragraph:1,chapterId:chapter.id}; await online.saveProgress(book.summary.id,locator);await online.addBookmark(book.summary.id,locator,'原创验收');
  await online.manage(p.sources[0].id,false);
  const child=await promisify(execFile)(process.execPath,['--input-type=module','-e',`
    import {ReaderStore} from './dist/server/store.js'; import {OnlineSourceService} from './dist/server/online/service.js';
    const online=new OnlineSourceService(new ReaderStore(process.argv[1]));
    const book=await online.open(process.argv[2],new AbortController().signal);
    console.log(JSON.stringify({progress:book.summary.progress,locator:book.summary.locator,bookmarks:book.bookmarks.length,paragraphs:book.document.chapters[1].paragraphs.length}));
  `,dir,book.summary.id],{timeout:10000});
  report.realProcessRestartWithSourceDisabled=JSON.parse(child.stdout);report.result='passed';
}catch(error){report.result='failed';report.error=error.message;}
finally{await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
