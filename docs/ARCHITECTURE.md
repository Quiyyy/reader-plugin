# Architecture and safety

## Trust boundary

Book bytes are untrusted input. Reader accepts only bytes selected by the user or supplied for the specific host file entrypoint; there is no arbitrary file-path or remote-URL read tool. The model-visible tool only opens the app. Data tools are app-only and return UI data in result metadata rather than model text. No analytics, inference, external font, or book-resource network requests are built in. The MCP host still transports file/tool payloads, so this is not a claim that host infrastructure cannot process them.

The stdio server owns storage. Local installation means local storage; deploying this server elsewhere would move that trust boundary and needs separate authorization/security work. The HTTP implementation is a loopback development surface, not a production multi-user service.

## Import safety

Compressed-file limit 32 MiB, total declared/actual expanded archive limit 64 MiB, individual entry 16 MiB, up to 2,000 entries, compression ratio up to 200:1. Central-directory/local-header consistency, safe relative paths, unique entry names, supported methods, no ZIP encryption and CRC are checked. Inflation is incremental and output bounded; malformed size declarations cannot simply allocate arbitrary output. EPUB XML custom entities/DTDs are rejected. Encrypted content is rejected; recognized font-obfuscation metadata only warns because fonts are not rendered.

The parsed EPUB is converted to original text paragraphs; scripts, styles, frames, forms, SVG/media and remote resources are not executed or rendered. React escapes every paragraph. UI CSP declares no connect/resource/frame origins. The preview has its own restrictive HTTP CSP and no CORS. Negative tests are part of the acceptance suite; this is defense in depth, not a claim of a formal security audit.

## Persistence and locations

DOM traversal is iterative and caches each node's child list once, avoiding stack exhaustion and quadratic wide-node traversal. The preview client aborts requests after 15 seconds and keeps failed progress available for retry. Dependency overrides pin the UI package's lodash to 4.18.1; use the lockfile and repeat the dependency audit before a later release.

Original bytes are preserved verbatim under their SHA-256 ID. Source-fragment document.json is separate from mutable record.json, so scrolling never rewrites a whole novel. Updates use private file modes, fsync and atomic same-directory rename. Lock directories serialize per-book updates across processes. Settings use their own lock. Saved locators use chapter and paragraph indexes tied to the original-file hash and this normalized representation. They are not EPUB CFIs and cannot silently carry over to a different parser/representation.

UI saves are debounced and serialized, stale queued writes are skipped, failed saves are retained and shown with retry, and chapter/book changes flush pending work. Host teardown awaits pending writes when the host supports that lifecycle. Hard kill, network loss, disk failure or a non-graceful close can lose the last unconfirmed position. Two simultaneously active readers follow last successful write; there is no distributed merge of competing reading positions.

## Format adapter roadmap

The BookDocument boundary separates normalized content from UI and persistence. Rich rendering should be a second representation with versioned locators, never an in-place silent rewrite of saved paragraph locations.

A reviewed candidate is foliate-js MIT commit 78914aef4466eb960965702401634c2cb348e9b1 (observed 2026-10-01). It is intentionally not included as an untested runtime dependency in this release. Upstream states its API is unstable and warns that blob iframe sandboxing alone is insufficient. Before enabling its EPUB/MOBI/KF8 renderer:

1. Vendor/pin the reviewed source and preserve MIT notices
2. Keep archive expansion/DRM validation before renderer import
3. Sanitize book HTML and isolate all book documents from the privileged MCP bridge
4. Add inner-document CSP that blocks scripts, remote content, forms and navigation, including SVG/CSS URL cases
5. Validate host support for nested blob frames without broadening network permissions
6. Save EPUB CFI plus source hash and a text fallback; do not map screen page numbers to durable positions
7. Run malicious EPUB fixtures, WebKit/Chromium tests, real-host tests, plus reflow/resize/resume regression cases

MOBI6, KF8/AZW3, combined MOBI and KFX are different formats. Only DRM-free tested variants may be claimed. Manga follows as a separate image-page representation: CBZ first, natural order, RTL/spreads/vertical strip, bounded image dimensions. CBR and licensed DRM need separate dependencies and review.

## TXT layout version 2

Physical source lines retain their existing chapter/fragment indexes. Optional paragraphStarts groups soft-wrapped Chinese prose for display. Blank lines, new indentation, headings, lists, short verse and speaker transitions prevent merging; uncertain short lines remain separate. Inline fragment anchors retain old reading positions and bookmarks, including multiple bookmarks in one displayed paragraph. Search runs on joined reading paragraphs.

Opening a legacy TXT under the per-book lock re-parses its preserved original with the same encoding, verifies the source hash and exact equality of every chapter fragment array, backs up document/record metadata, then atomically replaces only document layout metadata. The maintenance command `node dist/server/index.js --reflow-text` uses READER_DATA_DIR and performs the same migration without marking books as read. A mismatched source structure is refused, not silently reindexed. Existing processes can continue saving the same locators. No remote upload or public endpoint is part of this migration.
