import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {atomicWrite} from '../store.js';

export interface CredentialStore {read():Promise<string|undefined>;write(value:string):Promise<void>;remove():Promise<void>;}
function command(executable:string,args:string[],input=''):Promise<string>{
  return new Promise((resolve,reject)=>{let output='',failed=false;const child=spawn(executable,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});const timer=setTimeout(()=>{failed=true;child.kill();reject(Error('安全凭据存储响应超时'));},10000);
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2*1024*1024){failed=true;child.kill();}});child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('当前系统的安全凭据存储不可用'));});child.on('exit',code=>{clearTimeout(timer);if(!failed&&code===0)resolve(output.trim());else reject(Error('无法访问系统安全凭据存储'));});child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
export class SystemCredentialStore implements CredentialStore {
  private readonly account:string;
  private readonly path:string;
  private cached?:{hash:string;value:string};
  constructor(dataDir:string){this.account=createHash('sha256').update(process.platform==='win32'?resolve(dataDir).toLowerCase():resolve(dataDir)).digest('hex');this.path=join(process.env.LOCALAPPDATA??join(homedir(),'.local','share'),'ReaderCredentials',this.account+'.bin');}
  private async dpapi(action:'Protect'|'Unprotect',value:string){
    const ps=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $v=[Security.Cryptography.ProtectedData]::${action}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($v))`;
    return command(ps,['-NoProfile','-NonInteractive','-Command',script],value);
  }
  async read(){
    if(process.platform==='win32'){let bytes:Buffer;try{bytes=await fs.readFile(this.path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){this.cached=undefined;return;}throw e;}const hash=createHash('sha256').update(bytes).digest('hex');if(this.cached?.hash===hash)return this.cached.value;const value=Buffer.from(await this.dpapi('Unprotect',bytes.toString('base64')),'base64').toString('utf8');this.cached={hash,value};return value;}
    try{const encoded=process.platform==='darwin'?await command('/usr/bin/security',['find-generic-password','-s','Reader Google Drive','-a',this.account,'-w']):await command('/usr/bin/secret-tool',['lookup','app','reader-google-drive','profile',this.account]);return encoded?Buffer.from(encoded,'base64').toString('utf8'):undefined;}catch{return undefined;}
  }
  async write(value:string){
    if(process.platform==='win32'){const encrypted=Buffer.from(await this.dpapi('Protect',Buffer.from(value).toString('base64')),'base64');await fs.mkdir(join(this.path,'..'),{recursive:true,mode:0o700});await atomicWrite(this.path,encrypted);this.cached={hash:createHash('sha256').update(encrypted).digest('hex'),value};return;}
    const encoded=Buffer.from(value).toString('base64');
    if(process.platform==='darwin')await command('/usr/bin/security',['-i'],`add-generic-password -U -s "Reader Google Drive" -a "${this.account}" -w "${encoded}"\n`);
    else await command('/usr/bin/secret-tool',['store','--label=Reader Google Drive','app','reader-google-drive','profile',this.account],encoded);
  }
  async remove(){if(process.platform==='win32'){await fs.rm(this.path,{force:true});return;}if(process.platform==='darwin')await command('/usr/bin/security',['delete-generic-password','-s','Reader Google Drive','-a',this.account]);else await command('/usr/bin/secret-tool',['clear','app','reader-google-drive','profile',this.account]);}
}
