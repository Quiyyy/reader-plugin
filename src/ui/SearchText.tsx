import { ChevronDown,ChevronUp,X } from 'lucide-react';
import { textMatches } from '../shared/search';
import { IconButton } from './IconButton';

export function SearchText({text,query}:{text:string;query:string}) {
  const matches=textMatches(text,query);let end=0;
  return <>{matches.map(match=>{const before=text.slice(end,match.start);end=match.end;return <span key={match.start}>{before}<mark className="search-term">{text.slice(match.start,match.end)}</mark></span>;})}{text.slice(end)}</>;
}
export function SearchNavigation({query,previous,next,onPrevious,onNext,onClose}:{query:string;previous:boolean;next:boolean;onPrevious:()=>void;onNext:()=>void;onClose:()=>void}) {
  return <div className="reading-find" role="toolbar" aria-label="搜索定位"><span title={query}>{query}</span><IconButton label="上一处匹配" disabled={!previous} onClick={onPrevious}><ChevronUp size={16}/></IconButton><IconButton label="下一处匹配" disabled={!next} onClick={onNext}><ChevronDown size={16}/></IconButton><IconButton label="结束查找" onClick={onClose}><X size={15}/></IconButton></div>;
}
