import {ProxyAgent,fetch as proxyFetch} from 'undici';
import {syncNetworkSchema,type SyncNetwork} from '../../shared/sync.js';

/** A per-Reader dispatcher: never changes the host's global proxy or other traffic. */
export class SyncNetworkClient {
  private agents=new Map<string,ProxyAgent>();
  private closed=false;
  constructor(private config:()=>Promise<SyncNetwork>,private direct:typeof fetch=fetch){}
  readonly fetch:typeof fetch=async(input,init)=>{
    if(this.closed)throw Error('同步连接已关闭');
    const network=syncNetworkSchema.parse(await this.config());
    const key=network.mode==='proxy'?new URL(network.url).href:'';
    for(const [url,agent]of this.agents)if(url!==key){this.agents.delete(url);void agent.close().catch(()=>{});}
    try{
      if(network.mode==='direct')return await this.direct(input,init);
      let agent=this.agents.get(key);if(!agent){agent=new ProxyAgent(key);this.agents.set(key,agent);}
      // The native RequestInit fields used by GoogleAuth/Drive are shared by Undici.
      return await proxyFetch(input as Parameters<typeof proxyFetch>[0],{...init,dispatcher:agent} as Parameters<typeof proxyFetch>[1]) as unknown as Response;
    }catch(error){
      if(init?.signal?.aborted)throw error;
      if(network.mode==='proxy')throw Error('无法通过代理连接 Google，请检查代理地址、端口和代理软件是否运行');
      throw error;
    }
  };
  async close(){this.closed=true;await Promise.all([...this.agents.values()].map(agent=>agent.destroy()));this.agents.clear();}
}

export async function testSyncNetwork(network:SyncNetwork){
  const client=new SyncNetworkClient(async()=>network),started=Date.now();
  try{
    const response=await client.fetch('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest?fields=id',{redirect:'error',signal:AbortSignal.timeout(15000)});
    await response.body?.cancel();if(!response.ok)throw Error('Google Drive 暂时不可达，请检查网络后重试');
    return {ok:true,latencyMs:Date.now()-started};
  }finally{await client.close();}
}
