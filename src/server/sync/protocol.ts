import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {z} from 'zod';

export const MAX_OBJECT_BYTES=68*1024*1024;
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const itemKeySchema=z.string().max(240).regex(/^(note|folder|annotation|source|bookmeta|bot|bot-default|preferences|book|position|bookmark|epub-bookmark):[a-zA-Z0-9_.:-]+$/);
export const assetSchema=z.object({kind:z.enum(['image','book']),id:hash,format:z.enum(['png','txt','epub','pdf']),bytes:z.number().int().min(1).max(64*1024*1024),objectKey:hash,fileId:z.string().regex(/^[\w-]{1,200}$/)}).strict();
export type SyncAsset=z.infer<typeof assetSchema>;
export type LocalAsset=Omit<SyncAsset,'objectKey'|'fileId'>;
export const versionSchema=z.object({id:uuid,key:itemKeySchema,parents:z.array(uuid).max(128),deviceId:uuid,deviceName:z.string().min(1).max(80),sequence:z.number().int().positive(),createdAt:z.string().datetime(),hash,value:z.json().nullable()}).strict();
export type SyncVersion=z.infer<typeof versionSchema>;
export const commitSchema=z.object({version:z.literal(1),vaultId:uuid,id:uuid,versions:z.array(versionSchema).min(1).max(20000),assets:z.array(assetSchema).max(20000)}).strict();
export type SyncCommit=z.infer<typeof commitSchema>;
export const vaultSchema=z.object({version:z.literal(1),id:uuid,name:z.string().min(1).max(80),createdAt:z.string().datetime()}).strict();

export function canonical(value:unknown):string {
  if(value===undefined)return 'null';
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
export const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export const bytesHash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const objectKey=(key:Uint8Array,kind:string,id:string)=>createHmac('sha256',key).update(kind+':'+id).digest('hex');
export function recoveryKey(vaultId:string,key:Uint8Array){return 'reader-sync-1.'+uuid.parse(vaultId)+'.'+Buffer.from(key).toString('base64url');}
export function parseRecoveryKey(input:string){const parts=input.trim().split('.');if(parts.length!==3||parts[0]!=='reader-sync-1'||!uuid.safeParse(parts[1]).success||!/^[-\w]{43}$/.test(parts[2]!))throw Error('恢复密钥格式无效');const key=Buffer.from(parts[2]!,'base64url');if(key.length!==32)throw Error('恢复密钥格式无效');return {vaultId:parts[1]!,key};}
export function newVaultKey(){const id=randomUUID(),key=randomBytes(32);return {id,key,recoveryKey:recoveryKey(id,key)};}
export function seal(key:Uint8Array,context:string,bytes:Uint8Array):Buffer {
  if(key.length!==32||bytes.length>MAX_OBJECT_BYTES)throw Error('同步对象超过范围');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(context));
  const encrypted=Buffer.concat([cipher.update(deflateRawSync(bytes)),cipher.final()]);
  return Buffer.concat([Buffer.from('RDS1'),nonce,cipher.getAuthTag(),encrypted]);
}
export function unseal(key:Uint8Array,context:string,bytes:Uint8Array):Buffer {
  const data=Buffer.from(bytes);if(key.length!==32||data.length<33||data.length>MAX_OBJECT_BYTES+1024||data.subarray(0,4).toString()!=='RDS1')throw Error('同步对象格式无效');
  try{const cipher=createDecipheriv('aes-256-gcm',key,data.subarray(4,16));cipher.setAAD(Buffer.from(context));cipher.setAuthTag(data.subarray(16,32));return inflateRawSync(Buffer.concat([cipher.update(data.subarray(32)),cipher.final()]),{maxOutputLength:MAX_OBJECT_BYTES});}
  catch{throw Error('同步数据无法解密或校验失败，请检查恢复密钥');}
}
export function heads(versions:Record<string,SyncVersion>):Map<string,SyncVersion[]> {
  const parentIds=new Set<string>();
  for(const version of Object.values(versions))for(const parentId of version.parents){const parent=versions[parentId];if(!parent||parent.key!==version.key||parentId===version.id)throw Error('云端版本依赖不完整');parentIds.add(parentId);}
  // Reject cycles, including malicious records which would otherwise hide every head.
  const counts=new Map<string,number>(),children=new Map<string,string[]>(),ready:string[]=[];
  for(const record of Object.values(versions)){counts.set(record.id,record.parents.length);if(!record.parents.length)ready.push(record.id);for(const parent of record.parents){const list=children.get(parent)??[];list.push(record.id);children.set(parent,list);}}
  let visited=0;while(ready.length){const id=ready.pop()!;visited++;for(const child of children.get(id)??[]){const count=counts.get(child)!-1;counts.set(child,count);if(!count)ready.push(child);}}if(visited!==Object.keys(versions).length)throw Error('同步版本存在循环');
  const result=new Map<string,SyncVersion[]>();for(const version of Object.values(versions))if(!parentIds.has(version.id)){const list=result.get(version.key)??[];list.push(version);result.set(version.key,list);}
  for(const list of result.values())list.sort((a,b)=>a.id.localeCompare(b.id));return result;
}
export function validateCommit(input:unknown,vaultId:string):SyncCommit {
  const commit=commitSchema.parse(input);if(commit.vaultId!==vaultId)throw Error('同步书库标识不一致');
  if(new Set(commit.versions.map(v=>v.id)).size!==commit.versions.length)throw Error('同步版本重复');
  for(const version of commit.versions)if(digest(version.value)!==version.hash||new Set(version.parents).size!==version.parents.length)throw Error('同步内容校验失败');
  return commit;
}
