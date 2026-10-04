import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importDocument } from '../src/server/importers.js';
import { EpubArchive, epubTarget } from '../src/server/epub-package.js';
import { EpubService } from '../src/server/epub-service.js';
import { ReaderStore } from '../src/server/store.js';
import type { EpubNode } from '../src/shared/epub.js';
// @ts-expect-error Original fixture is shared with the development inspector.
import { epubFixture } from '../scripts/epub-fixture.mjs';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'reader-epub-rich-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const flatten = (nodes: EpubNode[]): Exclude<EpubNode, string>[] => nodes.flatMap(node => typeof node === 'string' ? [] : [node, ...flatten(node.children)]);
const archive = async (overrides = {}) => { const bytes = await epubFixture(overrides); return new EpubArchive(bytes, importDocument('sample.epub', bytes)); };

describe('structured EPUB safety and preservation', () => {
  it('preserves nested same-file anchors, tables, images, fonts and unique structural ids', async () => {
    const book = await archive();
    expect(book.package.toc[0]?.children.map(x => x.target)).toEqual([
      { resource: 'EPUB/story.xhtml', fragment: 'bridge' }, { resource: 'EPUB/story.xhtml', fragment: 'ferry' },
    ]);
    const chapter = book.chapter('EPUB/story.xhtml'), nodes = flatten(chapter.nodes);
    expect(nodes.some(x => x.tag === 'table')).toBe(true);
    expect(nodes.find(x => x.attrs.id === 'note-ref')?.target?.fragment).toBe('note');
    expect(nodes.find(x => x.attrs.id === 'illustration')?.resource).toBe('EPUB/river.png');
    expect(chapter.fonts[0]?.resource).toBe('EPUB/reader-probe.ttf');
    const ids = nodes.map(x => x.attrs['data-reader-node']).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(book.asset('EPUB/reader-probe.ttf').mediaType).toBe('font/ttf');
  });

  it('rebuilds inert content and rejects CSS/URL attempts to leave the book', async () => {
    const book = await archive({ 'EPUB/story.xhtml': `<html><head><style>
      :host{display:none} :root{color:red} body{font-size:22px}
      p{background-image:url(https://invalid.example/x);position:fixed;color:red}
      @import url(https://invalid.example/style);</style></head><body>
      <p id="safe" onclick="window.parent.postMessage('x','*')" style="color:blue;behavior:url(x)">Safe text</p>
      <script>window.__bookScript=true</script><iframe srcdoc="bad"></iframe><form>FORM</form>
      <a href="javascript:alert(1)">bad</a><img src="https://invalid.example/x" alt="offline"/>
      <svg viewBox="0 0 10 10"><script>BAD_SVG</script><foreignObject>BAD_FOREIGN</foreignObject><rect width="10" height="10" onload="bad"/><image href="river.png"/></svg>
      </body></html>` });
    const chapter = book.chapter('EPUB/story.xhtml'), serialized = JSON.stringify(chapter), nodes = flatten(chapter.nodes);
    expect(serialized).not.toMatch(/onclick|postMessage|__bookScript|srcdoc|invalid\.example|javascript|background-image|:host|:root|position/);
    expect(nodes.find(x => x.tag === 'a')?.target).toBeUndefined();
    expect(chapter.styles.some(x => x.declarations.color === 'red')).toBe(true);
    const image = nodes.find(x => x.tag === 'img')!;
    const svg = Buffer.from(book.asset(image.resource!).bytes).toString();
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).not.toMatch(/BAD|onload|script|foreignObject/);
    for (const ref of ['https://x/a','//x/a','javascript:alert(1)','%2f%2fx/a','../../../escape','foo\\bar','a?query=1']) expect(() => epubTarget('EPUB/story.xhtml', ref)).toThrow();
    expect(() => book.asset('META-INF/container.xml')).toThrow();
  });

  it('keeps legacy DTD/XXE/DRM validation and legal NCX declarations', async () => {
    expect((await archive()).package.sections).toHaveLength(1);
    await expect(archive({ 'EPUB/story.xhtml': '<!DOCTYPE html [<!ENTITY x "unsafe">]><html><body><p>&x;</p></body></html>' })).rejects.toThrow();
    await expect(archive({ 'META-INF/rights.xml': '<rights/>' })).rejects.toThrow(/DRM/);
    await expect(archive({ '../escape.txt': 'unsafe' })).rejects.toThrow();
  });

  it('migrates exact locations and old bookmark IDs into a sidecar without changing legacy files', async () => {
    const bytes = await epubFixture(), store = new ReaderStore(directory);
    const book = await store.importBook('sample.epub', bytes), id = book.summary.id;
    await store.saveProgress(id, { chapter: 0, paragraph: 2 });
    const marks = await store.addBookmark(id, { chapter: 0, paragraph: 2 }, 'keep original id');
    const paths = ['source.epub', 'record.json', 'document.json'].map(name => join(directory, 'books', id, name));
    const before = await Promise.all(paths.map(path => readFile(path)));
    const service = new EpubService(store), opened = await service.open(id);
    expect(opened.state.location).toBeDefined();
    expect(opened.state.bookmarks[0]?.id).toBe(marks[0]?.id);
    expect(opened.state.bookmarks[0]?.legacy).toEqual({ chapter: 0, paragraph: 2 });
    await service.save(id, opened.state.location!, { style: 'comfort', flow: 'pages', fontSize: 24 });
    const restarted = await new EpubService(new ReaderStore(directory)).open(id);
    expect(restarted.state.location).toEqual(opened.state.location);
    expect(restarted.state.appearance.fontSize).toBe(24);
    expect(restarted.state.bookmarks[0]?.id).toBe(marks[0]?.id);
    expect(await Promise.all(paths.map(path => readFile(path)))).toEqual(before);
    await expect(service.save(id, { ...opened.state.location!, quote: { exact: 'invented', prefix: '', suffix: '' } }, opened.state.appearance)).rejects.toThrow(/text does not match/);
  });

  it('does not guess duplicated legacy text, and remaps only after explicit legacy progress changes', async () => {
    const bytes = await epubFixture({ 'EPUB/story.xhtml': '<html><body><h1>Title</h1><p>Repeated</p><p>Repeated</p><p>Unique final</p></body></html>' });
    const store = new ReaderStore(directory), book = await store.importBook('sample.epub', bytes), id = book.summary.id;
    await store.saveProgress(id, { chapter: 0, paragraph: 1 });
    const old = await store.addBookmark(id, { chapter: 0, paragraph: 1 }, 'ambiguous');
    const service = new EpubService(store), opened = await service.open(id);
    expect(opened.state.location).toBeUndefined();
    expect(opened.legacyLocation?.exact).toBe('Repeated');
    expect(opened.state.bookmarks[0]).toMatchObject({ id: old[0]!.id, legacy: { chapter: 0, paragraph: 1 } });
    expect(opened.state.bookmarks[0]?.location).toBeUndefined();
    await service.settings(id, opened.state.appearance);
    await store.saveProgress(id, { chapter: 0, paragraph: 3 });
    expect((await service.open(id)).state.location?.quote.exact).toBe('Unique final');
  });
});
