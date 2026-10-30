import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {ReaderStore} from '../src/server/store.js';
import {GoogleAuth,GOOGLE_SCOPE} from '../src/server/sync/google-auth.js';
import {GoogleDrive} from '../src/server/sync/google-drive.js';
import {EncryptedUploadSessions} from '../src/server/sync/upload-sessions.js';
import {MemoryCredentials} from './sync-fixtures';
import {SystemCredentialStore} from '../src/server/sync/credential-store.js';
import {bytesHash} from '../src/server/sync/protocol.js';

const json=(value:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
describe('Google OAuth and Drive transport',()=>{
  it('cannot restore credentials when an in-flight authorization is cancelled',async()=>{
    const root=await mkdtemp(join(tmpdir(),'Reader cancelled OAuth ')),credentials=new MemoryCredentials();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
    const fake:typeof fetch=async(input)=>{if(String(input).endsWith('/token')){entered();await gate;return json({access_token:'cancelled-access',refresh_token:'cancelled-refresh',expires_in:3600,scope:GOOGLE_SCOPE});}return json({sub:'fixture-account'});};const auth=new GoogleAuth(new ReaderStore(root),credentials,fake);
    try{await auth.configure({clientId:'fixture.apps.googleusercontent.com'});const login=new URL((await auth.authorize()).url),callback=new URL(login.searchParams.get('redirect_uri')!);callback.search=new URLSearchParams({state:login.searchParams.get('state')!,code:'fixture'}).toString();const request=fetch(callback).catch(()=>undefined);await started;expect(auth.authorizing).toBe(true);await auth.cancel();release();await request;await new Promise(resolve=>setTimeout(resolve,50));expect((await auth.read())!.tokens).toBeUndefined();expect(auth.error).toBeUndefined();}finally{release?.();await auth.cancel();await rm(root,{recursive:true,force:true});}
  });
  it('uses a loopback callback, state and PKCE; refresh credentials stay in the credential store',async()=>{
    const root=await mkdtemp(join(tmpdir(),'Reader OAuth ')),credentials=new MemoryCredentials();let verifier='',refreshes=0;
    const fake:typeof fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/token')){const form=new URLSearchParams(String(init?.body));if(form.get('grant_type')==='refresh_token'){refreshes++;return json({access_token:'new-access',expires_in:3600});}verifier=form.get('code_verifier')!;return json({access_token:'first-access',refresh_token:'private-refresh',expires_in:3600,scope:GOOGLE_SCOPE});}expect(url).toBe('https://openidconnect.googleapis.com/v1/userinfo');return json({sub:'fixture-account',email:'fixture@example.invalid'});};
    const auth=new GoogleAuth(new ReaderStore(root),credentials,fake);
    try{await auth.configure({clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-secret'});const {url}=await auth.authorize(),login=new URL(url),redirect=login.searchParams.get('redirect_uri')!;expect(new URL(redirect).hostname).toBe('127.0.0.1');expect(login.searchParams.get('scope')).toBe(GOOGLE_SCOPE);expect((await fetch(redirect+'?state=wrong&code=fixture')).status).toBe(400);expect(auth.authorizing).toBe(true);
      const callback=new URL(redirect);callback.search=new URLSearchParams({state:login.searchParams.get('state')!,code:'fixture-code'}).toString();expect((await fetch(callback)).status).toBe(200);expect(login.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));expect((await auth.read())!.tokens!.refreshToken).toBe('private-refresh');
      const stored=JSON.parse(credentials.value!);stored.tokens.expiresAt=0;await credentials.write(JSON.stringify(stored));expect(await auth.token()).toBe('new-access');expect(refreshes).toBe(1);await auth.disconnect();expect((await auth.read())!.tokens).toBeUndefined();expect(await readdir(root)).not.toContain('credentials.json');
    }finally{await auth.cancel();await rm(root,{recursive:true,force:true});}
  });
  it('resumes an encrypted upload session from the acknowledged byte range after restart',async()=>{
    const root=await mkdtemp(join(tmpdir(),'Reader upload session ')),vaultId=randomUUID(),id=randomUUID(),key=randomBytes(32).toString('base64url'),sessions=new EncryptedUploadSessions(root,async()=>key),data=randomBytes(1500000);let accepted=0,starts=0,fail=true;
    const fake:typeof fetch=async(input,init)=>{const url=new URL(String(input)),range=new Headers(init?.headers).get('Content-Range');expect(url.origin).toBe('https://www.googleapis.com');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture');
      if(init?.method==='POST'){starts++;return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=private-session'}});}
      if(range?.startsWith('bytes */'))return new Response(null,{status:308,headers:{Range:'bytes=0-'+(accepted-1)}});
      const match=/bytes (\d+)-(\d+)\/(\d+)/.exec(range??'')!;expect(Number(match[1])).toBe(accepted);if(accepted&&fail)throw Error('network interrupted');accepted=Number(match[2])+1;return accepted===data.length?json({id}):new Response(null,{status:308,headers:{Range:'bytes=0-'+(accepted-1)}});
    };
    try{const drive=new GoogleDrive(async()=> 'fixture',fake,sessions);await expect(drive.put(id,data,{vaultId,kind:'asset',key:'a'.repeat(64)})).rejects.toThrow();expect(accepted).toBe(1024*1024);const files=await readdir(root);expect(files).toHaveLength(1);expect((await readFile(join(root,files[0]!))).includes(Buffer.from('private-session'))).toBe(false);fail=false;await new GoogleDrive(async()=> 'fixture',fake,sessions).put(id,data,{vaultId,kind:'asset',key:'a'.repeat(64)});expect(starts).toBe(1);expect(accepted).toBe(data.length);expect(await readdir(root)).toHaveLength(0);}finally{await rm(root,{recursive:true,force:true});}
  });
  it('rejects a foreign upload URL before sending a bearer token there',async()=>{const visited:string[]=[];const fake:typeof fetch=async(input)=>{visited.push(new URL(String(input)).origin);return new Response(null,{status:200,headers:{Location:'https://example.invalid/steal'}});};const drive=new GoogleDrive(async()=> 'fixture-private',fake);await expect(drive.put(randomUUID(),Buffer.from('encrypted'),{vaultId:randomUUID(),kind:'commit',key:randomUUID()})).rejects.toThrow('地址');expect(visited).toEqual(['https://www.googleapis.com']);});
  it('retains removal signals and pages Drive changes within appDataFolder',async()=>{const vaultId=randomUUID();let page=0;const fake:typeof fetch=async(input)=>{const url=new URL(String(input));expect(url.searchParams.get('spaces')).toBe('appDataFolder');page++;return page===1?json({changes:[{fileId:'removed',removed:true}],nextPageToken:'next'}):json({changes:[{fileId:'other',file:{id:'other',appProperties:{readerSync:'1',vaultId:randomUUID(),kind:'commit'}}}],newStartPageToken:'done'});};expect(await new GoogleDrive(async()=> 'fixture',fake).changes(vaultId,'begin')).toEqual({files:[],removed:['removed'],cursor:'done'});});
  it.runIf(process.platform==='win32')('persists a disposable credential using Windows DPAPI',async()=>{const root=await mkdtemp(join(tmpdir(),'Reader DPAPI test ')),credentials=new SystemCredentialStore(root);try{await credentials.write('original-disposable-test-secret');expect(await credentials.read()).toBe('original-disposable-test-secret');expect(await new SystemCredentialStore(root).read()).toBe('original-disposable-test-secret');await credentials.remove();expect(await credentials.read()).toBeUndefined();}finally{await credentials.remove();await rm(root,{recursive:true,force:true});}});
});
