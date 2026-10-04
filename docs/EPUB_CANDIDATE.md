# EPUB candidate: design and host compatibility gate

Status: **blocked before production integration**, 2026-10-04. This branch is not a release candidate. No Reader runtime, installed plugin, marketplace, production data, remote branch or CI was changed.

Base: `ed0e51d8eac29952a88ab7f69ebeec0235cddf5d` (0.1.10 incremental online opening). Branch: `feat/epub-structured-reader`. Do not rebase this work onto the older main/dist packages. Keep the unrelated incremental-opening behavior.

## What exists

- `experiments/epub`: an isolated MCP diagnostic plugin, a concrete responsive reading design, an original EPUB sample and a read-only migration readiness audit.
- Pinned, byte-verified Foliate paginator/CFI sources: MIT commit `78914aef4466eb960965702401634c2cb348e9b1`, with license and SHA-256 manifest. They are not imported by the production app.
- The build removes `allow-scripts` from Foliate's iframe sandbox **only in the probe bundle**. The known sample has an inner `script-src 'none'`, no network access, no nested frames, no forms and no base URL. A harmless local script canary detects unexpected execution only if the document actually loads. Its current result is **unknown**, not passed.
- The outer MCP `connectDomains`, `resourceDomains`, `frameDomains` all remain empty. The preview uses the existing restrictive frame/resource policy. Nothing enables `blob:`, `data:`, `*`, a loopback HTTP origin or an external origin in the host frame allowlist.
- Synthetic probe progress is stored separately in `artifacts/epub-probe/probe-state.json`. The probe has no ReaderStore, book import, arbitrary file read or online tools. Book bytes from the user's library never enter this plugin.
- `design.html` is an explicit design-only surface using original content in the ordinary DOM. It must never be substituted for the Foliate rendering result.

## Gate result and blocker

The pinned upstream renderer creates a blob iframe. `src/server/mcp.ts` advertises `frameDomains: []`; `src/server/http.ts` and the protocol harness use `frame-src 'none'`. In the unchanged standalone preview, Chromium emitted a concrete frame-src violation and the sample timed out without loading. Null-document errors from the blocked upstream frame are captured in the diagnostic report. An SDK `script-src`/`eval` probe is also recorded; no unsafe-eval permission was added.

This proves the **preview policy conflict**, not actual Codex rendering behavior. The active delegated session has neither a callable Reader UI tool nor `node_repl` desktop automation. No actual native host screenshots or nested-document result could be obtained. No attempt was made to patch the host, attach private debugging protocols, automate permissions or change its CSP. The local Codex memories directory was empty; no memory_summary file was available and no memory was changed.

Official host documentation says nested frames are blocked by default and describes `frameDomains` for specific origins. It does not establish that a scheme-only `blob:` entry is supported or authorized. The narrowly required capability would be: **an app-created, in-memory nested document, with scripts disabled and no external/network origin**. Obtain a supported host mechanism or an explicit scoped security decision before changing any allowlist. Do not add wildcard or external frame origins to make a demo work.

The current `frameDomains: []` probe can be registered as a separate development plugin by the parent task, then opened in the real global and local task panels. If that fails, stop and record the exact host rejection. If it renders, continue with images, fonts, keyboard focus, zoom/resize, anchor navigation and close/reopen. A bridge handshake, resources/read, CLI registration or browser test is not enough.

