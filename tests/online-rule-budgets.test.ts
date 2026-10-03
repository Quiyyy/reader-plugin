import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileRule, documentContext, extract, select } from '../src/server/online/rules.js';

describe('synchronous rule resource budgets', () => {
  it('bounds repeated regex compilation/matching under a 128 MiB heap', async () => {
    const code = `
      import assert from 'node:assert/strict';
      import { compileRule, documentContext, extract } from './src/server/online/rules.ts';
      const text = 'a'.repeat(4096) + '!';
      for (let i = 0; i < 200; i++) {
        assert.throws(() => compileRule('text##(ab){1000}'), /计数/);
        const rule = compileRule('text##(?:a+)+$|unique' + i);
        assert.equal(extract(rule, documentContext(text))[0], text);
      }
      assert.equal(extract(compileRule('text##(?:)##!'), documentContext('😀甲'))[0], '!😀!甲!');
      console.log(JSON.stringify({ alive: true, patterns: 200, heapUsed: process.memoryUsage().heapUsed }));
    `;
    const child = await promisify(execFile)(process.execPath, ['--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', code], { timeout: 15000, maxBuffer: 1024 * 1024 });
    expect(JSON.parse(child.stdout)).toMatchObject({ alive: true, patterns: 200 });
    expect(child.stderr).not.toContain('FATAL');
  }, 20000);
  it('walks real HTML documents with a doctype without unbounded DOM queries', () => {
    const context = documentContext('<!doctype html><html><head><title>Example</title></head><body><div class="book"><a href="book.html">Story</a></div></body></html>');
    expect(select(compileRule('.book', true), context)).toHaveLength(1);
    expect(extract(compileRule('.book a@text'), context)).toEqual(['Story']);
    expect(extract(compileRule('.book a@href'), context)).toEqual(['book.html']);
    expect(extract(compileRule('@text'), documentContext('Plain text'))).toEqual(['Plain text']);
  });
  it('rejects deep HTML, huge attributes, entity fanout and JSON before DOM/object allocation', () => {
    expect(() => documentContext('<div>'.repeat(5000) + 'hello' + '</div>'.repeat(5000))).toThrow('深度');
    expect(() => documentContext(`<div ${Array.from({ length: 129 }, (_, i) => `a${i}`).join(' ')}></div>`)).toThrow('属性');
    expect(() => documentContext('<div class="' + 'a '.repeat(5000) + '"></div>')).toThrow('属性长度');
    expect(() => documentContext('<' + 'a'.repeat(129) + '></' + 'a'.repeat(129) + '>')).toThrow('名称预算');
    expect(() => documentContext('<div>' + '&amp;'.repeat(20001) + '</div>')).toThrow('节点');
    expect(() => documentContext('['.repeat(129) + '0' + ']'.repeat(129))).toThrow('JSON 结构');
    expect(() => documentContext('[' + '0,'.repeat(20001) + '0]')).toThrow('JSON 结构');
  });
  it('caps JSON and CSS collectors before the 10001st append, including indexed CSS', () => {
    expect(() => select(compileRule('$[*]'), new Array(10001).fill('x'))).toThrow('10000');
    expect(() => select(compileRule('div', true), documentContext('<div></div>'.repeat(10001)))).toThrow('10000');
    expect(() => select(compileRule('div@tag.a.0', true), documentContext('<div><a>x</a></div>'.repeat(10001)))).toThrow(/预算|10000/);
  });
  it('deduplicates overlapping ancestor scopes in document encounter order', () => {
    const context = documentContext('<div id="a"><div id="b"><div id="c">Text</div></div></div>');
    expect(select(compileRule('div@div', true), context).map(n => n.id)).toEqual(['b', 'c']);
    expect(select(compileRule('div@tag.div.0', true), context).map(n => n.id)).toEqual(['b', 'c']);
    expect(extract(compileRule('div@div@text'), context)).toEqual(['Text', 'Text']);
  });
  it('matches mixed descendant/child compounds without recursive backtracking', () => {
    const context = documentContext('<a><b id="outer"><x><b><c>Found</c></b></x></b></a>');
    expect(extract(compileRule('a > b c@text'), context)).toEqual(['Found']);
    expect(extract(compileRule('a > b > c@text'), context)).toEqual([]);
    expect(extract(compileRule('a b[id="outer"] c@text'), context)).toEqual(['Found']);
    expect(() => compileRule('a[id="outer\']@text')).toThrow();
  });
  it('shares text and work budgets across fields instead of resetting per select', () => {
    const context = documentContext('<div id="content">' + 'x'.repeat(1_100_000) + '</div>');
    const rule = compileRule('#content@text');
    expect(extract(rule, context)[0]).toHaveLength(1_100_000);
    extract(rule, context); extract(rule, context);
    expect(() => extract(rule, context)).toThrow('文本输出预算');
    const expensive = documentContext('<div>'.repeat(100) + 'x' + '</div>'.repeat(100));
    const selector = compileRule(Array(20).fill('div').join(' '), true);
    expect(() => { for (let i = 0; i < 100; i++) select(selector, expensive); }).toThrow('同步工作预算');
  });
  it('preserves text breaks after ignored last children without cloning DOM', () => {
    const context = documentContext('<main><p>A<script>bad</script></p><p>B</p><div>C<svg>bad</svg></div></main>');
    expect(extract(compileRule('main@text'), context)).toEqual(['A\nB\nC']);
  });
  it('survives the 55005-byte / 5000-depth exploit under a 128 MiB heap and continues serving', async () => {
    const code = `
      import assert from 'node:assert/strict';
      import { DOMParser } from 'linkedom';
      import { compileRule, documentContext, select, extract } from './src/server/online/rules.ts';
      const payload = '<div>'.repeat(5000) + 'hello' + '</div>'.repeat(5000);
      assert.equal(Buffer.byteLength(payload), 55005);
      const started = performance.now();
      assert.throws(() => documentContext(payload), /深度/);
      assert.throws(() => documentContext('<div>'.repeat(1000) + 'hello' + '</div>'.repeat(1000)), /深度/);
      // Also defend callers that supply an already parsed, unchecked DOM.
      assert.throws(() => select(compileRule('div@div', true), new DOMParser().parseFromString(payload, 'text/html')), /深度/);
      const forest = ('<div>'.repeat(100) + 'x' + '</div>'.repeat(100)).repeat(50);
      const parsed = documentContext(forest);
      const matches = select(compileRule('div@div@div', true), parsed);
      assert.equal(matches.length, 4900);
      assert.equal(new Set(matches).size, 4900);
      assert.equal(extract(compileRule('p@text'), documentContext('<p>still alive</p>'))[0], 'still alive');
      console.log(JSON.stringify({ alive: true, heapLimitMiB: 128, payloadBytes: payload.length, uniqueMatches: matches.length, elapsedMs: performance.now() - started, heapUsed: process.memoryUsage().heapUsed }));
    `;
    const child = await promisify(execFile)(process.execPath, ['--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', code], { timeout: 15000, maxBuffer: 1024 * 1024 });
    expect(JSON.parse(child.stdout)).toMatchObject({ alive: true, heapLimitMiB: 128, payloadBytes: 55005, uniqueMatches: 4900 });
    expect(child.stderr).not.toContain('FATAL');
  }, 20000);
});
