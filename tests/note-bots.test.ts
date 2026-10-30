import { afterEach,beforeEach,expect,it } from 'vitest';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReaderStore } from '../src/server/store.js';
import { NoteBotStore } from '../src/server/note-bots.js';

let directory:string,store:NoteBotStore;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'reader-bots-'));store=new NoteBotStore(new ReaderStore(directory));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
it('keeps a default bot and persists custom roles and their default model across restart',async()=>{
  const initial=await store.list();expect(initial.bots).toHaveLength(1);
  const bot={id:randomUUID(),name:'论证教练',description:'检查推理与证据',instructions:'指出缺失的依据，不编造事实。',model:'model-fast'};
  const saved=await store.save(initial.revision,bot,true);expect(saved.bots).toHaveLength(2);
  const restarted=new NoteBotStore(new ReaderStore(directory));expect(await restarted.resolve()).toEqual(bot);
  await restarted.remove(saved.revision,bot.id);expect((await restarted.resolve()).id).toBe(initial.defaultId);
  await expect(restarted.remove(saved.revision+1,initial.defaultId)).rejects.toThrow('至少保留');
});
it('rejects stale edits, duplicate names and excess privileges without changing the configuration',async()=>{
  const initial=await store.list(),bot={...initial.bots[0]!,name:'我的助手'};
  const saved=await store.save(initial.revision,bot);
  const path=join(directory,'study-v1','note-bots.json'),before=await readFile(path);
  await expect(store.save(initial.revision,{...bot,name:'旧窗口覆盖'})).rejects.toThrow('另一个窗口');
  await expect(store.save(saved.revision,{...bot,id:randomUUID()})).rejects.toThrow('名称重复');
  await expect(store.save(saved.revision,{...bot,tools:['shell']} as any)).rejects.toThrow();
  expect(await readFile(path)).toEqual(before);
});
