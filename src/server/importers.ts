import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DOMParser } from 'linkedom';
import type { BookDocument, Chapter } from '../shared/types.js';
import { readSafeZip, safeArchivePath, ZIP_LIMITS } from './formats/zip.js';

export { ZIP_LIMITS };
export const IMPORT_LIMITS = Object.freeze({ fileBytes: ZIP_LIMITS.compressedBytes, chapters: 10_000, paragraphs: 500_000 });
const textDecoder = (encoding: string, bytes: Uint8Array) => new TextDecoder(encoding, { fatal: true }).decode(bytes);
const filenameTitle = (filename: string) => filename.split(/[\\/]/).pop()!.replace(/\.(txt|epub)$/i, '').trim() || 'Untitled book';
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const asArray = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const stringValue = (value: unknown): string => typeof value === 'string' ? value : value && typeof value === 'object' && '#text' in value ? String((value as Record<string, unknown>)['#text'] ?? '') : '';

export function normalizeEncoding(encoding: string): string {
  const key = encoding.toLowerCase().replace(/[_\s-]/g, '');
  const supported: Record<string, string> = { utf8: 'utf-8', gb18030: 'gb18030', gbk: 'gb18030', big5: 'big5', utf16: 'utf-16le', utf16le: 'utf-16le', utf16be: 'utf-16be' };
  if (!supported[key]) throw new Error('Unsupported text encoding. Choose UTF-8, GB18030, Big5, UTF-16LE or UTF-16BE.');
  return supported[key]!;
}
function decodeText(bytes: Uint8Array, override?: string): { text: string; encoding: string; warnings: string[] } {
  const warnings: string[] = [];
  let encoding = override ? normalizeEncoding(override) : 'utf-8';
  if (!override) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  }
  let text: string;
  try { text = textDecoder(encoding, bytes); }
  catch {
    if (override || encoding !== 'utf-8') throw new Error(`The file could not be decoded as ${encoding}. Choose its original encoding and try again.`);
    try { text = textDecoder('gb18030', bytes); encoding = 'gb18030'; }
    catch { throw new Error('The file is neither valid UTF-8 nor GB18030. Choose Big5 or the original encoding and try again.'); }
    warnings.push('UTF-8 decoding failed, so GB18030 was used. Automatic encoding detection is uncertain; choose the original encoding if the text looks wrong.');
  }
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('The file contains binary control characters. Choose the original text encoding or a plain-text file.');
  return { text, encoding, warnings };
}

