import {createServer,type Server} from 'node:http';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {z} from 'zod';
import {googleClientSchema,type GoogleClient} from '../../shared/sync.js';
import type {CredentialStore} from './credential-store.js';
import type {ReaderStore} from '../store.js';

export const GOOGLE_SCOPE='openid email https://www.googleapis.com/auth/drive.appdata';
const tokenSchema=z.object({accessToken:z.string().min(1),refreshToken:z.string().min(1),expiresAt:z.number(),accountId:z.string().min(1).max(256),email:z.string().max(320)});
const secretsSchema=z.object({version:z.literal(1),deviceId:z.string().uuid(),client:googleClientSchema,tokens:tokenSchema.optional(),vaultKeys:z.record(z.string(),z.string()).default({})});
export type GoogleSecrets=z.infer<typeof secretsSchema>;
type Fetch=typeof fetch;
export class GoogleAuth {
  private server?:Server;
  private timer?:ReturnType<typeof setTimeout>;
  private pending?:{state:string;verifier:string;redirect:string};
  private generation=0;
  error?:string;
  constructor(private store:ReaderStore,private credentials:CredentialStore,private http:Fetch=fetch){}
  async read():Promise<GoogleSecrets|undefined>{const raw=await this.credentials.read();return raw?secretsSchema.parse(JSON.parse(raw)):undefined;}
  private async save(value:GoogleSecrets){await this.credentials.write(JSON.stringify(secretsSchema.parse(value)));}
  async configure(client:GoogleClient){await this.store.locked('sync-auth',async()=>{const old=await this.read();if(old?.tokens)throw Error('请先断开当前 Google Drive 账户');await this.save({version:1,deviceId:old?.deviceId??randomUUID(),client:googleClientSchema.parse(client),vaultKeys:old?.vaultKeys??{}});});this.error=undefined;}
  async key(vaultId:string){return (await this.read())?.vaultKeys[vaultId];}
  async saveKey(vaultId:string,key:string){await this.store.locked('sync-auth',async()=>{const secrets=await this.read();if(!secrets)throw Error('请先配置 Google 客户端');secrets.vaultKeys[vaultId]=key;await this.save(secrets);});}
  async disconnect(){await this.cancel();await this.store.locked('sync-auth',async()=>{const secrets=await this.read();if(secrets){delete secrets.tokens;await this.save(secrets);}});this.error=undefined;}
  get authorizing(){return !!this.server;}
  async cancel(){this.generation++;this.pending=undefined;clearTimeout(this.timer);const server=this.server;this.server=undefined;if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}}
  private async json(url:string,init:RequestInit){const response=await this.http(url,{...init,redirect:'error',signal:AbortSignal.timeout(25000)});if(!response.ok){if(response.status===400||response.status===401)throw Error('Google 授权已失效或客户端配置无效，请重新连接');throw Error('Google 授权服务暂不可用');}const text=await response.text();if(text.length>1024*1024)throw Error('Google 授权响应过大');return JSON.parse(text);}
  async token():Promise<string>{
    return this.store.locked('sync-auth',async()=>{const secrets=await this.read();if(!secrets?.tokens)throw Error('请先连接 Google Drive');if(secrets.tokens.expiresAt>Date.now()+60000)return secrets.tokens.accessToken;
      const form=new URLSearchParams({grant_type:'refresh_token',refresh_token:secrets.tokens.refreshToken,client_id:secrets.client.clientId,...(secrets.client.clientSecret?{client_secret:secrets.client.clientSecret}:{})});
      const result=await this.json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
      if(typeof result.access_token!=='string'||(!Number.isFinite(result.expires_in)||result.expires_in<=0))throw Error('Google 授权响应无效');secrets.tokens={...secrets.tokens,accessToken:result.access_token,refreshToken:result.refresh_token??secrets.tokens.refreshToken,expiresAt:Date.now()+Math.min(result.expires_in,86400)*1000};await this.save(secrets);return secrets.tokens.accessToken;
    });
  }
  async authorize():Promise<{url:string}>{
    await this.cancel();const generation=this.generation,secrets=await this.read();if(!secrets)throw Error('请先导入 Google 桌面客户端配置');this.error=undefined;
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    const server=createServer((request,response)=>{void (async()=>{
      response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','text/plain; charset=utf-8');response.setHeader('X-Content-Type-Options','nosniff');
      const pending=this.pending,parsed=new URL(request.url??'/',pending?.redirect??'http://127.0.0.1');
      const received=parsed.searchParams.get('state')??'';
      if(request.method!=='GET'||parsed.pathname!=='/oauth/callback'||!pending||received.length!==pending.state.length||!timingSafeEqual(Buffer.from(received),Buffer.from(pending.state))){response.statusCode=400;response.end('授权请求无效。');return;}
      this.pending=undefined;clearTimeout(this.timer);
      try{
        const code=parsed.searchParams.get('code');if(parsed.searchParams.has('error')||!code||code.length>4096)throw Error('Google 授权未完成');
        const form=new URLSearchParams({grant_type:'authorization_code',code,client_id:secrets.client.clientId,redirect_uri:pending.redirect,code_verifier:pending.verifier,...(secrets.client.clientSecret?{client_secret:secrets.client.clientSecret}:{})});
        const result=await this.json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
        if(typeof result.access_token!=='string'||typeof result.refresh_token!=='string'||(!Number.isFinite(result.expires_in)||result.expires_in<=0)||!String(result.scope??'').split(' ').includes('https://www.googleapis.com/auth/drive.appdata'))throw Error('Google 没有授予持续同步所需的权限，请重新连接');
        const user=await this.json('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+result.access_token}});
        await this.store.locked('sync-auth',async()=>{const current=await this.read();if(generation!==this.generation||!current||current.client.clientId!==secrets.client.clientId)throw Error('授权已取消或客户端配置变化');current.tokens=tokenSchema.parse({accessToken:result.access_token,refreshToken:result.refresh_token,expiresAt:Date.now()+Math.min(result.expires_in,86400)*1000,accountId:user.sub,email:user.email??''});await this.save(current);});
        response.end('Google Drive 已连接，可以关闭此页并返回 Reader。');
      }catch(error){if(generation===this.generation)this.error=error instanceof Error?error.message:'Google 授权未完成';response.statusCode=400;response.end('授权未完成，请返回 Reader 查看提示。');}
      finally{server.close();if(this.server===server)this.server=undefined;}
    })().catch(()=>{response.statusCode=500;response.end('授权服务错误，请返回 Reader 重试。');});});
    this.server=server;await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('无法创建本地授权回调');
    const redirect=`http://127.0.0.1:${address.port}/oauth/callback`;this.pending={state,verifier,redirect};this.timer=setTimeout(()=>{this.error='授权等待已过期，请重新连接';void this.cancel();},10*60*1000);this.timer.unref();
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:secrets.client.clientId,redirect_uri:redirect,response_type:'code',scope:GOOGLE_SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return {url:url.href};
  }
}

/** Fixed executable + URL argument; OAuth tokens and client secrets never enter argv. */
export async function openSystemBrowser(url:string){if(new URL(url).origin!=='https://accounts.google.com')throw Error('授权地址无效');const executable=process.platform==='win32'?join(process.env.SystemRoot??'C:\\Windows','System32','rundll32.exe'):process.platform==='darwin'?'/usr/bin/open':'/usr/bin/xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];await new Promise<void>((resolve,reject)=>{const child=spawn(executable,args,{stdio:'ignore',windowsHide:true});child.once('error',()=>reject(Error('无法打开系统浏览器，请复制授权链接')));child.once('spawn',()=>{child.unref();resolve();});});}
