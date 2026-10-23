import type { BookSummary } from '../shared/types';

export const readingStates = [
  {id:'reading',label:'正在阅读'},
  {id:'later',label:'稍后阅读'},
  {id:'finished',label:'已读完'},
] as const;

export function readingState(book:BookSummary):typeof readingStates[number]['id'] {
  // An online book may be at the end of a partial directory, not the whole book.
  if(book.progress>=1&&(book.format!=='online'||book.tocComplete===true))return 'finished';
  return book.progress>0||book.lastReadAt?'reading':'later';
}

export function progressLabel(book:BookSummary) {
  const state=readingState(book);
  if(state==='finished')return '已读完';
  if(state==='later')return '未开始';
  if(book.format==='online'&&book.tocComplete!==true)return `已读到第 ${book.locator.chapter+1} 章`;
  return `已读 ${Math.min(99,Math.max(0,Math.round(book.progress*100)))}%`;
}