/** Deliberately conservative: a heading must occupy a short, standalone line. */
export function isChapterHeading(line: string): boolean {
  if (line.length > 100 || /[。！？!?；;]/.test(line)) return false;
  const chinese = line.match(/^第[零〇○一二三四五六七八九十百千万两0-9]+[章节卷回部篇](.{0,75})$/);
  // Standalone numbered couplets may contain commas. Require a separator before
  // that title so prose such as “第十二回中曾写到，…” is not a chapter boundary.
  if (chinese && /^(?:\s|[：:—-])/.test(chinese[1]!)) return true;
  if (/[，,]/.test(line)) return false;
  return !!chinese
    || /^(?:chapter|book|part)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:[.:]|\s*[:.\-–—]?\s+.{0,65})?$/i.test(line)
    || /^(?:序章|序言|前言|楔子|尾声|后记|引子|prologue|epilogue)(?:\s*[:：\-—]\s*.{1,60})?$/i.test(line);
}
function txtChapterTitle(line: string): string | undefined {
  // Some column-formatted Chinese texts join the next prose line with an ASCII
  // space. Recover the two ideographic-space-separated title columns, while
  // leaving the complete original line in paragraphs. Do not guess other joins.
  const joined = line.match(/^(第[零〇○一二三四五六七八九十百千万两0-9]+[章节卷回部篇][\u3000 ]+[\p{Script=Han}]{4,20}\u3000[\p{Script=Han}]{4,20})[ \t]+(.+)$/u);
  if (joined && /[，。！？；]/.test(joined[2]!)) return joined[1];
  return isChapterHeading(line) ? line : undefined;
}
function softWrap(previous: string, next: string): boolean {
  // Short verse/list/speaker lines are meaningful boundaries. Join only likely
  // wrapped CJK prose; explicit blank lines, indentation and headings are handled
  // by the caller before this conservative continuation rule.
  if (previous.length < 24 || !/\p{Script=Han}/u.test(previous)) return false;
  if (!/\p{Script=Han}/u.test(next) && !/^[\p{P}\p{S}]+$/u.test(next)) return false;
  if (/^[\s\-_*─=•●]+$/.test(previous) || /^[\s\-_*─=•●]+$/.test(next)) return false;
  if (/^(?:[•●*\-]|\d+[.)、]|[一二三四五六七八九十]+[、．])\s*/.test(next)) return false;
  if (/[：:]$/.test(previous)) return false;
  if (/^[“「『"]/.test(next) && /[。！？!?．”」』"]$/.test(previous)) return false;
  return true;
}
function importTxt(filename: string, bytes: Uint8Array, override?: string): Omit<BookDocument, 'id'> {
  const decoded = decodeText(bytes, override);
  const lines = decoded.text.split('\n');
  const nonempty = lines.filter(line => line.trim()).length;
  if (!nonempty) throw new Error('This text file is empty.');
  if (nonempty > IMPORT_LIMITS.paragraphs) throw new Error('The file exceeds the 500,000-paragraph limit.');
  const chapters: Chapter[] = [];
  const headings = new Set<string>();
  let repeatedHeading = false;
  let blankBefore = true;
  let previousHeading = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { blankBefore = true; continue; }
    const title = txtChapterTitle(line);
    if (title || !chapters.length) {
      if (title) { repeatedHeading ||= headings.has(clean(title)); headings.add(clean(title)); }
      chapters.push({ id: `chapter-${chapters.length}`, title: title ?? 'Opening', paragraphs: [], paragraphStarts: [] });
      if (chapters.length > IMPORT_LIMITS.chapters) throw new Error('The file exceeds the 10,000-chapter limit.');
    }
    const chapter = chapters[chapters.length - 1]!;
    const index = chapter.paragraphs.length;
    const indented = /^(?:\u3000|\t| {2,})/.test(rawLine);
    if (!index || title || previousHeading || blankBefore || indented || !softWrap(chapter.paragraphs[index - 1]!, line)) chapter.paragraphStarts!.push(index);
    chapter.paragraphs.push(line);
    previousHeading = !!title;
    blankBefore = false;
  }
  if (repeatedHeading) decoded.warnings.push('Repeated chapter headings were retained as separate sections to preserve the source text.');
  if (chapters.length === 1 && chapters[0]!.title === 'Opening') chapters[0]!.title = filenameTitle(filename);
  return { title: filenameTitle(filename), author: '', format: 'txt', chapters, encoding: decoded.encoding, warnings: decoded.warnings, layoutVersion: 2 };
}

function parseXml(bytes: Uint8Array, label: string): any {
  const text = textDecoder('utf-8', bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`${label}: XML document types and custom entities are unsupported.`);
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(`${label}: malformed XML.`);
  return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, processEntities: true }).parse(text);
}
function resolveReference(baseFile: string, reference: string): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(reference)) throw new Error('Remote EPUB resources are unsupported.');
  let path: string;
  try { path = decodeURIComponent(reference.split('#')[0]!.split('?')[0]!); }
  catch { throw new Error('EPUB contains an invalid resource URL.'); }
  if (!path) return baseFile;
  if (path.startsWith('/') || /[\\\x00-\x1f]/.test(path)) throw new Error('EPUB contains an unsafe resource path.');
  const resolved = posix.normalize(posix.join(posix.dirname(baseFile), path));
  safeArchivePath(resolved);
  return resolved;
}
const localTag = (element: Element) => element.tagName.toLowerCase().split(':').pop()!;
const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'canvas', 'video', 'audio', 'link', 'meta', 'noscript', 'template']);
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'pre', 'address', 'table', 'tr', 'td', 'th', 'hr']);
function htmlDocument(bytes: Uint8Array): Document {
  const source = textDecoder('utf-8', bytes);
  if (/<!ENTITY/i.test(source) || /<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('EPUB custom entities are unsupported.');
  // linkedom has no browsing context: it never fetches resources or executes scripts.
  const document = new DOMParser().parseFromString(source, 'text/html') as unknown as Document;
  for (const node of Array.from(document.querySelectorAll('*'))) {
    if (BLOCKED_TAGS.has(localTag(node)) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') node.remove();
  }
  return document;
}
function extractParagraphs(document: Document): string[] {
  const root = document.querySelector('body') ?? Array.from(document.querySelectorAll('*')).find(node => localTag(node) === 'body') ?? document.documentElement;
  const paragraphs: string[] = [];
  let pending = '';
  const flush = () => {
    const text = clean(pending);
    if (text) paragraphs.push(text);
    if (paragraphs.length > IMPORT_LIMITS.paragraphs) throw new Error('EPUB exceeds the 500,000-paragraph limit.');
    pending = '';
  };
  // Iterative traversal avoids stack exhaustion on deeply nested untrusted markup.
  const stack: { node: Node; exit?: boolean }[] = [{ node: root }];
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (node.nodeType === 3) { pending += node.textContent ?? ''; continue; }
    if (node.nodeType !== 1) continue;
    const tag = localTag(node as Element);
    if (exit) { if (BLOCK_TAGS.has(tag) || tag === 'br') flush(); continue; }
    if (BLOCK_TAGS.has(tag) || tag === 'br') flush();
    if (tag === 'img') continue; // No alt substitutions or generated prose: preserve original reading text.
    stack.push({ node, exit: true });
    // linkedom rebuilds this list on access. Cache once to keep wide nodes linear.
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i]! });
  }
  flush();
  return paragraphs;
}

