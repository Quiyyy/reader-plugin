import { expect,it } from 'vitest';
import type { BookSummary } from '../src/shared/types';
import { progressLabel,readingState } from '../src/ui/library-presentation';
import { appearanceIsDark,appearanceVariables } from '../src/ui/appearance';
import { defaultAppearance } from '../src/shared/workspace';

const book:BookSummary={id:'a'.repeat(64),title:'原创书籍',author:'',format:'txt',addedAt:'2026-01-01T00:00:00Z',progress:0,locator:{chapter:0,paragraph:0},chapterCount:3,wordCount:100};
it('distinguishes unopened books, reading at zero, and the end of a complete book',()=>{
  expect(readingState(book)).toBe('later');
  expect(readingState({...book,lastReadAt:book.addedAt})).toBe('reading');
  expect(readingState({...book,progress:.999})).toBe('reading');
  expect(progressLabel({...book,progress:.999})).toBe('已读 99%');
  expect(readingState({...book,progress:1})).toBe('finished');
});
it('does not call a partially fetched online directory finished',()=>{
  const online={...book,format:'online' as const,progress:1,locator:{chapter:12,paragraph:1}};
  expect(readingState(online)).toBe('reading');
  expect(readingState({...online,tocComplete:false})).toBe('reading');
  expect(progressLabel(online)).toBe('已读到第 13 章');
  expect(readingState({...online,tocComplete:true})).toBe('finished');
});
it('respects an explicit host light theme even when the operating system is dark',()=>{
  expect(appearanceIsDark('system','light',true)).toBe(false);
  expect(appearanceIsDark('system','dark',false)).toBe(true);
  expect(appearanceIsDark('system',undefined,true)).toBe(true);
  expect(appearanceIsDark('light','dark',true)).toBe(false);
  expect(appearanceIsDark('dark','light',false)).toBe(true);
});
it('supplies the same semantic color contract for every appearance without geometry tokens',()=>{
  const light=appearanceVariables(defaultAppearance,false),dark=appearanceVariables(defaultAppearance,true),cream=appearanceVariables({...defaultAppearance,paper:'cream',accent:'#8551B2'},false);
  expect(Object.keys(light)).toEqual(Object.keys(dark));expect(Object.keys(light)).toEqual(Object.keys(cream));
  expect(light['--study-paper']).not.toBe(dark['--study-paper']);
  expect(cream['--study-paper']).not.toBe(light['--study-paper']);
  expect(cream['--study-accent']).toBe('#8551B2');
  expect(Object.keys(light).some(key=>/width|height|padding|radius|gap|layout/.test(key))).toBe(false);
});
