import {useEffect,useState} from 'react';
import {Check,LoaderCircle} from 'lucide-react';
import type {ReaderApi} from '../shared/types';
import {syncNetworkSchema,type SyncNetwork,type SyncStatus} from '../shared/sync';
import {errorText} from './study-ui';

export function SyncNetworkSettings({api,status,onRefresh}:{api:ReaderApi;status?:SyncStatus;onRefresh:()=>Promise<unknown>}){
  const saved=JSON.stringify(status?.network??{mode:'direct'});
  const [mode,setMode]=useState<SyncNetwork['mode']>('direct'),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const value=JSON.parse(saved) as SyncNetwork;setMode(value.mode);if(value.mode==='proxy')setUrl(value.url);setMessage('');setError('');},[saved]);
  const draft:SyncNetwork=mode==='proxy'?{mode,url:url.trim()}:{mode};
  const disabled=busy||status?.phase==='syncing'||status?.phase==='authorizing';
  const execute=async(test:boolean)=>{
    if(disabled)return;const parsed=syncNetworkSchema.safeParse(draft);setError('');setMessage('');
    if(!parsed.success){setError('请输入完整的 HTTP 或 HTTPS 代理地址，例如 http://127.0.0.1:7897');return;}
    setBusy(true);
    try{
      if(test){const result=await api.study!.call<{latencyMs:number}>('reader_sync_network_test',{network:parsed.data});setMessage(`Google Drive 可连接 · ${result.latencyMs} ms`);}
      else{await api.study!.call('reader_sync_settings',{network:parsed.data});await onRefresh();setMessage('已应用');}
    }catch(reason){setError(errorText(reason));}finally{setBusy(false);}
  };
  return <section className="settings-group"><h3>网络连接</h3><div className="settings-card sync-network">
    <div className="settings-row"><label htmlFor="sync-proxy-mode">连接方式</label><select id="sync-proxy-mode" disabled={disabled} value={mode} onChange={e=>{setMode(e.target.value as SyncNetwork['mode']);setMessage('');setError('');}}><option value="direct">直接连接</option><option value="proxy">指定代理</option></select></div>
    {mode==='proxy'&&<div className="sync-proxy-field"><label htmlFor="sync-proxy-url">代理地址</label><input id="sync-proxy-url" type="url" autoComplete="off" spellCheck={false} disabled={disabled} placeholder="http://127.0.0.1:7897" value={url} onChange={e=>{setUrl(e.target.value);setMessage('');setError('');}}/><small>使用 Clash 的 HTTP 或混合端口，仅用于本机 Google 同步。</small></div>}
    <div className="sync-network-actions"><div role="status">{busy?<LoaderCircle size={15} className="spin"/>:message?<><Check size={15}/>{message}</>:null}</div><button className="secondary-button" disabled={disabled} onClick={()=>void execute(true)}>测试连接</button><button className="primary-button" disabled={disabled||JSON.stringify(draft)===saved} onClick={()=>void execute(false)}>应用</button></div>
    {error&&<p className="sync-network-error" role="alert">{error}</p>}
  </div></section>;
}