function importEpub(filename: string, bytes: Uint8Array): Omit<BookDocument, 'id'> {
  const archive = readSafeZip(bytes);
  const get = (name: string) => { const data = archive.get(name); if (!data) throw new Error('EPUB is missing a required archive resource.'); return data; };
  const mimetype = textDecoder('utf-8', get('mimetype')).trim();
  if (mimetype !== 'application/epub+zip') throw new Error('The ZIP file is not an EPUB book.');
  const obfuscatedFonts = new Set<string>();
  const warnings = ['Text-first EPUB: images, audio, video, custom fonts and original page layout are not displayed. Book scripts and remote resources are never run or loaded.'];
  if (archive.has('META-INF/rights.xml')) throw new Error('DRM-protected EPUB books are unsupported. Import a DRM-free copy you are authorized to use.');
  if (archive.has('META-INF/encryption.xml')) {
    const encryption = parseXml(get('META-INF/encryption.xml'), 'EPUB encryption');
    const entries = asArray<any>(encryption.encryption?.EncryptedData);
    const fontMethods = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
    if (!entries.length || entries.some(item => !fontMethods.has(item.EncryptionMethod?.['@_Algorithm']))) throw new Error('Encrypted or DRM-protected EPUB content is unsupported.');
    for (const item of entries) {
      const uri = item.CipherData?.CipherReference?.['@_URI'];
      if (typeof uri !== 'string') throw new Error('EPUB font obfuscation has no resource path.');
      const path = resolveReference('', uri);
      if (!/\.(otf|ttf|woff2?)$/i.test(path)) throw new Error('Encrypted EPUB reading content is unsupported; only embedded font obfuscation may be ignored.');
      obfuscatedFonts.add(path);
    }
    warnings.push('Obfuscated embedded fonts were ignored.');
  }
  const container = parseXml(get('META-INF/container.xml'), 'EPUB container');
  const rootfiles = asArray<any>(container.container?.rootfiles?.rootfile);
  const rootfile = rootfiles.find(item => item['@_media-type'] === 'application/oebps-package+xml') ?? rootfiles[0];
  const opfPath = rootfile?.['@_full-path'];
  if (typeof opfPath !== 'string') throw new Error('EPUB container has no package document.');
  safeArchivePath(opfPath);
  const opf = parseXml(get(opfPath), 'EPUB package').package;
  if (!opf?.manifest || !opf?.spine) throw new Error('EPUB package has no manifest or reading order.');
  const metadata = opf.metadata ?? {};
  const title = clean(stringValue(asArray(metadata.title)[0])) || filenameTitle(filename);
  const author = asArray(metadata.creator).map(stringValue).map(clean).filter(Boolean).join(', ');
  const items = asArray<any>(opf.manifest.item);
  const manifest = new Map<string, any>();
  for (const item of items) {
    if (typeof item['@_id'] !== 'string' || typeof item['@_href'] !== 'string') throw new Error('EPUB manifest entry has no ID or path.');
    if (manifest.has(item['@_id'])) throw new Error('EPUB manifest has duplicate IDs.');
    manifest.set(item['@_id'], item);
  }
  const tocTitles = new Map<string, string>();
  const nav = items.find(item => String(item['@_properties'] ?? '').split(/\s+/).includes('nav'));
  if (nav) {
    const path = resolveReference(opfPath, nav['@_href']);
    const navDocument = htmlDocument(get(path));
    const navs = Array.from(navDocument.querySelectorAll('nav'));
    const toc = navs.find(node => (node.getAttribute('epub:type') ?? '').split(/\s+/).includes('toc') || node.getAttribute('role') === 'doc-toc') ?? navs[0];
    for (const link of Array.from(toc?.querySelectorAll('a[href]') ?? [])) {
      try {
        const target = resolveReference(path, link.getAttribute('href')!);
        const label = clean(link.textContent ?? '');
        if (label && !tocTitles.has(target)) tocTitles.set(target, label);
      } catch { /* Ignore external or malformed navigation links; never follow them. */ }
    }
  } else {
    const ncx = manifest.get(opf.spine['@_toc']) ?? items.find(item => item['@_media-type'] === 'application/x-dtbncx+xml');
    if (ncx) {
      const path = resolveReference(opfPath, ncx['@_href']);
      const parsed = parseXml(get(path), 'EPUB table of contents');
      const points = asArray<any>(parsed.ncx?.navMap?.navPoint);
      const queue = [...points].reverse();
      while (queue.length) {
        const point = queue.pop();
        if (point?.content?.['@_src']) {
          try {
            const target = resolveReference(path, point.content['@_src']);
            const label = clean(stringValue(point.navLabel?.text));
            if (label && !tocTitles.has(target)) tocTitles.set(target, label);
          } catch { /* External navigation is ignored. */ }
        }
        queue.push(...asArray<any>(point?.navPoint).reverse());
      }
    }
  }
  const spine = asArray<any>(opf.spine.itemref);
  if (!spine.length || spine.length > IMPORT_LIMITS.chapters) throw new Error('EPUB has no reading order or exceeds the 10,000-chapter limit.');
  const chapters: Chapter[] = [];
  let paragraphCount = 0;
  for (const reference of spine) {
    const item = manifest.get(reference['@_idref']);
    if (!item) throw new Error('EPUB reading order references a missing manifest entry.');
    if (reference['@_linear'] === 'no') continue;
    if (!['application/xhtml+xml', 'text/html'].includes(item['@_media-type'])) { warnings.push('A non-text item in the reading order was skipped.'); continue; }
    const path = resolveReference(opfPath, item['@_href']);
    if (obfuscatedFonts.has(path)) throw new Error('Encrypted EPUB reading content is unsupported.');
    const document = htmlDocument(get(path));
    const paragraphs = extractParagraphs(document);
    if (!paragraphs.length) continue;
    paragraphCount += paragraphs.length;
    if (paragraphCount > IMPORT_LIMITS.paragraphs) throw new Error('EPUB exceeds the 500,000-paragraph limit.');
    // A navigation fragment can point to the end of a spine file. Its label (or
    // a repeated document <title>) must not hide an explicit opening chapter.
    const openingHeading = paragraphs.slice(0, 3).find(isChapterHeading);
    const chapterTitle = openingHeading || tocTitles.get(path) || clean(document.querySelector('h1,h2,h3')?.textContent ?? '') || clean(document.querySelector('title')?.textContent ?? '') || `Chapter ${chapters.length + 1}`;
    chapters.push({ id: `chapter-${chapters.length}`, title: chapterTitle, paragraphs });
  }
  if (!chapters.length) throw new Error('This EPUB contains no readable text. Image-only, encrypted or fixed-layout books are not supported.');
  return { title, author, format: 'epub', chapters, warnings: [...new Set(warnings)] };
}

export function importDocument(filename: string, bytes: Uint8Array, encoding?: string): BookDocument {
  if (!bytes.length) throw new Error('The selected file is empty.');
  if (bytes.length > IMPORT_LIMITS.fileBytes) throw new Error('The file exceeds the 32 MiB import limit.');
  const extension = filename.toLowerCase().split('.').pop();
  if (extension !== 'txt' && extension !== 'epub') throw new Error('Only .txt and DRM-free .epub files are supported.');
  if (extension === 'epub' && encoding) throw new Error('Encoding overrides apply only to TXT files.');
  const document = extension === 'txt' ? importTxt(filename, bytes, encoding) : importEpub(filename, bytes);
  return { id: createHash('sha256').update(bytes).digest('hex'), ...document };
}
