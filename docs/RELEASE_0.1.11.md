# Reader 0.1.11

EPUB reading retains book structure: safe publisher styles, images/static SVG, unobfuscated fonts, tables, hierarchical contents, precise same-file links, footnote return and image enlargement. A compact contents drawer and appearance popover provide original/comfort styles, size, scrolling and horizontal pagination. TXT and online reading retain the 0.1.10 fixes, including incremental opening and neighboring chapter caching.

Original book IDs and legacy progress/bookmarks remain intact. The rich view writes a separate `epub-v2.json`; uncertain mappings retain the old reading fallback. Book scripts and remote resources stay disabled. Host CSP permissions are unchanged. See [scope and evidence](EPUB_CANDIDATE.md) for the supported CSS/SVG subset, structural rather than CFI locations, and the fixed-layout/vertical-writing limits.

Windows delivery now reuses one checked native package for inspection, installation and recovery. Build stamps bind source/commit/UI, package inventory verifies copied bytes, and the official CLI upgrade preserves the library and source catalog. [Delivery instructions](WINDOWS_DELIVERY.md) include a registration-only rollback and reversible probe removal.

The native executable and MCP resource can be verified independently of Codex's visible UI. Actual native Codex rendering, focus/zoom and panel hot reload remain unverified when the session lacks a supported UI capability. Do not present simulated AppBridge results as native-host acceptance.
