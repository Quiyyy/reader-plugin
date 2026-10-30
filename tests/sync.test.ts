import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {SyncEngine,type LocalReplica,type ApplyChange,type SyncValue} from '../src/server/sync/engine.js';
import {bytesHash,canonical,digest,newVaultKey,parseRecoveryKey,recoveryKey,seal,unseal,heads,type SyncVersion} from '../src/server/sync/protocol.js';
import type {CloudProvider,DriveFile,ObjectInfo} from '../src/server/sync/google-drive.js';

class Cloud implements CloudProvider {
  files=new Map<string,{bytes:Buffer;file:DriveFile}>();changesLog:{id:string;removed?:boolean}[]=[];failAfterCommit=false;
  async allocate(){return randomUUID();}
  async put(id:string,bytes:Buffer,info:ObjectInfo){const prior=this.files.get(id);if(prior){expect(prior.bytes).toEqual(bytes);return;}this.files.set(id,{bytes:Buffer.from(bytes),file:{id,size:String(bytes.length),appProperties:{readerSync:'1',vaultId:info.vaultId,kind:info.kind,key:info.key,hash:bytesHash(bytes)}}});this.changesLog.push({id});if(this.failAfterCommit&&info.kind==='commit'){this.failAfterCommit=false;throw Error('connection dropped after commit');}}
  async get(id:string){const value=this.files.get(id);if(!value)throw Error('missing');return value.bytes;}
  async metadata(id:string){return this.files.get(id)!.file;}
  async vaults(){return [...this.files.values()].map(v=>v.file).filter(v=>v.appProperties?.kind==='vault');}
  async changes(vaultId:string,cursor?:string){const changes=this.changesLog.slice(Number(cursor??0));return {files:changes.filter(v=>!v.removed).map(v=>this.files.get(v.id)!.file).filter(v=>v.appProperties?.vaultId===vaultId),removed:changes.filter(v=>v.removed).map(v=>v.id),cursor:String(this.changesLog.length)};}
}
class Replica implements LocalReplica {
  values:Record<string,SyncValue>={};race?:()=>void;
  async snapshot(){return structuredClone(this.values);}
  validate(key:string,value:SyncValue){if(!key.startsWith('note:'))throw Error('kind');if(value!==null&&typeof value!=='object')throw Error('value');}
  async assets(){return [];}
  async readAsset(){throw Error('no assets');return Buffer.alloc(0);}
  async apply(changes:ApplyChange[]){this.race?.();this.race=undefined;const applied:string[]=[];for(const change of changes){if(digest(this.values[change.key]??null)!==digest(change.before))continue;if(change.after===null)delete this.values[change.key];else this.values[change.key]=structuredClone(change.after);applied.push(change.key);}return applied;}
}
async function using(work:(a:SyncEngine,b:SyncEngine,la:Replica,lb:Replica,cloud:Cloud,root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'Reader cloud protocol ')),vault=newVaultKey(),cloud=new Cloud(),la=new Replica(),lb=new Replica(),options={books:true,preferences:false};try{await work(new SyncEngine(join(root,'a'),cloud,la,{vaultId:vault.id,key:vault.key,deviceId:randomUUID(),deviceName:'电脑 A',options}),new SyncEngine(join(root,'b'),cloud,lb,{vaultId:vault.id,key:vault.key,deviceId:randomUUID(),deviceName:'电脑 B',options}),la,lb,cloud,root);}finally{await rm(root,{recursive:true,force:true});}}
const note=(id:string,body:string)=>({id,title:'原创测试笔记',body,folderId:null,sourceIds:[],imageIds:[],tags:[],revision:1,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'});
describe('encrypted multi-computer synchronisation',()=>{
  it('replays an interrupted local apply after restart without overwriting a newer edit',()=>using(async(a,b,la,lb,cloud)=>{
    const id=randomUUID(),key='note:'+id;la.values[key]=note(id,'共同版本');await a.run();await b.run();la.values[key]=note(id,'电脑 A 新版本');await a.run();
    const apply=lb.apply.bind(lb);lb.apply=async changes=>{await apply(changes);throw Error('simulated crash after local write');};await expect(b.run()).rejects.toThrow('simulated crash');expect((await b.read()).journal).toBeDefined();
    lb.apply=apply;lb.values[key]=note(id,'崩溃后继续输入');const restarted=new SyncEngine(b.directory,cloud,lb,b.config);await restarted.run();expect((lb.values[key] as any).body).toBe('崩溃后继续输入');expect((await restarted.read()).journal).toBeUndefined();expect(await restarted.conflicts()).toHaveLength(1);
  }));
  it('round-trips recovery keys and binds authenticated encryption to object identity',()=>{const vault=newVaultKey();expect(parseRecoveryKey(vault.recoveryKey)).toEqual({vaultId:vault.id,key:vault.key});const bytes=Buffer.from('正文不能出现在云端明文中');const encrypted=seal(vault.key,vault.id+':note',bytes);expect(encrypted.includes(bytes)).toBe(false);expect(unseal(vault.key,vault.id+':note',encrypted)).toEqual(bytes);expect(()=>unseal(vault.key,vault.id+':other',encrypted)).toThrow('校验');expect(()=>unseal(randomBytes(32),vault.id+':note',encrypted)).toThrow('校验');expect(recoveryKey(vault.id,vault.key)).toBe(vault.recoveryKey);});
  it('merges independent edits, keeps local-first content and sends no plaintext',()=>using(async(a,b,la,lb,cloud)=>{const one=randomUUID(),two=randomUUID();la.values['note:'+one]=note(one,'A 的原创内容');await a.run();await b.run();expect(lb.values).toEqual(la.values);la.values['note:'+one]=note(one,'修改 A');lb.values['note:'+two]=note(two,'B 的新笔记');await b.run();await a.run();await b.run();expect(la.values).toEqual(lb.values);expect(await a.conflicts()).toHaveLength(0);for(const file of cloud.files.values())expect(file.bytes.includes(Buffer.from('原创'))).toBe(false);const size=cloud.files.size;await a.run();await b.run();expect(cloud.files.size).toBe(size);}));
  it('retains both offline branches and resolves by creating an explicit merged descendant',()=>using(async(a,b,la,lb)=>{const id=randomUUID(),key='note:'+id;la.values[key]=note(id,'原文');await a.run();await b.run();la.values[key]=note(id,'电脑 A 修改');lb.values[key]=note(id,'电脑 B 修改');await a.run();await b.run();await a.run();expect((la.values[key] as any).body).toBe('电脑 A 修改');expect((lb.values[key] as any).body).toBe('电脑 B 修改');const [[conflictKey,versions]]=await a.conflicts();await a.resolve(conflictKey!,versions!.map(v=>v.id),undefined,true);await a.run();await b.run();expect(await b.conflicts()).toHaveLength(0);expect(Object.values(lb.values).map(v=>(v as any).body).sort()).toEqual(['电脑 A 修改','电脑 B 修改']);}));
  it('does not let deletion silently overwrite an offline edit',()=>using(async(a,b,la,lb)=>{const id=randomUUID(),key='note:'+id;la.values[key]=note(id,'原文');await a.run();await b.run();delete la.values[key];lb.values[key]=note(id,'离线补充');await a.run();await b.run();expect((lb.values[key] as any).body).toBe('离线补充');expect((await b.conflicts())[0]![1].some(v=>v.value===null)).toBe(true);}));
  it('retries an ambiguous completed upload with the same cloud object ID',()=>using(async(a,b,la,lb,cloud)=>{const id=randomUUID();la.values['note:'+id]=note(id,'不会重复上传');cloud.failAfterCommit=true;await expect(a.run()).rejects.toThrow('connection dropped');expect((await a.read()).pending).toHaveLength(1);await a.run();expect(cloud.files.size).toBe(1);await b.run();expect(lb.values).toEqual(la.values);}));
  it('retains a local edit that races a downloaded version',()=>using(async(a,b,la,lb)=>{const id=randomUUID(),key='note:'+id;la.values[key]=note(id,'共同版本');await a.run();await b.run();la.values[key]=note(id,'来自 A');await a.run();lb.race=()=>{lb.values[key]=note(id,'B 正在输入');};await b.run();expect((lb.values[key] as any).body).toBe('B 正在输入');await b.run();expect(await b.conflicts()).toHaveLength(1);}));
  it('rejects changed history without clearing the local library',()=>using(async(a,b,la,lb,cloud)=>{const id=randomUUID();la.values['note:'+id]=note(id,'原始内容');await a.run();await b.run();const file=[...cloud.files.values()][0]!;file.file.appProperties!.hash='0'.repeat(64);cloud.changesLog.push({id:file.file.id});await expect(b.run()).rejects.toThrow('历史');expect(lb.values).toEqual(la.values);}));
  it('rejects cycles and missing parents rather than treating them as deletion',()=>{const a=randomUUID(),b=randomUUID(),deviceId=randomUUID(),base={key:'note:'+randomUUID(),deviceId,deviceName:'测试',sequence:1,createdAt:new Date().toISOString(),hash:digest(null),value:null};const records:Record<string,SyncVersion>={[a]:{...base,id:a,parents:[b]},[b]:{...base,id:b,parents:[a]}};expect(()=>heads(records)).toThrow('循环');delete records[b];expect(()=>heads(records)).toThrow('依赖');});
});
