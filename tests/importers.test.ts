import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { importDocument, isChapterHeading, ZIP_LIMITS } from '../src/server/importers.js';
import { readSafeZip } from '../src/server/formats/zip.js';

function epub(overrides: Record<string, string | Uint8Array> = {}, options: { nav?: boolean; ncx?: boolean } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/book.opf': strToU8(`<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Our &amp; Their Journey</dc:title><dc:creator>Example Author</dc:creator></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>${options.nav ? '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>' : ''}${options.ncx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ''}</manifest><spine${options.ncx ? ' toc="ncx"' : ''}><itemref idref="one"/><itemref idref="two"/></spine></package>`),
    'OEBPS/one.xhtml': strToU8('<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>First</title><style>BADSTYLE</style><script>BADSCRIPT</script></head><body><h1>The Beginning</h1><p>She opened <em>the door</em>.</p><p>你好，世界。</p></body></html>'),
    'OEBPS/two.xhtml': strToU8('<html><head><title>Second</title></head><body><h2>A new day</h2><p>The journey continued.</p></body></html>'),
  };
  if (options.nav) files['OEBPS/nav.xhtml'] = strToU8('<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml#start">A proper beginning</a></li><li><a href="two.xhtml">A proper ending</a></li></ol></nav></body></html>');
  if (options.ncx) files['OEBPS/toc.ncx'] = strToU8('<ncx><navMap><navPoint><navLabel><text>NCX first</text></navLabel><content src="one.xhtml"/></navPoint><navPoint><navLabel><text>NCX second</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>');
  for (const [name, content] of Object.entries(overrides)) files[name] = typeof content === 'string' ? strToU8(content) : content;
  return zipSync(files, { level: 6 });
}

function firstCentral(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 4; i++) if (view.getUint32(i, true) === 0x02014b50) return i;
  throw new Error('Fixture has no directory');
}

describe('TXT importer', () => {
  it('imports UTF-8, preserves original paragraphs and recognizes short chapter headings', () => {
    const bytes = strToU8('\uFEFF前言\r\nA note.\r\n\r\n第一章 风起\r\n你好，世界。\r\nChapter 2: Arrival\r\nShe arrived.');
    const book = importDocument('novel.TXT', bytes);
    expect(book.title).toBe('novel');
    expect(book.encoding).toBe('utf-8');
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['前言', '第一章 风起', 'Chapter 2: Arrival']);
    expect(book.chapters[1]!.paragraphs).toEqual(['第一章 风起', '你好，世界。']);
    expect(importDocument('renamed.txt', bytes).id).toBe(book.id);
  });
  it('does not split long or ordinary prose into chapters', () => {
    expect(isChapterHeading('Chapter 2 is a title, but this line is prose.')).toBe(false);
    expect(isChapterHeading(`第一章${'长'.repeat(101)}`)).toBe(false);
    expect(isChapterHeading('第十二章风雪归人')).toBe(true);
    expect(importDocument('book.txt', strToU8('Line one.\n\nLine two.')).chapters).toEqual([{ id: 'chapter-0', title: 'book', paragraphs: ['Line one.', 'Line two.'] }]);
  });
  it('recognizes digit-by-digit Chinese chapter numbers using the white-circle zero', () => {
    const headings = ['第九十九回 夜航', '第一○○回：薄雾退去，来客抵达', '第一二○回 归来'];
    const book = importDocument('original-fixture.txt', strToU8(headings.map(title => `${title}\n原创测试段落。`).join('\n')));
    expect(book.chapters.map(chapter => chapter.title)).toEqual(headings);
  });
  it('recognizes a long chaptered novel without treating narrative references as boundaries', () => {
    const digits = '○一二三四五六七八九';
    const headings = Array.from({ length: 120 }, (_, i) => `第${String(i + 1).replace(/\d/g, digit => digits[Number(digit)]!)}回${i % 2 ? '：' : '　'}夜航抵岸，故友重逢`);
    const book = importDocument('original-long-fixture.txt', strToU8('原创前记。\n' + headings.map(title => `${title}\n第十二回中曾写到，故事还没有结束。\n原创正文。`).join('\n')));
    expect(book.chapters.slice(1).map(chapter => chapter.title)).toEqual(headings);
    expect(book.chapters[120]!.paragraphs).toHaveLength(3);
    expect(isChapterHeading('第十二回中曾写到，故事还没有结束')).toBe(false);
    expect(isChapterHeading('Chapter IVory')).toBe(false);
  });
  it('recovers a column-formatted title joined to prose and retains repeated source sections', () => {
    const heading = '第一零四回　　秋风送客归故里　夜雨迎舟到远山';
    const line = `${heading} 旅人刚刚走过桥头，便看见了远方的灯火。`;
    const book = importDocument('joined-original.txt', strToU8(`${line}\n后续原创段落。\n${heading}\n重复章节里的原文也要保留。`));
    expect(book.chapters.map(chapter => chapter.title)).toEqual([heading, heading]);
    expect(book.chapters[0]!.paragraphs[0]).toBe(line);
    expect(book.chapters[1]!.paragraphs[1]).toBe('重复章节里的原文也要保留。');
    expect(book.warnings.join(' ')).toContain('Repeated chapter headings');
  });
  it('decodes UTF-16 BOM and explicit endianness', () => {
    const utf16 = Buffer.from('\ufeff第一章\n中文内容', 'utf16le');
    expect(importDocument('book.txt', utf16).encoding).toBe('utf-16le');
    const be = Uint8Array.from(utf16);
    for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1]!, be[i]!];
    expect(importDocument('book.txt', be).encoding).toBe('utf-16be');
    expect(importDocument('book.txt', be).chapters[0]!.paragraphs[1]).toBe('中文内容');
    expect(importDocument('book.txt', Buffer.from('Chapter 1\nHello', 'utf16le'), 'UTF-16LE').chapters[0]!.title).toBe('Chapter 1');
  });
  it('falls back strictly to GB18030 and makes uncertainty visible', () => {
    const book = importDocument('book.txt', new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]));
    expect(book.encoding).toBe('gb18030');
    expect(book.chapters[0]!.paragraphs).toEqual(['中文']);
    expect(book.warnings.join(' ')).toContain('uncertain');
    expect(importDocument('book.txt', new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5]), 'Big5').chapters[0]!.paragraphs).toEqual(['中文']);
  });
  it('rejects wrong overrides, binary, empty and unsupported files', () => {
    expect(() => importDocument('book.txt', new Uint8Array([0xff]), 'utf-8')).toThrow(/could not be decoded/);
    expect(() => importDocument('book.txt', strToU8('data'), 'shift_jis')).toThrow(/Unsupported text encoding/);
    expect(() => importDocument('book.txt', new Uint8Array([0, 1, 2]))).toThrow(/binary control/);
    expect(() => importDocument('book.txt', strToU8(' \n '))).toThrow(/empty/);
    expect(() => importDocument('book.pdf', strToU8('data'))).toThrow(/Only/);
    expect(() => importDocument('book.txt', new Uint8Array(ZIP_LIMITS.compressedBytes + 1))).toThrow(/32 MiB/);
  });
});

