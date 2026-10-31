import {useCallback,useRef,useState} from 'react';
import type {MentionRange} from './note-mentions';
export function useMention<T extends MentionRange>(){
  const [value,setValue]=useState<T>(),dismissed=useRef<number|undefined>(undefined);
  const update=useCallback((next:T|undefined)=>{if(!next){dismissed.current=undefined;setValue(undefined);}else if(next.from!==dismissed.current)setValue(next);},[]);
  const close=useCallback((suppress=true)=>{if(suppress&&value)dismissed.current=value.from;else dismissed.current=undefined;setValue(undefined);},[value]);
  const blur=useCallback(()=>{dismissed.current=undefined;},[]);
  return {value,update,close,blur};
}