Sources: [OpenAI UI/CSP documentation](https://developers.openai.com/plugins/build/chatgpt-ui#content-security-policy-csp); [pinned Foliate security and API notes](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/README.md); [pinned paginator implementation](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/paginator.js).

## Concrete UI design

Keep the host's Reader title and the existing single reading toolbar. The content toolbar has return, the book title, contents, appearance, bookmark and overflow controls. Do not add an internal Reader masthead.

Use the existing IconButton, host colors, focus treatment, panel behavior and Lucide components when integrating. The separate prototype draws small equivalent icons because it is not a second production React app.

- Wide page: centered prose, 680px default line width, generous side margins. Narrow sidebar: 20–22px side padding, no fixed-width text container or horizontal page scroll.
- Contents: hierarchical rows preserving every href fragment, collapsible branches in the eventual app, visible current item. At 320px it replaces the reading surface until dismissed; at wide widths it overlays the left side. It does not permanently consume a text column.
- Appearance: one compact popover. Labels are `原书 / 舒适`, `字号`, `滚动 / 翻页`. Original mode preserves publisher styling; comfort mode changes only reading typography/colors and predictable block spacing, preserving tables, emphasis, captions and structure.
- Footnotes: navigate to the exact target and show a single temporary `返回正文` action. Keep a return-location stack for nested notes. Restore keyboard focus with the location.
- Images: click to enlarge in a dismissible dialog with accessible name and keyboard close. Do not make ordinary prose links launch arbitrary external resources.
- Low-frequency options (bookmarks list, search, keyboard preferences, book details) belong in the overflow menu. No technical text, debug panel or permanent success banner in the shipped reader. The prototype's `兼容检查` belongs only in the diagnostic plugin.
- Large table: scroll locally inside its own bounded wrapper; never enlarge the whole reading page. Resize/zoom/font changes retain a text locator, never a page number.

Checked design screenshots are generated at 1280, 390 and 320px. They are **browser design previews, not real-host UI evidence**. The prototype's back-to-shelf control is disabled, its progress percentage is illustrative, and its paginated design selector does not implement a book engine. Only the separately loaded probe exercises Foliate.

## Production adapter after the gate passes

Keep TXT and online documents on the existing App/API path. Add an EPUB-specific component and adapter behind a representation discriminator. Do not replace `paragraphs: string[]` globally.

1. Server `epub-package.ts`: validate the original SHA, bounded ZIP entries/expansion, paths, duplicates, CRC, DRM and XML. Share the existing inert external DOCTYPE handling; continue rejecting internal subsets/entities and never fetch an NCX DTD. Preserve XHTML, stylesheet references, manifest/spine, nested nav/NCX, fragment IDs and metadata. Reject unsupported encrypted content; implement supported font obfuscation only with its explicit standard algorithm and tests.
2. Server resource RPC: accept only a known book ID and canonical manifest-relative path; return bounded bytes and media type in app-only metadata. Resolve percent escapes once, reject absolute/scheme/query/traversal references, validate fragments separately, and never expose an arbitrary local path or fetch remote book resources.
3. UI `EpubAdapter`: own the pinned Foliate integration, lifecycle, location conversion and asset cache. The UI component calls `open`, `goTo`, `next`, `previous`, `setAppearance`, `onLocation`, `dispose`. Foliate objects do not escape into App state or the MCP bridge.
4. Feed the engine validated package information and a bounded lazy loader. Do not pass unvalidated source archives straight to its ZIP importer. Decode only requested chapters/assets; cap cached bytes, unload unused sections and revoke every object URL on book close. Track any eagerly expanded ZIP work separately from lazy resource transfer/DOM creation; do not claim true random-access ZIP decoding unless implemented.
5. Sanitize XHTML/CSS/SVG structurally before any active document exists. Remove scripts, event handlers, javascript URLs, frames, objects, active forms, meta refresh and external URLs (including CSS imports, escaped URL tokens, SVG links, srcset and namespace cases). Apply the inner CSP before any body content is parsed. Regex replacement alone is insufficient for general EPUB CSS/markup.
6. Never relay book postMessage events to MCP. Privileged bridge messages must originate from the expected host only. The script-free book document receives neither App objects nor tool callbacks. Parent-side keyboard/link handlers act only on validated local navigation targets.

Candidate location shape:

```ts
type EpubLocation = {
  kind: 'epub-v2';
  sourceHash: string;
  resource: string;             // canonical archive path, not a blob URL
  cfi: string;
  quote: { exact: string; prefix: string; suffix: string };
};
```

CFI restores first only when source/representation match. Then validate bounded text context within that resource. Unmatched or ambiguous positions stay unresolved; never silently reset and overwrite an old location. A page index, scrollTop or renderer percentage is not a durable location.

## Data preservation and migration

Keep the existing source hash as the book ID, including trash records. Preserve `source.epub`, `document.json`, `record.json`, existing bookmark IDs and the legacy locator shape. Use a versioned sidecar (for example `epub-v2.json`) with the source hash, renderer/sanitizer version, location, bookmark mapping and per-entry migration status. Use the same per-book lock, fsync and atomic rename rules as ReaderStore.

For a legacy paragraph locator: reparse the preserved original with the legacy parser; require exact chapter/paragraph equality with the stored representation. Map the old spine resource and normalized paragraph text to the new sanitized DOM using unique bounded context. Validate the resulting CFI against the text. Keep ambiguous or missing mappings pending and retain the old view/bookmark fallback. Do not automatically write a replacement reading position just because the renderer emitted its initial location during a failed restore. A newer old-reader write and an independent v2 position must remain distinguishable by timestamps/representation; neither should destroy the other.

The local read-only audit found that the two preserved EPUBs reproduce the legacy paragraphs exactly, and their source hashes match their IDs. The requested book is already the same preserved source; no reimport is necessary. This is **migration readiness only**. No sidecar, migrated bookmark or new production locator has been written or tested.

## Acceptance and release sequence

1. Parent registers only the independent probe, opens it on the actual Windows global and local task surfaces, and records host version, URI, screenshot, report and policy. Keep the formal 0.1.10 plugin installed. Stop on unsupported nested frames; resolve that exact scope before implementing production rendering.
2. Once the gate passes, implement the adapter, sanitizer, resource loader, sidecar migration and production UI. Targeted tests cover the changed layers, malicious paths/DTD/CSS/markup, migration ambiguity and asset-cache disposal. Do not repeatedly run full CI.
3. One concentrated final acceptance uses the authorized `万历十五年.epub` plus the included original rich sample and appropriately licensed mature-reader fixtures. Cover same-file TOC targets, nested notes and return, image/font/table fidelity, original/comfort appearance, resize/font/zoom retention, forward/back, close/reopen and the untouched TXT/online routes. Compare against a mature reader or its known fixtures, not only a CI result.
4. Vertical writing, fixed layout, mixed layout, obfuscated fonts, image zoom and pagination must have individual claims/evidence. The current spike supports none of these as a production feature. Do not advertise all EPUB layout types based on upstream API descriptions.
5. Parent chooses the version/cache URI, performs the normal project build and Windows packaging once, verifies the exact source SHA and data inventory, then coordinates the existing authorized release/upgrade flow. Do not publish this spike or replace the official install. Keep the prior incremental-opening fix and the 0.4.1 source catalog.
