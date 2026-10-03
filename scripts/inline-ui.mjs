// Reader builds exactly one offline HTML entry. No configurable glob patterns,
// external scripts/styles, public-directory files, or runtime build dependency.
import { DOMParser } from 'linkedom';

/** @returns {import('vite').Plugin} */
export function inlineReaderUi() {
  return {
    name: 'reader:inline-ui', enforce: 'post',
    config: () => ({ base: './', publicDir: false, build: {
      assetsInlineLimit: () => true, cssCodeSplit: false,
      rollupOptions: { output: { codeSplitting: false } },
    } }),
    generateBundle(_options, bundle) {
      const pages = Object.values(bundle).filter(item => item.type === 'asset' && item.fileName.endsWith('.html'));
      if (pages.length !== 1) throw new Error('Reader expects exactly one HTML build entry');
      const page = pages[0], document = new DOMParser().parseFromString(String(page.source), 'text/html');
      const used = new Set([page.fileName]);
      const asset = (value, kind) => {
        if (!value || /^(?:[a-z]+:|\/\/)|[?#]/i.test(value)) throw new Error('Reader build contains a nonlocal asset');
        const name = value.replace(/^\.\//, ''), item = bundle[name];
        if (!item || item.type !== kind || used.has(name)) throw new Error('Reader build asset is missing, duplicated or has an unexpected type');
        used.add(name); return item;
      };
      for (const script of document.querySelectorAll('script[src]')) {
        const chunk = asset(script.getAttribute('src'), 'chunk');
        // Rolldown retains the merged chunk's own name in dynamicImports even
        // after replacing its import with a local Promise/namespace reference.
        if ([...chunk.imports, ...chunk.dynamicImports].some(name => name !== chunk.fileName && (bundle[name]?.type !== 'asset' || !name.endsWith('.css')))) throw new Error('Reader UI must not import external chunks');
        script.removeAttribute('src');
        script.textContent = chunk.code.replace(/"?__VITE_PRELOAD__"?/g, 'void 0').replace(/<(\/script|!--)/gi, '\\x3c$1');
      }
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const css = asset(link.getAttribute('href'), 'asset'), style = document.createElement('style');
        style.textContent = String(css.source).replace(/<\/style/gi, '\\3c /style');
        link.replaceWith(style);
      }
      // Unexpected output must fail, rather than silently shipping a UI that
      // needs a filesystem/HTTP origin unavailable in the host iframe.
      if (Object.keys(bundle).some(name => !used.has(name)) || document.querySelector('script[src],link[href]')) throw new Error('Reader build has unhandled external assets');
      page.source = document.toString();
      for (const name of used) if (name !== page.fileName) delete bundle[name];
    },
  };
}
