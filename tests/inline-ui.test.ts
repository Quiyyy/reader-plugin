import { describe, expect, it } from 'vitest';
import { DOMParser } from 'linkedom';
import { inlineReaderUi } from '../scripts/inline-ui.mjs';

function inline(bundle: any) {
  const plugin = inlineReaderUi();
  (plugin.generateBundle as any).call({}, {}, bundle);
  return bundle;
}
describe('offline HTML build without glob dependencies', () => {
  it('inlines scripts and styles without changing comparisons or allowing HTML breakouts', () => {
    const code = 'const ok = 1 < 2; const message = "</script><img onerror=bad()>";';
    const bundle = inline({
      'index.html': { type: 'asset', fileName: 'index.html', source: '<!doctype html><html><head><script type="module" src="./app.js"></script><link rel="stylesheet" href="./app.css"></head><body></body></html>' },
      'app.js': { type: 'chunk', fileName: 'app.js', code, imports: [], dynamicImports: ['app.js'] },
      'app.css': { type: 'asset', fileName: 'app.css', source: 'p::before{content:"</style><img src=x>"}' },
    });
    expect(Object.keys(bundle)).toEqual(['index.html']);
    const doc = new DOMParser().parseFromString(bundle['index.html'].source, 'text/html');
    expect(doc.querySelectorAll('script')).toHaveLength(1); expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelector('script')!.textContent).toContain('1 < 2');
    expect(doc.querySelector('script')!.textContent).toContain('"\\x3c/script><img onerror=bad()>"');
    expect(doc.querySelector('style')!.textContent).toContain('\\3c /style');
    expect(doc.querySelector('script[src],link[href]')).toBeNull();
  });
  it('fails closed on missing, external, duplicate or leftover assets', () => {
    for (const src of ['missing.js', 'https://example.com/a.js', '//example.com/a.js', 'a.js?remote=1']) {
      expect(() => inline({ 'index.html': { type: 'asset', fileName: 'index.html', source: `<html><script src="${src}"></script></html>` } })).toThrow();
    }
    expect(() => inline({ 'index.html': { type: 'asset', fileName: 'index.html', source: '<html></html>' }, 'extra.css': { type: 'asset', fileName: 'extra.css', source: '' } })).toThrow('unhandled');
    expect(() => inline({})).toThrow('exactly one');
  });
});
