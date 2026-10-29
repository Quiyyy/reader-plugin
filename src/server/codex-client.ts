import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access } from 'node:fs/promises';
import { delimiter, dirname, join, isAbsolute } from 'node:path';

export interface CodexTransport { request(method:string,params?:unknown):Promise<any>; onEvent(listener:(method:string,params:any)=>void):()=>void; onRequest?: (method:string,params:any)=>Promise<unknown>; close():void|Promise<void>; }
async function available(path:string){try{await access(path);return true;}catch{return false;}}
export async function codexCommand():Promise<{command:string;args:string[]}>{
  const configured=process.env.READER_CODEX_PATH;
  if(configured){if(!isAbsolute(configured)||!await available(configured))throw Error('配置的 Codex 程序不存在');if(/\.m?js$/i.test(configured))return {command:process.execPath,args:[configured]};if(process.platform==='win32'&&!/\.exe$/i.test(configured))throw Error('请选择 Codex .exe 或官方 codex.js 入口');return {command:configured,args:[]};}
  const paths=[dirname(process.execPath),...(process.env.PATH??'').split(delimiter)];
  for(const path of paths){if(!path)continue;const script=join(path,'node_modules','@openai','codex','bin','codex.js');if(await available(script))return {command:process.execPath,args:[script]};const binary=join(path,process.platform==='win32'?'codex.exe':'codex');if(await available(binary))return {command:binary,args:[]};}
  throw Error('未找到 Codex。请安装官方 Codex CLI 并登录，或在高级配置中设置 READER_CODEX_PATH。');
}
/** Dedicated documented stdio client. Never connects to a private desktop pipe. */
export class CodexClient implements CodexTransport {
  private child?:ChildProcessWithoutNullStreams;private started?:Promise<void>;private sequence=0;
  private closed=false;private closing?:Promise<void>;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  private listeners=new Set<(method:string,params:any)=>void>();
  onRequest?: (method:string,params:any)=>Promise<unknown>;
  onEvent(listener:(method:string,params:any)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  async start(){if(this.closed)throw Error('Codex 连接已关闭');if(this.started)return this.started;this.started=(async()=>{const {command,args}=await codexCommand();if(this.closed)throw Error('Codex 连接已关闭');const child=spawn(command,[...args,'app-server','--stdio','--disable','shell_tool','--disable','unified_exec','--disable','multi_agent','--disable','apps','--disable','code_mode','-c','web_search="disabled"'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:''}});this.child=child;child.stderr.resume();
    const fail=(message:string)=>{if(this.child!==child)return;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();this.child=undefined;this.started=undefined;for(const listener of this.listeners)listener('reader/disconnected',{message});};
    child.on('error',()=>fail('无法启动 Codex，请检查安装和连接设置'));child.on('exit',()=>fail('Codex 连接已关闭，当前草稿与历史仍保留'));
    createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{if(this.child!==child)return;if(line.length>8*1024*1024){void this.close();return;}let data:any;try{data=JSON.parse(line);}catch{return;}
      if(data.id!==undefined&&data.method){void this.handle(data);return;}if(data.id!==undefined){const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);if(data.error)p.reject(Error(String(data.error.message??'Codex 请求失败')));else p.resolve(data.result);return;}
      if(data.method)for(const listener of this.listeners)listener(data.method,data.params??{});
    });
    await this.send('initialize',{clientInfo:{name:'reader_study',title:'Reader',version:'0.2.10'},capabilities:{experimentalApi:true}});this.notify('initialized',{});
  })();try{await this.started;}catch(e){await this.close();throw e;}}
  private notify(method:string,params:unknown){this.child?.stdin.write(JSON.stringify({method,params})+'\n');}
  private send(method:string,params:unknown):Promise<any>{return new Promise((resolve,reject)=>{if(!this.child){reject(Error('Codex 未连接'));return;}const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex 响应超时，请重试连接'));},30000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(Error('Codex 连接已断开'));}});});}
  async request(method:string,params:unknown={}){await this.start();return this.send(method,params);}
  private async handle(data:any){try{let result:unknown;if(data.method==='item/tool/call')result=await this.onRequest?.(data.method,data.params);else if(data.method==='item/permissions/requestApproval')result={permissions:{},scope:'turn'};else if(data.method.endsWith('requestApproval'))result={decision:'decline'};else if(data.method==='item/tool/requestUserInput')result={answers:{}};else{this.child?.stdin.write(JSON.stringify({id:data.id,error:{code:-32601,message:'Reader only supports its scoped reading tools'}})+'\n');return;}this.child?.stdin.write(JSON.stringify({id:data.id,result:result??{success:false,contentItems:[{type:'inputText',text:'Reader 工具不可用'}]}})+'\n');}catch(error){this.child?.stdin.write(JSON.stringify({id:data.id,result:{success:false,contentItems:[{type:'inputText',text:error instanceof Error?error.message:'Reader 操作失败'}]}})+'\n');}}
  close():Promise<void>{
    if(this.closing)return this.closing;
    this.closed=true;const child=this.child;this.child=undefined;this.started=undefined;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Codex 连接已关闭'));}this.pending.clear();
    this.closing=!child||child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>child.kill(),1500);timer.unref();
      child.once('exit',done);child.once('error',done);child.stdin.end();
    });
    return this.closing;
  }
}
