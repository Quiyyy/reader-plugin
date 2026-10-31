import {describe,it,expect} from 'vitest';
import {createServer,type Server} from 'node:http';
import {connect,type Socket} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SyncNetworkClient} from '../src/server/sync/network.js';
import {syncNetworkSchema,type SyncNetwork} from '../src/shared/sync.js';
import {ReaderService} from '../src/server/service.js';
import {ReaderStore} from '../src/server/store.js';
import {GoogleDrive} from '../src/server/sync/google-drive.js';
import {MemoryCredentials} from './sync-fixtures';

async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
function track(server:Server){const sockets=new Set<Socket>();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});return async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));};}
describe('explicit Google sync proxy',()=>{
  it('sends requests through CONNECT and changes routing without changing global fetch',async()=>{
    const origin=createServer((req,res)=>res.end('original proxy fixture')),closeOrigin=track(origin),originUrl=await listen(origin);
    const tunnels:string[]=[],proxy=createServer(),closeProxy=track(proxy);
    proxy.on('connect',(req,socket,head)=>{tunnels.push(req.url!);const target=new URL('http://'+req.url);const upstream=connect(Number(target.port),target.hostname,()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});upstream.on('error',()=>socket.destroy());socket.on('close',()=>upstream.destroy());});
    const proxyUrl=await listen(proxy);let config:SyncNetwork={mode:'proxy',url:proxyUrl},directCalls=0;
    const client=new SyncNetworkClient(async()=>config,async(...args)=>{directCalls++;return fetch(...args);});
    try{expect(await (await client.fetch(originUrl,{signal:AbortSignal.timeout(3000)})).text()).toBe('original proxy fixture');expect(tunnels).toEqual([new URL(originUrl).host]);expect(directCalls).toBe(0);config={mode:'direct'};expect(await (await client.fetch(originUrl)).text()).toBe('original proxy fixture');expect(directCalls).toBe(1);expect(tunnels).toHaveLength(1);}finally{await client.close();await closeProxy();await closeOrigin();}
  });
  it('routes OAuth refresh and Drive through the saved proxy without direct fallback',async()=>{
    const root=await mkdtemp(join(tmpdir(),'Reader proxy auth ')),credentials=new MemoryCredentials(),tunnels:string[]=[],proxy=createServer(),closeProxy=track(proxy);
    proxy.on('connect',(req,socket)=>{tunnels.push(req.url!);socket.end('HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');});
    const url=await listen(proxy),reader=new ReaderService(new ReaderStore(root),undefined,{credentials});
    try{
      await reader.sync.configure({clientId:'fixture.apps.googleusercontent.com'});const secrets=JSON.parse(credentials.value!);secrets.tokens={accessToken:'expired-fixture',refreshToken:'private-fixture',expiresAt:0,accountId:'fixture',email:'fixture@example.invalid'};await credentials.write(JSON.stringify(secrets));
      await reader.sync.settings({network:{mode:'proxy',url}});await expect(reader.sync.auth.token()).rejects.toThrow('代理');
      const network=new SyncNetworkClient(async()=>(await reader.sync.status()).network!);try{await expect(new GoogleDrive(async()=> 'fixture',network.fetch).allocate()).rejects.toThrow('代理');}finally{await network.close();}
      expect(tunnels).toEqual(['oauth2.googleapis.com:443','www.googleapis.com:443']);
      const restarted=new ReaderService(new ReaderStore(root),undefined,{credentials});try{expect((await restarted.sync.status()).network).toEqual({mode:'proxy',url});const snapshot=await restarted.sync.replica.snapshot({deviceId:randomUUID(),deviceName:'fixture',options:{books:true,preferences:true}});expect(JSON.stringify(snapshot)).not.toContain(url);}finally{await restarted.close();}
    }finally{await reader.close();await closeProxy();await rm(root,{recursive:true,force:true});}
  });
  it.each(['socks5://127.0.0.1:7898','http://user:secret@127.0.0.1:7897','http://localhost:7897/path','http://localhost:7897/?key=secret','file:///tmp/proxy'])('rejects unsupported or credential-bearing proxy addresses: %s',url=>{expect(syncNetworkSchema.safeParse({mode:'proxy',url}).success).toBe(false);});
});
