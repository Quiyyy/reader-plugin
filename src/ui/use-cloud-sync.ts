import {useCallback,useEffect,useRef,useState} from 'react';
import type {ReaderApi} from '../shared/types';
import type {SyncStatus} from '../shared/sync';

/** Only an open Reader UI schedules sync. Durable queues belong to the server. */
export function useCloudSync(api:ReaderApi,revision:number,onApplied:()=>Promise<unknown>){
  const [status,setStatus]=useState<SyncStatus>(),latest=useRef(status),applied=useRef(onApplied),alive=useRef(true),lastApplied=useRef<string|undefined>(undefined),refreshing=useRef(false),running=useRef(false);
  latest.current=status;applied.current=onApplied;
  const refresh=useCallback(async()=>{if(!api.study||refreshing.current)return latest.current;refreshing.current=true;try{const value=await api.study.call<SyncStatus>('reader_sync_status');if(alive.current){setStatus(value);if(value.lastSyncedAt&&value.lastSyncedAt!==lastApplied.current||latest.current?.phase==='syncing'&&value.phase!=='syncing'){lastApplied.current=value.lastSyncedAt;await applied.current();}}return value;}catch{return latest.current;}finally{refreshing.current=false;}},[api]);
  const run=useCallback(async()=>{if(!api.study||running.current)return;running.current=true;try{const value=await api.study.call<SyncStatus>('reader_sync_run');if(alive.current)setStatus(value);}catch{await refresh();}finally{running.current=false;}},[api,refresh]);
  useEffect(()=>{alive.current=true;void refresh();let tick=0;const timer=setInterval(()=>{const value=latest.current;tick++;if(value?.phase==='syncing'||value?.phase==='authorizing'||tick%10===0)void refresh();if(tick%45===0&&value?.enabled&&value.connected&&value.phase!=='syncing'&&value.phase!=='authorizing')void run();},1000);const focus=()=>{void refresh().then(value=>{if(value?.enabled&&value.connected&&value.phase!=='syncing'&&value.phase!=='authorizing')void run();});};window.addEventListener('focus',focus);return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',focus);};},[refresh,run]);
  useEffect(()=>{if(!status?.enabled||!status.connected)return;const timer=setTimeout(()=>{if(latest.current?.phase!=='syncing'&&latest.current?.phase!=='authorizing')void run();},1800);return()=>clearTimeout(timer);},[revision,status?.enabled,status?.connected,run]);
  useEffect(()=>api.onAfterSaveBeforeClose?.(async()=>{if(!api.study||!latest.current?.enabled||!latest.current.connected)return;try{await run();const until=Date.now()+3000;while(Date.now()<until){const value=await api.study.call<SyncStatus>('reader_sync_status');if(value.phase!=='syncing')break;await new Promise(resolve=>setTimeout(resolve,200));}}finally{await api.study.call('reader_sync_cancel').catch(()=>{});}}),[api,run]);
  return {status,refresh,run};
}
