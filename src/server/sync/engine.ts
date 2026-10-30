import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {atomicWrite} from '../store.js';
import type {SyncOptions} from '../../shared/sync.js';
import type {CloudProvider} from './google-drive.js';
import {assetSchema,bytesHash,canonical,commitSchema,digest,heads,itemKeySchema,objectKey,seal,unseal,validateCommit,versionSchema,type LocalAsset,type SyncAsset,type SyncCommit,type SyncVersion} from './protocol.js';

export type SyncValue=SyncVersion['value'];
export interface ReplicaContext {deviceId:string;deviceName:string;options:SyncOptions;suppressedBooks?:string[];}
export interface ApplyChange {key:string;before:SyncValue;after:SyncValue;}
export interface LocalReplica {
  snapshot(context:ReplicaContext):Promise<Record<string,SyncValue>>;
  validate(key:string,value:SyncValue):void;
  assets(key:string,value:SyncValue,context:ReplicaContext):Promise<LocalAsset[]>;
  readAsset(asset:LocalAsset):Promise<Buffer>;
  apply(changes:ApplyChange[],context:ReplicaContext):Promise<string[]>;
}
const baselineSchema=z.object({hash:z.string(),heads:z.array(z.string().uuid()).max(128)}).strict();
const pendingSchema=z.object({id:z.string().uuid(),fileId:z.string().regex(/^[\w-]{1,200}$/),hash:z.string(),assets:z.array(assetSchema),publishing:z.boolean().default(false)}).strict();
const journalSchema=z.object({changes:z.array(z.object({key:itemKeySchema,before:z.json().nullable(),after:z.json().nullable()}).strict()),accepted:z.record(z.string(),baselineSchema)}).strict();
const stateSchema=z.object({version:z.literal(1),vaultId:z.string().uuid(),deviceId:z.string().uuid(),sequence:z.number().int().nonnegative(),cursor:z.string().optional(),versions:z.record(z.string().uuid(),versionSchema),base:z.record(z.string(),baselineSchema),assets:z.record(z.string(),assetSchema),seen:z.record(z.string(),z.string()),pending:z.array(pendingSchema),journal:journalSchema.optional(),lastSyncedAt:z.string().optional()}).strict();
export type SyncEngineState=z.infer<typeof stateSchema>;
export interface EngineConfig extends ReplicaContext {vaultId:string;key:Buffer;}
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';

