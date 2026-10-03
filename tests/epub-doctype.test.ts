import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { DOMParser } from 'linkedom';
import { importDocument } from '../src/server/importers.js';

const ncxType = '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN"\r\n "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">';
const xhtmlType = "<!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.1//EN'\n 'http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd'>";
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
// Entirely original fixtures: no downloaded book, publisher text or local paths.
const documents: Record<string, string> = {
  'META-INF/container.xml': '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  'book.opf': '<package><metadata><title>Lantern &amp; River 书</title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>',
  'toc.ncx': '<ncx><navMap><navPoint><navLabel><text>River &amp; road 一</text></navLabel><content src="one.xhtml"/><navPoint><navLabel><text>Lantern</text></navLabel><content src="two.xhtml#light"/></navPoint></navPoint></navMap></ncx>',
  'one.xhtml': '<html><body><p>A traveller &amp; a lantern. &#x4E66;&nbsp;Light.</p></body></html>',
  'two.xhtml': '<html><body><p id="light">They reached the river.</p></body></html>',
  'nav.xhtml': '<html><body><nav epub:type="toc"><a href="one.xhtml">River</a><a href="two.xhtml#light">Lantern</a></nav></body></html>',
};
function epub(overrides: Record<string, string> = {}, nav = false) {
  const files = { ...documents, ...overrides };
  if (nav) files['book.opf'] = files['book.opf']!.replace('<manifest>', '<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  return zipSync(Object.fromEntries(Object.entries({ mimetype: 'application/epub+zip', ...files }).map(([path, text]) => [path, strToU8(text)])));
}

describe('inert EPUB document types', () => {
  it('imports standard NCX/XHTML doctypes, nested TOC labels and character references', () => {
    const book = importDocument('original.epub', epub({
      'toc.ncx': xml + ncxType + documents['toc.ncx'],
      'one.xhtml': xml + xhtmlType + documents['one.xhtml'],
      'two.xhtml': '<!DOCTYPE html>' + documents['two.xhtml'],
    }));
    expect(book.title).toBe('Lantern & River 书');
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['River & road 一', 'Lantern']);
    expect(book.chapters.map(chapter => chapter.paragraphs)).toEqual([
      ['A traveller & a lantern. 书 Light.'], ['They reached the river.'],
    ]);
  });
  it('accepts a standard XHTML doctype in EPUB3 navigation', () => {
    const book = importDocument('original.epub', epub({ 'nav.xhtml': xml + xhtmlType + documents['nav.xhtml'] }, true));
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['River', 'Lantern']);
  });
  it.each(['https://example.invalid/external.dtd', 'file:///reader-test-must-not-be-read.dtd', 'relative.dtd', 'https://example.invalid/a>b[c.dtd'])(
    'discards the external identifier %s before either parser can interpret it', identifier => {
      const parseXml = vi.spyOn(XMLParser.prototype, 'parse');
      const parseHtml = vi.spyOn(DOMParser.prototype, 'parseFromString');
      try {
        const book = importDocument('inert.epub', epub({
          'META-INF/container.xml': `<!DOCTYPE container SYSTEM "${identifier}">` + documents['META-INF/container.xml'],
          'book.opf': `<!DOCTYPE package SYSTEM "${identifier}">` + documents['book.opf'],
          'toc.ncx': `<!DOCTYPE ncx SYSTEM "${identifier}">` + documents['toc.ncx'],
          'one.xhtml': `<!DOCTYPE html SYSTEM "${identifier}">` + '<html><body><p>&external; remains literal.</p></body></html>',
        }));
        expect(book.chapters[0]!.paragraphs).toEqual(['&external; remains literal.']);
        expect(parseXml).toHaveBeenCalled();
        expect(parseHtml).toHaveBeenCalled();
        for (const [source] of [...parseXml.mock.calls, ...parseHtml.mock.calls]) {
          expect(String(source)).not.toContain('<!DOCTYPE');
          expect(String(source)).not.toContain(identifier);
        }
      } finally { parseXml.mockRestore(); parseHtml.mockRestore(); }
    },
  );
  it('keeps declaration-like text in XML comments and CDATA inert', () => {
    const book = importDocument('literal.epub', epub({
      'toc.ncx': xml + '<!-- <!DOCTYPE fake [<!ENTITY x "ignored">]> -->' + ncxType + documents['toc.ncx']!.replace('River &amp; road 一', '<![CDATA[Literal <!DOCTYPE ncx> and <!ENTITY example>]]>'),
    }));
    expect(book.chapters[0]!.title).toBe('Literal <!DOCTYPE ncx> and <!ENTITY example>');
  });
});

const attacks = [
  '<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///reader-test-secret.txt">]>',
  '<!DOCTYPE root [<!ENTITY xxe SYSTEM "https://example.invalid/secret">]>',
  '<!DOCTYPE root [<!ENTITY % remote SYSTEM "https://example.invalid/evil.dtd">%remote;]>',
  '<!DOCTYPE root [<!ENTITY a "ha"><!ENTITY b "&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;">]>',
  '<!DOCTYPE root [<!ENTITY loop "&loop;">]>',
  '<!DOCTYPE root []>',
  '<!DOCTYPE root SYSTEM "https://example.invalid/quoted>delimiter" [<!ENTITY x "unsafe">]>',
  '<!DOCTYPE root SYSTEM "https://example.invalid/quoted>delimiter" [ ]>',
  '<!ENTITY outside "unsafe">',
];
describe.each(['META-INF/container.xml', 'book.opf', 'toc.ncx', 'one.xhtml', 'nav.xhtml'])('DTD rejection in %s', path => {
  it.each(attacks)('rejects %s before entity expansion', declaration => {
    expect(() => importDocument('attack.epub', epub({ [path]: declaration + documents[path] }, path === 'nav.xhtml'))).toThrow(/entities|internal DTD/);
  });
  it.each([
    '<!DOCTYPE root SYSTEM "unterminated>',
    '<!DOCTYPE root SYSTEM>',
    '<!DOCTYPE root PUBLIC "missing system">',
    '<!DOCTYPE root><!DOCTYPE root>',
  ])('fails closed on malformed document type %s', declaration => {
    expect(() => importDocument('broken.epub', epub({ [path]: declaration + documents[path] }, path === 'nav.xhtml'))).toThrow(/malformed XML document type/);
  });
});
