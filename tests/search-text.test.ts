import { expect,it } from 'vitest';
import { searchSnippet,textMatches } from '../src/shared/search';

it('finds each literal match with original offsets, including Unicode and regex punctuation',()=>{
  const text='😀 A+B a+b 网络网络';
  expect(textMatches(text,'a+b').map(match=>text.slice(match.start,match.end))).toEqual(['A+B','a+b']);
  expect(textMatches(text,'网络')).toEqual([{start:11,end:13},{start:13,end:15}]);
  expect(textMatches('İ I i','i').map(match=>match.start)).toEqual([2,4]);
  expect(textMatches('a a a','a',2)).toHaveLength(2);
  expect(textMatches('anything','  ')).toEqual([]);
});
it('centers a long search result around its actual hit',()=>{
  const result=searchSnippet('前文'.repeat(300)+'特殊命中'+'后文'.repeat(300),'特殊命中');
  expect(result).toContain('特殊命中');expect(result.startsWith('…')).toBe(true);expect(result.endsWith('…')).toBe(true);expect(result.length).toBeLessThan(220);
});
