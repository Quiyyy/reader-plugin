# Structured EPUB candidate

Status (2026-10-04): production implementation complete for the scope below; **actual Codex host acceptance remains pending**. The user authorized Windows 0.1.11 local delivery on the same day; missing native UI tooling is recorded separately and does not block that authorized upgrade. See WINDOWS_DELIVERY.md and the private delivery receipt. Public main/dist publication remains separately coordinated. Base `ed0e51d8eac29952a88ab7f69ebeec0235cddf5d` (0.1.10 incremental online opening), branch `feat/epub-structured-reader`. Do not replace this base with older main/dist. The source catalog stays at 0.4.1; exact formal Reader installation status is recorded in the delivery receipt.

## Implemented production behavior

- Separate `EpubReader` and `EpubDom` adapter; TXT and online reading keep their existing representation and reader.
- Reconstructed XHTML blocks, emphasis, ruby, lists, images, captions and tables; bounded publisher CSS; local raster and sanitized static SVG images; unobfuscated TTF/OTF/WOFF/WOFF2 fonts. Local CSS imports and internal font references are resolved inside the archive.
- Hierarchical EPUB3 nav / NCX, including multiple targets in one file. Fragment IDs survive; footnotes navigate to a target and provide a return-location stack. Images enlarge in a keyboard-dismissable dialog.
- One toolbar using the existing `IconButton` and host theme. TOC/bookmark drawers, compact original/comfort appearance popover, font size, scrolling and horizontal column pagination. Low-frequency options stay in an overflow menu; no permanent technical explanation.
- Chapter DTOs and resource chunks are requested as needed. One archive and one parsed chapter are cached server-side; UI resource cache is bounded. ZIP validation/expansion and legacy compatibility reparse remain eager. The existing book-open response still contains the legacy text representation for fallback; this is not random-access ZIP decoding.
- Version 2 location: source SHA + archive resource + deterministic sanitized-node ID + character offset + bounded quote/context. **This is not EPUB CFI.** Initial restoration validates text; ambiguous legacy mappings are retained without an automatic replacement write.
- `epub-v2.json` stores rich location, appearance, migrated/new bookmarks and legacy-bookmark tombstones using the existing per-book lock and atomic/fsync path. `record.json`, `document.json`, original bytes, original book ID and legacy bookmark IDs stay intact. Ordinary legacy `reader_get` continues its existing last-opened timestamp update; migration itself does not rewrite those files.
- Pending saves are serialized, retriable and awaited on navigation/back, supported host teardown and external host-file switching. No guarantee is made for forcibly killed processes.

## Security and host decision

Foliate commit `78914aef4466eb960965702401634c2cb348e9b1` is pinned with MIT notices in `experiments/epub/vendor`. Its paginator needs a blob iframe. The isolated probe demonstrated that the current preview blocks it with `frame-src 'none'`; production does not import that paginator.

The implemented adapter rebuilds allowed DOM nodes and CSS declarations instead. It creates no nested document. Shadow DOM isolates book styles, **not privileges**: the closed element/attribute/CSS allowlists and SVG-as-image rebuild are the security boundary. No untrusted `innerHTML` is inserted in the app. Book scripts, event handlers, active forms/frames, arbitrary navigation, CSS network URLs and remote assets are removed. Book content receives no App/MCP object or message relay. Static SVG drops scripting, animation and foreignObject; embedded dependencies are limited to validated local raster images.

The CSP definitions in `src/server/mcp.ts`, `src/server/http.ts` and `tests/host/host.ts` are unchanged; 0.1.11 updates version metadata only. CSP domain lists remain empty, and preview frames remain forbidden. There is **no proposed CSP diff or new permission**. Existing ZIP path/CRC/expansion bounds, XXE/internal-DTD/DRM checks and legal inert NCX DOCTYPE compatibility are reused. Parser/node/CSS/resource output budgets add limits to rich rendering.

Official local CLI registration of the separate `reader-epub-probe@reader-epub-lab` succeeded. Browser/Computer Use/Codex App Tools plugins are installed, but this delegated session has no callable `mcp__node_repl__js`, desktop, browser or Reader UI entrypoint; Codex App Tools is disabled in its manifest. The official Browser skill requires its node_repl bridge. Computer Use instructions also exclude automating Codex itself. We did not enable private pipes, attach a debugging port, automate permission prompts, or change host settings. Registration/native MCP/browser simulation cannot establish real native-host rendering.

The remaining host gate is to open this candidate using a supported Codex UI capability or an operator in both intended Reader surfaces, then check focus, zoom/resize, navigation, teardown and reopen. The isolated probe is optional for that gate because the production adapter avoids nested frames. Existing memories supplied no `memory_summary`; no memory was modified.

## Inspection entrypoint and evidence

Use the repository skill at [`.agents/skills/inspect-reader/SKILL.md`](../.agents/skills/inspect-reader/SKILL.md):

```powershell
npm run inspect:reader -- --surface bridge --scenario epub
npm run inspect:reader -- --surface standalone --scenario epub
npm run inspect:reader -- --surface standalone --serve
npm run inspect:reader -- --surface bridge --scenario epub --book "D:/Download/万历十五年.epub"
```

