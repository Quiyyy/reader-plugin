import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import type {CredentialStore} from '../src/server/sync/credential-store.js';
import type {CloudProvider,DriveFile,ObjectInfo} from '../src/server/sync/google-drive.js';
import {bytesHash} from '../src/server/sync/protocol.js';
export class MemoryCredentials implements CredentialStore {
  value?:string;
  async read(){return this.value;}
  async write(value:string){this.value=value;}
  async remove(){this.value=undefined;}
  connect(accountId='original-test-account'){this.value=JSON.stringify({version:1,deviceId:randomUUID(),client:{clientId:'reader-fixture.apps.googleusercontent.com'},tokens:{accessToken:'fixture-access-token',refreshToken:'fixture-refresh-token',expiresAt:Date.now()+3600000,accountId,email:'reader-fixture@example.invalid'},vaultKeys:{}});}
}
export class MemoryCloud implements CloudProvider {
  files=new Map<string,{bytes:Buffer;file:DriveFile}>();
  events:{id:string;removed?:boolean}[]=[];
  async allocate(){return randomUUID();}
  async put(id:string,bytes:Buffer,info:ObjectInfo){const prior=this.files.get(id);if(prior){assert.deepEqual(prior.bytes,bytes);return;}this.files.set(id,{bytes:Buffer.from(bytes),file:{id,size:String(bytes.length),appProperties:{readerSync:'1',vaultId:info.vaultId,kind:info.kind,key:info.key,hash:bytesHash(bytes)}}});this.events.push({id});}
  async metadata(id:string){const file=this.files.get(id);if(!file)throw Error('云端同步数据不存在，已保留本地内容');return file.file;}
  async get(id:string){await this.metadata(id);return Buffer.from(this.files.get(id)!.bytes);}
  async vaults(){return [...this.files.values()].map(value=>value.file).filter(file=>file.appProperties?.kind==='vault');}
  async changes(vaultId:string,cursor?:string){const changes=this.events.slice(Number(cursor??0));return {files:changes.filter(value=>!value.removed).map(value=>this.files.get(value.id)!.file).filter(file=>file.appProperties?.vaultId===vaultId),removed:changes.filter(value=>value.removed).map(value=>value.id),cursor:String(this.events.length)};}
}
