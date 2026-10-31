import {describe,it,expect} from 'vitest';
import {findMention,mentionItems,sourceMentionId,sourceMentionMarkdown} from '../src/ui/note-mentions';
import type {SourceRef} from '../src/shared/workspace';
import {noteSummaryPreview} from '../src/shared/note-reference';
describe('note mention parsing and choices',()=>{
  it('accepts Chinese boundaries and spaced names without treating emails or paths as mentions',()=>{
    expect(findMention('请@Writing Coach',15)).toMatchObject({from:1,to:15,query:'Writing Coach'});
    for(const text of ['user@example.com','https://host/@name','name@host','@name\nnext'])expect(findMention(text,text.length)).toBeUndefined();
    const text='说明（@审阅';expect(findMention(text,text.length)?.query).toBe('审阅');
    expect(findMention('@'+'a'.repeat(65),66)).toBeUndefined();
  });
  it('keeps Markdown code literal',()=>{
    for(const text of ['```js\n@literal','~~~\n@literal','正文 `@literal'])expect(findMention(text,text.length,true)).toBeUndefined();
    const text='```js\ncode\n```\n@助手';expect(findMention(text,text.length,true)?.query).toBe('助手');
  });
  it('replaces the whole unfinished token when the caret moves within it',()=>{
    expect(findMention('前文 @Writing Coach 后文',15)).toMatchObject({from:3,query:'Writing Coa',raw:'Writing Coach',to:17,caret:15});
  });
  it('orders the default Bot first, searches descriptions and rolls calendar dates locally',()=>{
    const bots={version:1,revision:1,defaultId:'b',bots:[{id:'a',name:'Coach',description:'核对依据',instructions:'Original',model:null},{id:'b',name:'Writer',description:'写作',instructions:'Original',model:null}]} as any;
    expect(mentionItems(bots,[],'')[0]?.id).toBe('b');expect(mentionItems(bots,[],'依据').map(item=>item.id)).toEqual(['a']);
    expect(mentionItems(undefined,[],'明天',new Date(2026,11,31,12))[0]?.value).toBe('2027-01-01');
  });
  it('encodes a local source link without allowing arbitrary protocols or paths',()=>{
    const id='443f9f20-8ccd-4624-8b0d-30646448896d',source={id,title:'标题 [一]',label:'第 1 章'} as SourceRef;
    expect(sourceMentionMarkdown(source)).toBe(`[标题 \\[一\\] · 第 1 章](reader://source/${id})`);
    expect(sourceMentionId('reader://source/'+id)).toBe(id);
    expect(noteSummaryPreview('前文 '+sourceMentionMarkdown(source))).toBe('前文 标题 [一] · 第 1 章');
    expect(noteSummaryPreview('前'.repeat(170)+sourceMentionMarkdown(source))).not.toContain('reader://');
    for(const href of ['javascript:alert(1)','reader://source/../../file','reader://book/'+id,'reader://source/'+id+'?action=delete'])expect(sourceMentionId(href)).toBeUndefined();
  });
});
