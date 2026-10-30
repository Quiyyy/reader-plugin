import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {atomicWrite} from '../store.js';
import {seal,unseal} from './protocol.js';

export interface UploadSession {url:string;hash:string;bytes:number;}
export interface UploadSessions {read(vaultId:string,id:string):Promise<UploadSession|undefined>;write(vaultId:string,id:string,value:UploadSession):Promise<void>;remove(vaultId:string,id:string):Promise<void>;}
const schema=z.object({url:z.string().url().max(8192),hash:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive()}).strict();
export class EncryptedUploadSessions implements UploadSessions {
  constructor(private directory:string,private getKey:(vaultId:string)=>Promise<string|undefined>){}
  private path(vaultId:string,id:string){return join(this.directory,z.string().uuid().parse(vaultId)+'-'+z.string().regex(/^[\w-]{1,200}$/).parse(id)+'.bin');}
  private async key(vaultId:string){const encoded=await this.getKey(vaultId);if(!encoded)throw Error('恢复密钥不可用');return Buffer.from(encoded,'base64url');}
  async read(vaultId:string,id:string){let bytes:Buffer;try{bytes=await fs.readFile(this.path(vaultId,id));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}return schema.parse(JSON.parse(unseal(await this.key(vaultId),vaultId+':upload:'+id,bytes).toString('utf8')));}
  async write(vaultId:string,id:string,value:UploadSession){await fs.mkdir(this.directory,{recursive:true,mode:0o700});await atomicWrite(this.path(vaultId,id),seal(await this.key(vaultId),vaultId+':upload:'+id,Buffer.from(JSON.stringify(schema.parse(value)))));}
  async remove(vaultId:string,id:string){await fs.rm(this.path(vaultId,id),{force:true});}
}
