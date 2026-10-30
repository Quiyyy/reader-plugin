import {z} from 'zod';
import {setTimeout as delay} from 'node:timers/promises';
import {bytesHash,MAX_OBJECT_BYTES} from './protocol.js';
import type {UploadSessions} from './upload-sessions.js';

const fileSchema=z.object({id:z.string().regex(/^[\w-]{1,200}$/),name:z.string().optional(),size:z.string().optional(),appProperties:z.record(z.string(),z.string()).optional()});
export type DriveFile=z.infer<typeof fileSchema>;
export interface ObjectInfo {vaultId:string;kind:'vault'|'asset'|'commit';key:string;}
export interface ObjectPage {files:DriveFile[];removed:string[];cursor:string;full?:boolean;}
export interface CloudProvider {
  allocate():Promise<string>;
  put(id:string,data:Buffer,info:ObjectInfo,signal?:AbortSignal):Promise<void>;
  get(id:string,signal?:AbortSignal):Promise<Buffer>;
  metadata(id:string,signal?:AbortSignal):Promise<DriveFile>;
  vaults(signal?:AbortSignal):Promise<DriveFile[]>;
  changes(vaultId:string,cursor?:string,signal?:AbortSignal):Promise<ObjectPage>;
}
export class GoogleDrive implements CloudProvider {
  constructor(private token:()=>Promise<string>,private http:typeof fetch=fetch,private sessions?:UploadSessions){}
  private async request(path:string,init:RequestInit={},signal?:AbortSignal):Promise<Response>{
    const url=path.startsWith('https://')?new URL(path):new URL(path,'https://www.googleapis.com');if(url.origin!=='https://www.googleapis.com'||!/^\/(?:drive\/v3|upload\/drive\/v3)\//.test(url.pathname))throw Error('Google Drive 响应地址无效');
    for(let attempt=0;attempt<4;attempt++){
      const response=await this.http(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:'Bearer '+await this.token()},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
      if(response.status===429||response.status>=500){if(attempt===3)throw Error('Google Drive 暂时繁忙，请稍后重试');await response.body?.cancel();await delay(Math.min(8000,Math.max(500,Number(response.headers.get('retry-after')??0)*1000||500*2**attempt)),undefined,{signal});continue;}
      if(response.status===401)throw Error('Google Drive 授权已失效，请重新连接');if(response.status===403)throw Error('Google Drive 权限或存储配额不足');return response;
    }throw Error('Google Drive 请求失败');
  }
  private async json(response:Response){if(!response.ok)throw Error(response.status===404?'云端同步数据不存在，已保留本地内容':`Google Drive 请求失败 (${response.status})`);const text=await response.text();if(text.length>8*1024*1024)throw Error('Google Drive 元数据过大');return JSON.parse(text);}
  async allocate(){const value=await this.json(await this.request('/drive/v3/files/generateIds?count=1&space=appDataFolder&type=files'));return z.string().regex(/^[\w-]{1,200}$/).parse(value.ids?.[0]);}
  async metadata(id:string,signal?:AbortSignal){return fileSchema.parse(await this.json(await this.request('/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,size,appProperties',{},signal)));}
  async get(id:string,signal?:AbortSignal){const response=await this.request('/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',{},signal);if(!response.ok)throw Error(response.status===404?'云端同步数据不存在，已保留本地内容':'无法下载 Google Drive 同步数据');const chunks:Buffer[]=[];let size=0;if(!response.body)throw Error('云端文件为空');for await(const chunk of response.body as any){size+=chunk.length;if(size>MAX_OBJECT_BYTES+1024)throw Error('云端文件超过大小限制');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
  async put(id:string,data:Buffer,info:ObjectInfo,signal?:AbortSignal){
    const expectedHash=bytesHash(data);const metadata={id,name:`reader-${info.kind}-${info.key}`,parents:['appDataFolder'],mimeType:'application/octet-stream',appProperties:{readerSync:'1',vaultId:info.vaultId,kind:info.kind,key:info.key,hash:expectedHash}};
    let location:string|undefined,offset=0,attempts=0;const saved=await this.sessions?.read(info.vaultId,id);
    if(saved){if(saved.hash!==expectedHash||saved.bytes!==data.length)throw Error('待上传内容与续传记录不一致');const probe=await this.request(saved.url,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${data.length}`}},signal);if(probe.ok){const result=await this.json(probe);if(result.id!==id)throw Error('Google Drive 上传对象不一致');await this.sessions?.remove(info.vaultId,id);return;}if(probe.status===308){location=saved.url;const range=/^bytes=0-(\d+)$/.exec(probe.headers.get('range')??'');offset=range?Number(range[1])+1:0;if(offset>=data.length)throw Error('Google Drive 尚未确认上传完成');}else if(probe.status!==404&&probe.status!==410)throw Error('无法恢复 Google Drive 上传');}
    if(!location){const start=await this.request('/upload/drive/v3/files?uploadType=resumable&fields=id',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(data.length)},body:JSON.stringify(metadata)},signal);
      if(start.status===409){const old=await this.metadata(id,signal);if(old.appProperties?.hash!==expectedHash||old.appProperties?.vaultId!==info.vaultId||old.appProperties?.key!==info.key||Number(old.size)!==data.length)throw Error('云端对象发生冲突');await this.sessions?.remove(info.vaultId,id);return;}
      if(!start.ok)throw Error('无法创建 Google Drive 上传会话');location=start.headers.get('location')??undefined;if(!location)throw Error('Google Drive 上传地址缺失');await this.sessions?.write(info.vaultId,id,{url:location,hash:expectedHash,bytes:data.length});}
    while(offset<data.length){const end=Math.min(data.length,offset+1024*1024);let response:Response;
      try{response=await this.request(location,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(end-offset),'Content-Range':`bytes ${offset}-${end-1}/${data.length}`},body:new Uint8Array(data.subarray(offset,end))},signal);}catch(error){if(signal?.aborted||++attempts>3)throw error;response=await this.request(location,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${data.length}`}},signal);}
      if(response.ok){const result=await this.json(response);if(result.id!==id)throw Error('Google Drive 上传对象不一致');await this.sessions?.remove(info.vaultId,id);return;}if(response.status!==308)throw Error('Google Drive 上传未完成');const range=/^bytes=0-(\d+)$/.exec(response.headers.get('range')??'');const next=range?Number(range[1])+1:0;if(next<0||next>=data.length||next<=offset&&++attempts>3)throw Error('Google Drive 上传进度无效');offset=next;
    }
  }
  private async list(query:string,signal?:AbortSignal){const result:DriveFile[]=[];let pageToken:string|undefined;do{const queryString=new URLSearchParams({spaces:'appDataFolder',q:query,pageSize:'1000',fields:'nextPageToken,files(id,name,size,appProperties)',...(pageToken?{pageToken}:{})});const value=await this.json(await this.request('/drive/v3/files?'+queryString,{},signal));result.push(...z.array(fileSchema).parse(value.files));pageToken=value.nextPageToken;if(result.length>50000)throw Error('云端同步记录过多，请先整理历史');}while(pageToken);return result;}
  vaults(signal?:AbortSignal){return this.list("appProperties has { key='readerSync' and value='1' } and appProperties has { key='kind' and value='vault' }",signal);}
  async changes(vaultId:string,cursor?:string,signal?:AbortSignal):Promise<ObjectPage>{
    if(!cursor){const token=await this.json(await this.request('/drive/v3/changes/startPageToken',{},signal));const files=await this.list(`appProperties has { key='readerSync' and value='1' } and appProperties has { key='vaultId' and value='${z.string().uuid().parse(vaultId)}' }`,signal);return {files,removed:[],cursor:z.string().parse(token.startPageToken),full:true};}
    const files:DriveFile[]=[],removed:string[]=[];let pageToken:string|undefined=cursor,newToken=cursor;
    do{const query=new URLSearchParams({pageToken,spaces:'appDataFolder',includeRemoved:'true',pageSize:'1000',fields:'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,size,appProperties))'});const response=await this.request('/drive/v3/changes?'+query,{},signal);if(response.status===410)return this.changes(vaultId,undefined,signal);const result=await this.json(response);for(const change of z.array(z.object({fileId:z.string(),removed:z.boolean().optional(),file:fileSchema.optional()})).parse(result.changes)){if(change.removed)removed.push(change.fileId);else if(change.file?.appProperties?.readerSync==='1'&&change.file.appProperties.vaultId===vaultId)files.push(change.file);}if(files.length+removed.length>50000)throw Error('云端变化过多，请重新连接书库');pageToken=result.nextPageToken;if(result.newStartPageToken)newToken=result.newStartPageToken;}while(pageToken);
    return {files,removed,cursor:newToken};
  }
}
