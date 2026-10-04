// Original, redistributable sample reused by production UI inspection and focused tests.
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { documentHtml } from '../experiments/epub/fixture.mjs';
export async function epubFixture(overrides={}) {
  const [image,font]=await Promise.all(['river.png','reader-probe.ttf'].map(name=>readFile(new URL(`../experiments/epub/assets/${name}`,import.meta.url))));
  const files={
    mimetype:'application/epub+zip',
    'META-INF/container.xml':'<container><rootfiles><rootfile full-path="EPUB/book.opf"/></rootfiles></container>',
    'EPUB/book.opf':'<package><metadata><title>山河小记</title></metadata><manifest><item id="story" href="story.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="image" href="river.png" media-type="image/png"/><item id="font" href="reader-probe.ttf" media-type="font/ttf"/></manifest><spine toc="ncx"><itemref idref="story"/></spine></package>',
    'EPUB/nav.xhtml':'<html><body><nav epub:type="toc"><ol><li><a href="story.xhtml#river">沿着河流走</a><ol><li><a href="story.xhtml#bridge">桥边</a></li><li><a href="story.xhtml#ferry">渡口</a></li></ol></li></ol></nav></body></html>',
    'EPUB/toc.ncx':'<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx><navMap><navPoint><navLabel><text>沿着河流走</text></navLabel><content src="story.xhtml#river"/></navPoint></navMap></ncx>',
    'EPUB/story.xhtml':documentHtml('river.png','reader-probe.ttf').replace(/<meta http-equiv="Content-Security-Policy"[^>]*\/>/,''),
    'EPUB/river.png':image,'EPUB/reader-probe.ttf':font,...overrides,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([path,value])=>[path,typeof value==='string'?strToU8(value):value])),{level:0});
}