/** Durable immutable commits. Cloud change cursors never stand in for content ancestry. */
export class SyncEngine {
  private readonly path:string;
  constructor(readonly directory:string,private provider:CloudProvider,private local:LocalReplica,readonly config:EngineConfig){this.path=join(directory,'state.json');}
  async read():Promise<SyncEngineState>{
    try{const bytes=await fs.readFile(this.path);if(bytes.length>128*1024*1024)throw Error('同步索引超过容量限制');const state=stateSchema.parse(JSON.parse(bytes.toString('utf8')));if(state.vaultId!==this.config.vaultId||state.deviceId!==this.config.deviceId)throw Error('本机同步身份不一致');return state;}
    catch(e){if(!missing(e))throw e;return {version:1,vaultId:this.config.vaultId,deviceId:this.config.deviceId,sequence:0,versions:{},base:{},assets:{},seen:{},pending:[]};}
  }
  private async save(state:SyncEngineState){if(Object.keys(state.versions).length>50000)throw Error('同步历史超过当前版本上限，请先导出备份');const data=JSON.stringify(stateSchema.parse(state));if(Buffer.byteLength(data)>128*1024*1024)throw Error('同步索引超过容量限制');await fs.mkdir(this.directory,{recursive:true,mode:0o700});await atomicWrite(this.path,data);}
  private pendingPath(id:string){return join(this.directory,z.string().regex(/^[\w-]{1,200}$/).parse(id)+'.pending');}
  private context(kind:string,id:string){return this.config.vaultId+':'+kind+':'+id;}
  private replicaContext(state:SyncEngineState):ReplicaContext{return {...this.config,suppressedBooks:[...Object.entries(state.base).filter(([key,value])=>key.startsWith('book:')&&value.hash===digest(null)).map(([key])=>key.slice(5)),...(state.journal?.changes.filter(change=>change.key.startsWith('book:')&&change.after===null).map(change=>change.key.slice(5))??[])]};}
  private version(state:SyncEngineState,key:string,value:SyncValue,parents:string[]):SyncVersion {
    this.local.validate(key,value);return {id:randomUUID(),key,parents:[...parents],value,hash:digest(value),sequence:++state.sequence,deviceId:this.config.deviceId,deviceName:this.config.deviceName,createdAt:new Date().toISOString()};
  }
  /** A replay after a crash accepts only the old value or an already-applied value.
   * A newer local edit is left intact and remains based on its original ancestors. */
  private async recover(state:SyncEngineState){
    if(!state.journal)return;const context=this.replicaContext(state),snapshot=await this.local.snapshot(context),todo:ApplyChange[]=[],accepted:string[]=[];
    for(const change of state.journal.changes){const current=snapshot[change.key]??null;if(digest(current)===digest(change.after))accepted.push(change.key);else if(digest(current)===digest(change.before))todo.push(change);}
    accepted.push(...await this.local.apply(todo,context));for(const key of accepted)state.base[key]=state.journal.accepted[key]!;
    delete state.journal;await this.save(state);
  }
  private async pull(state:SyncEngineState,signal?:AbortSignal){
    const page=await this.provider.changes(this.config.vaultId,state.cursor,signal);
    if(page.removed.some(id=>Object.hasOwn(state.seen,id))||page.full&&Object.keys(state.seen).some(id=>!page.files.some(file=>file.id===id)))throw Error('云端已有同步记录被移除，已保留本地内容，请检查云端书库');
    for(const file of page.files){
      if(file.appProperties?.kind!=='commit')continue;
      const expected=file.appProperties.hash;if(!expected||!/^[a-f0-9]{64}$/.test(expected))throw Error('云端提交缺少校验信息');
      if(state.seen[file.id]){if(state.seen[file.id]!==expected)throw Error('云端历史记录被修改，已停止同步');continue;}
      const commitId=z.string().uuid().parse(file.appProperties.key),bytes=await this.provider.get(file.id,signal);if(bytesHash(bytes)!==expected)throw Error('云端提交校验失败');
      const commit=validateCommit(JSON.parse(unseal(this.config.key,this.context('commit',commitId),bytes).toString('utf8')),this.config.vaultId);if(commit.id!==commitId)throw Error('云端提交标识不一致');
      for(const record of commit.versions){this.local.validate(record.key,record.value);const old=state.versions[record.id];if(old&&canonical(old)!==canonical(record))throw Error('云端版本标识发生冲突');state.versions[record.id]=record;}
      for(const asset of commit.assets){if(asset.objectKey!==objectKey(this.config.key,asset.kind,asset.id))throw Error('附件标识校验失败');const old=state.assets[asset.objectKey];if(old&&(old.id!==asset.id||old.bytes!==asset.bytes||old.format!==asset.format))throw Error('附件内容发生冲突');state.assets[asset.objectKey]=old??asset;}
      state.seen[file.id]=expected;
    }
    heads(state.versions);state.cursor=page.cursor;await this.save(state);
  }
  private async queue(state:SyncEngineState,records:SyncVersion[],signal?:AbortSignal,captured=false){
    if(!records.length)return;const refs=new Map<string,SyncAsset>();
    for(const record of records)for(const asset of await this.local.assets(record.key,record.value,this.config)){
      signal?.throwIfAborted();const key=objectKey(this.config.key,asset.kind,asset.id);let ref=state.assets[key];
      if(!ref){const bytes=await this.local.readAsset(asset);if(bytes.length!==asset.bytes||bytesHash(bytes)!==asset.id)throw Error('本地附件校验失败');const fileId=await this.provider.allocate();ref={...asset,objectKey:key,fileId};const encrypted=seal(this.config.key,this.context('asset',key),bytes);await fs.mkdir(this.directory,{recursive:true,mode:0o700});await atomicWrite(this.pendingPath(fileId),encrypted);state.assets[key]=ref;}
      refs.set(key,ref);
    }
    const commit:SyncCommit={version:1,vaultId:this.config.vaultId,id:randomUUID(),versions:records,assets:[...refs.values()]};commitSchema.parse(commit);
    const fileId=await this.provider.allocate(),bytes=seal(this.config.key,this.context('commit',commit.id),Buffer.from(JSON.stringify(commit)));
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});await atomicWrite(this.pendingPath(fileId),bytes);
    for(const record of records){state.versions[record.id]=record;if(captured)state.base[record.key]={hash:record.hash,heads:[record.id]};}
    state.pending.push({id:commit.id,fileId,hash:bytesHash(bytes),assets:commit.assets,publishing:false});await this.save(state);
  }
  private async capture(state:SyncEngineState,signal?:AbortSignal){
    const snapshot=await this.local.snapshot(this.replicaContext(state)),records:SyncVersion[]=[];
    for(const key of new Set([...Object.keys(snapshot),...Object.keys(state.base)])){
      if(key.startsWith('preferences:')&&!this.config.options.preferences)continue;
      const value=snapshot[key]??null,base=state.base[key];
      const missingAssets=value!==null&&(await this.local.assets(key,value,this.config)).some(asset=>!state.assets[objectKey(this.config.key,asset.kind,asset.id)]);
      if(digest(value)===(base?.hash??digest(null))&&!missingAssets)continue;
      records.push(this.version(state,key,value,base?.heads??[]));
    }
    await this.queue(state,records,signal,true);
  }
  private async push(state:SyncEngineState,signal?:AbortSignal){
    while(state.pending.length){const pending=state.pending[0]!;
      if(!pending.publishing){
        if(!this.config.options.books){const dropped:SyncAsset[]=[];for(const asset of pending.assets)if(asset.kind==='book'){try{await fs.access(this.pendingPath(asset.fileId));dropped.push(asset);}catch(e){if(!missing(e))throw e;}}
          if(dropped.length){const oldId=pending.fileId,old=await fs.readFile(this.pendingPath(oldId));if(bytesHash(old)!==pending.hash)throw Error('本地同步队列损坏');const commit=validateCommit(JSON.parse(unseal(this.config.key,this.context('commit',pending.id),old).toString('utf8')),this.config.vaultId);commit.assets=commit.assets.filter(asset=>!dropped.some(value=>value.fileId===asset.fileId));const nextId=await this.provider.allocate(),bytes=seal(this.config.key,this.context('commit',pending.id),Buffer.from(JSON.stringify(commit)));await atomicWrite(this.pendingPath(nextId),bytes);pending.fileId=nextId;pending.hash=bytesHash(bytes);pending.assets=commit.assets;for(const asset of dropped)delete state.assets[asset.objectKey];await this.save(state);await fs.rm(this.pendingPath(oldId),{force:true});for(const asset of dropped)if(!state.pending.some(item=>item.assets.some(value=>value.fileId===asset.fileId)))await fs.rm(this.pendingPath(asset.fileId),{force:true});}
        }
        for(const asset of pending.assets){let bytes:Buffer;try{bytes=await fs.readFile(this.pendingPath(asset.fileId));}catch(e){if(missing(e))continue;throw e;}await this.provider.put(asset.fileId,bytes,{vaultId:this.config.vaultId,kind:'asset',key:asset.objectKey},signal);}
        pending.publishing=true;await this.save(state);
      }
      const bytes=await fs.readFile(this.pendingPath(pending.fileId));if(bytesHash(bytes)!==pending.hash)throw Error('本地同步队列损坏');
      await this.provider.put(pending.fileId,bytes,{vaultId:this.config.vaultId,kind:'commit',key:pending.id},signal);state.seen[pending.fileId]=pending.hash;state.pending.shift();await this.save(state);
      await fs.rm(this.pendingPath(pending.fileId),{force:true});for(const asset of pending.assets)if(!state.pending.some(commit=>commit.assets.some(ref=>ref.fileId===asset.fileId)))await fs.rm(this.pendingPath(asset.fileId),{force:true});
    }
  }
  private async reconcile(state:SyncEngineState){
    const snapshot=await this.local.snapshot(this.replicaContext(state)),changes:ApplyChange[]=[],accepted:Record<string,z.infer<typeof baselineSchema>>={};
    for(const [key,candidates] of heads(state.versions)){
      if(key.startsWith('preferences:')&&!this.config.options.preferences||key.startsWith('position:')&&!key.endsWith(':'+this.config.deviceId))continue;
      const current=snapshot[key]??null,base=state.base[key];
      // A write during network I/O is captured as its own version next time.
      if(digest(current)!==(base?.hash??digest(null)))continue;
      const equivalent=new Set(candidates.map(v=>v.hash)).size===1;
      const chosen=candidates.find(v=>v.hash===digest(current))??candidates.find(v=>v.value!==null)??candidates[0]!;
      const target=equivalent?candidates[0]!:chosen;
      const newBase={hash:target.hash,heads:equivalent?candidates.map(v=>v.id):[target.id]};
      if(digest(current)===target.hash){state.base[key]=newBase;continue;}
      changes.push({key,before:current,after:target.value});accepted[key]=newBase;
    }
    if(changes.length){state.journal={changes,accepted};await this.save(state);await this.recover(state);}else await this.save(state);
  }
  async run(signal?:AbortSignal){const state=await this.read();await this.recover(state);await this.pull(state,signal);await this.capture(state,signal);await this.push(state,signal);await this.reconcile(state);state.lastSyncedAt=new Date().toISOString();await this.save(state);return state;}
  async conflicts(){return [...heads((await this.read()).versions)].filter(([,values])=>new Set(values.map(v=>v.hash)).size>1);}
  async resolve(key:string,expectedHeads:string[],selected:string|undefined,keepBoth=false){
    const state=await this.read();await this.recover(state);const candidates=heads(state.versions).get(key)??[];
    if(canonical(candidates.map(v=>v.id).sort())!==canonical([...expectedHeads].sort())||candidates.length<2)throw Error('冲突版本已更新，请重新查看');
    const winner=keepBoth?(candidates.find(v=>v.value!==null)??candidates[0]):candidates.find(v=>v.id===selected);if(!winner)throw Error('请选择一个冲突版本');
    const records=[this.version(state,key,winner.value,candidates.map(v=>v.id))];
    if(keepBoth){if(!key.startsWith('note:'))throw Error('此类冲突请选择保留的版本');for(const version of candidates.filter(v=>v!==winner&&v.value!==null)){const value=version.value as Record<string,SyncValue>,id=randomUUID();const copy={...value,id,title:(String(value.title??'未命名笔记').slice(0,170)+'（'+version.deviceName.slice(0,40)+' 副本）'),folderId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};delete (copy as any).space;records.push(this.version(state,'note:'+id,copy,[]));}}
    await this.queue(state,records);await this.reconcile(state);return state;
  }
  async edit(key:string,value:SyncValue){const state=await this.read();await this.recover(state);const parents=(heads(state.versions).get(key)??[]).map(v=>v.id);await this.queue(state,[this.version(state,key,value,parents)]);await this.reconcile(state);return state;}
  async acceptMaterialized(keys:string[]){const state=await this.read(),snapshot=await this.local.snapshot(this.replicaContext(state)),currentHeads=heads(state.versions);for(const key of keys){const value=snapshot[key]??null,matching=(currentHeads.get(key)??[]).filter(version=>version.hash===digest(value));if(matching.length)state.base[key]={hash:digest(value),heads:matching.map(version=>version.id)};}await this.save(state);}
  async asset(kind:'book'|'image',id:string,signal?:AbortSignal){const state=await this.read(),key=objectKey(this.config.key,kind,id),ref=state.assets[key];if(!ref)throw Error('此附件尚未上传到云端');const bytes=unseal(this.config.key,this.context('asset',key),await this.provider.get(ref.fileId,signal));if(bytes.length!==ref.bytes||bytesHash(bytes)!==id)throw Error('云端附件校验失败');return {ref,bytes};}
}
