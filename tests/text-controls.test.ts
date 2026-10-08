import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { encode } from 'iconv-lite';
import { importDocument } from '../src/server/importers.js';
import { compatibleTextControls } from '../src/server/text-controls.js';

describe('conservative TXT compatibility', () => {
  it('removes only exact standalone padding runs, retaining all other characters and line breaks', () => {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 16].map(n => String.fromCharCode(n).repeat(n));
    const text = '第一章 原创\n保留所有文字。\n' + runs.map(run => `　 ${run}\t`).join('\n') + '\n最后正文。';
    const result = compatibleTextControls(text, 'gb18030');
    expect(result.text).toBe(text.replace(/[\x01-\x08\x0e-\x10]/g, ''));
    expect(result.compatibility).toMatchObject({ paddingCharacters: 81, paddingLines: 11 });
    const bytes = encode(text.replace(/\n/g, '\r\n'), 'gb18030');
    const before = Buffer.from(bytes);
    const book = importDocument('原创.txt', bytes);
    expect(book.encoding).toBe('gb18030');
    expect(book.chapters).toEqual(importDocument('原创.txt', encode(result.text, 'gb18030')).chapters);
    expect(book.id).toBe(createHash('sha256').update(before).digest('hex'));
    expect(bytes).toEqual(before);
  });
  it('maps VT to a line break and FF to a paragraph break, removing only a terminal DOS EOF', () => {
    const text = 'Chapter 1\nfirst\x0bsecond\x0cthird\x1a \t\n';
    const result = compatibleTextControls(text, 'utf-8');
    expect(result.text).toBe('Chapter 1\nfirst\nsecond\n\nthird \t\n');
    expect(result.compatibility).toEqual({ version: 1, paddingCharacters: 0, paddingLines: 0, verticalTabs: 1, formFeeds: 1, terminalEof: 1 });
    expect(importDocument('format.txt', Buffer.from(text)).chapters[0]!.paragraphs).toEqual(['Chapter 1', 'first', 'second', 'third']);
  });
  it.each([
    ['NUL', 'body\n\0\n'], ['inline', 'before\x03\x03\x03after'],
    ['mixed', 'body\n\x03\x04\x03\n'], ['wrong length', 'body\n\x03\x03\n'],
    ['embedded EOF', 'first\x1asecond'], ['multiple EOF', 'body\x1a\x1a'],
    ['ESC', 'body\n\x1b'], ['other control', 'body\n' + '\x11'.repeat(17)],
    ['formatting cannot manufacture padding lines', 'body\x0b\x03\x03\x03\x0cafter'],
  ])('still rejects %s without exposing body text', (_, text) => {
    expect(() => importDocument('private.txt', Buffer.from(text))).toThrow(/无法安全处理的控制字符/);
    try { compatibleTextControls(text, 'utf-8'); } catch (error) {
      expect((error as Error).message).not.toMatch(/body|before|after|first|second/);
    }
  });
  it('reports total count and original positions before compatibility introduces new lines', () => {
    const text = '秘密\x0c段落\n😀\0\x1b\x02\x04';
    expect(() => compatibleTextControls(text, 'utf-8')).toThrow('4 个无法安全处理');
    expect(() => compatibleTextControls(text, 'utf-8')).toThrow('U+0000（第 2 行第 2 列）');
    expect(() => compatibleTextControls(text, 'utf-8')).toThrow('U+001B（第 2 行第 3 列）');
    expect(() => compatibleTextControls(text, 'utf-8')).not.toThrow(/秘密|段落/);
  });
  it('does not change ordinary text, indentation, TAB or Unicode', () => {
    const text = '第一章\n　　正文😀\t保留\n\n结尾。\n';
    expect(compatibleTextControls(text, 'utf-8')).toEqual({ text });
  });
  it('keeps fatal decoding and rejects UTF-16 without a matching override when NULs are present', () => {
    expect(() => importDocument('invalid.txt', Buffer.from([0xff, 0x01]), 'utf-8')).toThrow(/无法按 utf-8 解码/);
    expect(() => importDocument('invalid.txt', Buffer.from([0x81]))).toThrow(/不是有效的 UTF-8 或 GB18030/);
    expect(() => importDocument('utf16.txt', Buffer.from('Chapter 1\nbody', 'utf16le'))).toThrow(/U\+0000/);
    expect(importDocument('utf16.txt', Buffer.from('Chapter 1\nbody', 'utf16le'), 'utf-16le').chapters[0]!.paragraphs).toEqual(['Chapter 1', 'body']);
  });
});
