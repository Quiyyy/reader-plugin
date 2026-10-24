import { expect,it } from 'vitest';
import { noteOutline } from '../src/ui/note-outline';

it('keeps heading hierarchy and distinct positions for repeated titles',()=>{
  const body='# 概述\n正文\n## **网络层** ##\n### `IP` 与 [路由](https://example.com)\n## 网络层\n###### 最深层';
  const headings=noteOutline(body);
  expect(headings.map(heading=>[heading.level,heading.title])).toEqual([[1,'概述'],[2,'网络层'],[3,'IP 与 路由'],[2,'网络层'],[6,'最深层']]);
  expect(new Set(headings.map(heading=>heading.id)).size).toBe(headings.length);
  expect(headings[3]!.offset).toBe(body.lastIndexOf('## 网络层'));
  expect(noteOutline('## `foo_bar_baz` 与 \\*字面星号\\*')[0]!.title).toBe('foo_bar_baz 与 *字面星号*');
});

it('ignores fenced and indented code, escaped hashes and non-headings',()=>{
  const body=['# 正文','```md','# 代码中的标题','~~~','## 仍在代码块','```','    # 缩进代码','\\# 转义','####### 过多标记','#没有空格','~~~js','## 另一个代码块','~~~','## 结尾'].join('\n');
  expect(noteOutline(body).map(heading=>heading.title)).toEqual(['正文','结尾']);
});

it('supports setext headings and normalizes CRLF offsets without breaking emoji',()=>{
  const body='开头 😀\r\n=======\r\n普通段落\r\n\r\n## 下一个标题\r\n结尾';
  const headings=noteOutline(body);
  expect(headings[0]).toMatchObject({level:1,title:'开头 😀',line:0,endLine:1,offset:0});
  expect(headings[1]!.offset).toBe(body.replace(/\r\n/g,'\n').indexOf('## 下一个标题'));
  expect(noteOutline('普通段落\n\n---\n\n')).toEqual([]);
});