Each run builds production UI/server plus the existing test host; `--no-build` verifies source, UI and server fingerprints. A fresh isolated `READER_DATA_DIR` is mandatory. The bridge route uses the real native stdio MCP/resource and the existing simulated AppBridge, with Playwright route interception, not a network agent-control endpoint. The standalone route uses the existing loopback-only production preview. `--serve` prints its local URL for manual inspection. Neither is actual Codex host acceptance.

Local reports include build hashes, git state, requested tools, screenshots at 1100/390/320px, DOM/ARIA, page/console/request/CSP diagnostics, save/reopen state and traces. Artifacts can contain private book text; never publish them automatically.

Recorded validation:

- 38 focused rich EPUB/import/store tests passed; a later focused rich EPUB/NCX/service run passed 80 tests (overlapping tests, not 118 distinct tests). TypeScript and Node script syntax checks passed.
- Three browser regressions passed: TXT import/progress/bookmarks/settings/restart; real AppBridge with an opaque iframe; incremental paginated online chapter loading while the current chapter remains readable.
- Original sample: PNG, embedded font, table, nested same-file TOC, footnote/return, image zoom, appearance, narrow widths, pagination and reopen. Native-MCP/bridge and standalone surfaces exercised. The inspector waits for navigation to flush pending saves before measuring the anchor.
- Authorized `万历十五年.epub`: native-MCP/bridge rendering, navigation, appearance/resize and reopen; 32 spine resources versus 30 legacy text chapters (image-only cover resources are now retained within an otherwise textual book).
- [W3C `pub-cmt-svg` fixture](https://github.com/w3c/epub-tests/tree/54092b4233253e9aac80e93ec4782b380b4b3403/tests/pub-cmt-svg), pinned commit `54092b4233253e9aac80e93ec4782b380b4b3403`: SVG decoded and expected CC-heart image visually confirmed. The [published Thorium 2.2.0 report](https://github.com/w3c/epub-tests/blob/54092b4233253e9aac80e93ec4782b380b4b3403/epub33/reports/thorium22-osx-win-deb.json) also records this test as passing. This is comparison with a public criterion/result, not a pixel comparison with a locally running Thorium. Fixture documents use the [W3C license](https://github.com/w3c/epub-tests/blob/54092b4233253e9aac80e93ec4782b380b4b3403/LICENSE.md).
- Two existing installed-library EPUBs were copied read-only into an isolated directory. Their progress matched; the one existing bookmark retained its ID and location through rich save/restart. Both original and copied legacy files remained byte-identical. Unit fixtures additionally cover ambiguous text and old bookmark IDs.

Evidence directories: `artifacts/inspection-rich-acceptance`, `artifacts/inspection-wanli`, `artifacts/inspection-w3c-svg`, `artifacts/inspection-final-standalone`, `artifacts/inspection-final-bridge`, and `artifacts/migration-production-copy`. Refer to each report's hashes; earlier inspections are retained, not silently relabeled as the final build. Bridge reports record the existing SDK blocked-eval feature probes; no unsafe-eval was added. No book/resource CSP violation, uncaught page error or failed request was recorded in successful runs.

## Explicit boundaries

This is a structural EPUB reader for reflowable text books, not full EPUB conformance. Publisher CSS is a safe subset: no network backgrounds, arbitrary functions, media-query cascade, generated content, animations or active SVG. SVG styling is limited to static allowed drawing attributes and local raster dependencies. MathML falls back to text. Obfuscated fonts use system fallback. Image-only books remain rejected by the legacy importer; mixed text/image books retain image-only spine sections.

Fixed layout is detected and shown as a structural reflow with a menu notice, not pixel-faithful pages. Vertical/RTL text CSS can pass through in original mode, but vertical/RTL pagination and position restoration are **not accepted support**; comfort mode uses horizontal writing. Only horizontal reflow pagination has been checked. Search in the rich view is current-chapter search; the retained legacy view offers existing whole-book text search. Standard CFI and robust migration across future sanitizer revisions remain follow-up work; deterministic node IDs are specific to this versioned representation.

## Parent delivery sequence

1. Review local code and screenshots. Keep actual Codex native-host acceptance explicitly unverified when its supported UI route is unavailable. The user has authorized the verified Windows 0.1.11 local upgrade.
2. Use this exact lineage and the selected 0.1.11 version/cache URI. Keep the source catalog at 0.4.1.
3. Build from the final clean commit with locked dependencies (`npm ci`, `npm run build`); reproduce the relevant inspection if the runtime or source changes. No full CI run has been used as a reading-acceptance substitute.
4. Package Windows using the repository's existing `package:marketplace -- --target win32-x64` workflow and pinned official Node archive. Check the new CSSOM dependency is included (it was already a transitive runtime dependency). The Foliate probe is not a production dependency.
5. Perform one user-authorized local update with a coherent backup and byte inventory, using the exact inspected package. Coordinate public main/dist publication separately. Rollback retains sidecar data for later recovery; old Reader ignores it.
