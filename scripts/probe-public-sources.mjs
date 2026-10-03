// Limited, anonymous metadata probes. No third-party chapter text is fetched.
import fs from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ReaderStore } from '../dist/server/store.js';
import { OnlineSourceService } from '../dist/server/online/service.js';
const bytes = await fs.readFile(process.argv[2]);
if(createHash('sha256').update(bytes).digest('hex')!=='00644eda44f0fcabcfc015a024480376638d5e7a381a2010aeedfca5aa797845') throw Error('Unexpected baseline');
const raw = JSON.parse(bytes), report=[];
const dir=await mkdtemp(join(tmpdir(),'reader-public-probe-'));
try {
  const online=new OnlineSourceService(new ReaderStore(dir));
  // Two official services and one public source with the new unused-login behavior.
  for(const name of ['起点中文','酷我小说','铅笔小说']) {
    const source=raw.find(s=>s.bookSourceName===name), item={name, query:'红楼梦', startedAt:new Date().toISOString(), chapterRequests:0};
    try {
      const p=await online.preview(JSON.stringify(source)); await online.commit(p.token); await online.manage(p.sources[0].id,true);
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),25000);
      try { const result=await online.search(p.sources[0].id,'红楼梦',1,controller.signal); item.search='passed';item.resultCount=result.length; }
      finally {clearTimeout(timer);}
    }catch(error){item.search='failed';item.error=error.message;}
    report.push(item);
  }
}finally{await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify({mode:'anonymous-public-search-only',proxy:false,dnsOverride:false,transportOverride:false,report},null,2));