describe('EPUB text-first importer', () => {
  it('uses manifest/spine and EPUB3 navigation while preserving only original reading text', () => {
    const book = importDocument('book.epub', epub({}, { nav: true }));
    expect(book.title).toBe('Our & Their Journey');
    expect(book.author).toBe('Example Author');
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['A proper beginning', 'A proper ending']);
    expect(book.chapters[0]!.paragraphs).toEqual(['The Beginning', 'She opened the door.', '你好，世界。']);
    expect(book.warnings[0]).toContain('Text-first');
  });
  it('treats namespaced XHTML as text and removes namespaced script elements', () => {
    const book = importDocument('book.epub', epub({ 'OEBPS/one.xhtml': '<html><head><title>Safe</title></head><xhtml:body><xhtml:h1>Start</xhtml:h1><xhtml:script>BAD</xhtml:script><xhtml:p>Still safe.</xhtml:p></xhtml:body></html>' }));
    expect(book.chapters[0]!.paragraphs).toEqual(['Start', 'Still safe.']);
  });
  it('reads legacy NCX chapter titles', () => {
    expect(importDocument('book.epub', epub({}, { ncx: true })).chapters.map(chapter => chapter.title)).toEqual(['NCX first', 'NCX second']);
  });
  it('prefers explicit opening chapter labels over generic titles and later navigation fragments', () => {
    const book = importDocument('book.epub', epub({
      'OEBPS/one.xhtml': '<html><head><title>Our Journey</title></head><body><p>CHAPTER XI</p><p>The homecoming</p><p>Original reading text.</p></body></html>',
      'OEBPS/two.xhtml': '<html><head><title>Our Journey</title></head><body><p>CHAPTER XII.</p><p>The last morning</p><p>Final original text.</p><h2 id="end">THE END</h2></body></html>',
      'OEBPS/nav.xhtml': '<html><body><nav><a href="two.xhtml#end">THE END</a></nav></body></html>',
    }, { nav: true }));
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['CHAPTER XI', 'CHAPTER XII.']);
    expect(book.chapters[1]!.paragraphs).toEqual(['CHAPTER XII.', 'The last morning', 'Final original text.', 'THE END']);
  });
  it('bounds processing time for a wide chapter without dropping or reordering paragraphs', () => {
    const paragraphs = Array.from({ length: 16000 }, (_, i) => `Original paragraph ${i}: the traveller crossed a quiet valley, remembering the route home.`);
    const bytes = epub({ 'OEBPS/one.xhtml': `<html><body>${paragraphs.map(text => `<p>${text}</p>`).join('')}</body></html>` });
    const start = performance.now();
    const book = importDocument('wide.epub', bytes);
    expect(book.chapters[0]!.paragraphs).toEqual(paragraphs);
    // The old repeated childNodes getter took seconds even at half this width.
    // A generous budget catches quadratic traversal while allowing slow CI CPUs.
    expect(performance.now() - start).toBeLessThan(3000);
  });
  it('drops scripts, styles, forms, hidden and embedded/remote content without fetching or executing', () => {
    const book = importDocument('book.epub', epub({ 'OEBPS/one.xhtml': '<html><body><p>Before</p><script>BAD</script><style>BAD</style><form>BAD<input value="BAD"/></form><iframe src="https://example.invalid">BAD</iframe><object>BAD</object><svg><text>BAD</text></svg><p hidden="hidden">BAD</p><img src="https://example.invalid/a.png" alt="BAD"/><p>After <a href="https://example.invalid">a link</a></p></body></html>' }));
    expect(book.chapters[0]!.paragraphs).toEqual(['Before', 'After a link']);
    expect(JSON.stringify(book)).not.toContain('BAD');
  });
  it('rejects DRM, encrypted content and custom entities but allows ignored obfuscated fonts', () => {
    expect(() => importDocument('book.epub', epub({ 'META-INF/rights.xml': '<rights/>' }))).toThrow(/DRM/);
    expect(() => importDocument('book.epub', epub({ 'META-INF/encryption.xml': '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>' }))).toThrow(/Encrypted/);
    expect(() => importDocument('book.epub', epub({ 'META-INF/container.xml': '<!DOCTYPE container [<!ENTITY file SYSTEM "file:///etc/passwd">]><container>&file;</container>' }))).toThrow(/entities/);
    expect(() => importDocument('book.epub', epub({ 'META-INF/encryption.xml': '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/one.xhtml"/></CipherData></EncryptedData></encryption>' }))).toThrow(/Encrypted/);
    const book = importDocument('book.epub', epub({ 'META-INF/encryption.xml': '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="OEBPS/font.otf"/></CipherData></EncryptedData></encryption>' }));
    expect(book.warnings).toContain('Obfuscated embedded fonts were ignored.');
  });
  it('rejects malformed packages, missing resources, remote reading order and traversal', () => {
    expect(() => importDocument('book.epub', strToU8('not a zip'))).toThrow(/archive/);
    expect(() => importDocument('book.epub', epub({ mimetype: 'not-epub' }))).toThrow(/not an EPUB/);
    expect(() => importDocument('book.epub', epub({ 'META-INF/container.xml': '<container><broken></container>' }))).toThrow(/malformed XML/);
    expect(() => importDocument('book.epub', epub({ 'OEBPS/book.opf': '<package><manifest><item id="one" href="https://example.invalid/chapter" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>' }))).toThrow(/Remote/);
    expect(() => importDocument('book.epub', epub({ '../outside.txt': 'bad' }))).toThrow(/traversal/);
    expect(() => importDocument('book.epub', epub({ '/absolute.txt': 'bad' }))).toThrow(/path/);
    expect(() => importDocument('book.epub', epub({ 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="../../outside.opf"/></rootfiles></container>' }))).toThrow(/traversal/);
  });
});

describe('ZIP preflight and bounded inflation', () => {
  it('rejects oversized expansion metadata before decompression', () => {
    const bytes = zipSync({ 'file.txt': strToU8('small') });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(firstCentral(bytes) + 24, ZIP_LIMITS.entryBytes + 1, true);
    expect(() => readSafeZip(bytes)).toThrow(/16 MiB/);
  });
  it('bounds real output when declared uncompressed length is forged', () => {
    const bytes = zipSync({ 'file.txt': strToU8('This text is longer than the declared size.') });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(firstCentral(bytes) + 24, 1, true);
    view.setUint32(22, 1, true);
    expect(() => readSafeZip(bytes)).toThrow(/declared size/);
  });
  it('rejects high compression ratios, too many entries and inconsistent names', () => {
    expect(() => readSafeZip(zipSync({ 'bomb.txt': new Uint8Array(300_000) }, { level: 9 }))).toThrow(/compression ratio/);
    const files = Object.fromEntries(Array.from({ length: 2_001 }, (_, i) => [`f${i}`, new Uint8Array()]));
    expect(() => readSafeZip(zipSync(files))).toThrow(/2,000/);
    const bytes = zipSync({ 'file.txt': strToU8('safe') });
    bytes[30] = 120;
    expect(() => readSafeZip(bytes)).toThrow(/names differ/);
  });
  it('verifies checksum and rejects truncated directories', () => {
    const bytes = zipSync({ 'file.txt': strToU8('original content') }, { level: 0 });
    bytes[38] = 42;
    expect(() => readSafeZip(bytes)).toThrow(/checksum/);
    expect(() => readSafeZip(epub().subarray(0, 100))).toThrow(/directory/);
  });
});
