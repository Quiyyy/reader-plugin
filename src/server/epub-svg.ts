import { DOMParser } from 'linkedom';
import { withoutDocumentType } from './importers.js';

// SVG is rendered as an image, never as privileged inline DOM. Rebuild only static
// drawing primitives, with local raster images embedded by the archive adapter.
const tags = new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc clipPath linearGradient radialGradient stop image use'.split(' '));
const attrs = new Set('id x y x1 x2 y1 y2 cx cy r rx ry width height viewBox preserveAspectRatio d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray opacity clip-path offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod font-size font-family font-weight text-anchor dominant-baseline'.split(' '));
export function safeSvg(source: string, raster: (href: string) => { bytes: Uint8Array; mediaType: string }): Uint8Array {
  if (source.length > 1024 * 1024) throw Error('SVG exceeds rendering budget');
  const parsed = new DOMParser().parseFromString(withoutDocumentType(source, 'EPUB SVG'), 'image/svg+xml');
  const output = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml');
  let count = 0, embeddedBytes = 0;
  const walk = (node: any, depth: number): any => {
    if (++count > 10000 || depth > 48) throw Error('SVG exceeds structural limits');
    if (node.nodeType === 3) return output.createTextNode(node.textContent ?? '');
    if (node.nodeType !== 1 || !tags.has(node.localName)) return;
    const el = output.createElementNS('http://www.w3.org/2000/svg', node.localName, {});
    for (const attr of [...node.attributes] as any[]) {
      if (!attrs.has(attr.name) || attr.value.length > 32000 || /[<>\\\x00-\x1f]|(?:https?|data|javascript):/i.test(attr.value)) continue;
      if (/url\s*\(/i.test(attr.value) && !/^url\(#[\w.-]+\)$/.test(attr.value)) continue;
      el.setAttribute(attr.name, attr.value);
    }
    const href = node.getAttribute('href') ?? node.getAttribute('xlink:href');
    if (node.localName === 'image') {
      if (!href) return;
      try {
        const asset = raster(href);
        if (!/^image\/(png|jpeg|gif|webp)$/.test(asset.mediaType)) return;
        embeddedBytes += asset.bytes.length;
        if (embeddedBytes > 8 * 1024 * 1024) throw Error('SVG image budget exceeded');
        el.setAttribute('href', `data:${asset.mediaType};base64,${Buffer.from(asset.bytes).toString('base64')}`);
      } catch { return; }
    }
    if (node.localName === 'use') {
      if (!/^#[\w.-]+$/.test(href ?? '')) return;
      el.setAttribute('href', href!);
    }
    for (const child of [...node.childNodes]) { const safe = walk(child, depth + 1); if (safe) el.appendChild(safe); }
    return el;
  };
  const root = walk(parsed.documentElement, 0);
  if (!root || root.localName !== 'svg') throw Error('Invalid SVG root');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bytes = Buffer.from(root.outerHTML);
  if (bytes.length > 12 * 1024 * 1024) throw Error('SVG resource budget exceeded');
  return bytes;
}
