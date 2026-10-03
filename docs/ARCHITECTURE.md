# Architecture and safety

## Trust boundary

Book bytes and imported source definitions are untrusted input. Local TXT/EPUB import accepts only bytes selected by the user or supplied for the specific host file entrypoint; there is no arbitrary local file-path read tool. Local TXT/EPUB import and reading make no outbound book-resource requests. The model-visible tool only opens the app. Data tools are app-only and return UI data in result metadata rather than model text. No analytics, inference or external fonts are built in. The MCP host still transports file/tool payloads, so this is not a claim that host infrastructure cannot process them.

The 0.1.5 online feature has a separate network boundary: explicit source-JSON URL import and enabled-source search/reading use the server-side `OnlineSourceService` and `SafeHttpClient`. This client permits bounded public HTTP(S) requests with validated/pinned DNS, same-origin redirects, TLS checks, cancellation and resource limits. It does not inherit proxies, credentials or cookies, execute source scripts, or read local files. Search terms and online requests go to the user-selected public source; local book bytes are not uploaded. See [the supported subset and limits](online-sources.md).

The stdio server owns storage. Local installation means local storage; deploying this server elsewhere would move that trust boundary and needs separate authorization/security work. The HTTP implementation is a loopback development surface, not a production multi-user service.

## Import safety

Compressed-file limit 32 MiB, total declared/actual expanded archive limit 64 MiB, individual entry 16 MiB, up to 2,000 entries, compression ratio up to 200:1. Central-directory/local-header consistency, safe relative paths, unique entry names, supported methods, no ZIP encryption and CRC are checked. Inflation is incremental and output bounded; malformed size declarations cannot simply allocate arbitrary output. EPUB XML custom entities/DTDs are rejected. Encrypted content is rejected; recognized font-obfuscation metadata only warns because fonts are not rendered.

The parsed EPUB is converted to original text paragraphs; scripts, styles, frames, forms, SVG/media and remote resources are not executed or rendered. React escapes every paragraph, including online text. The host UI CSP declares no external connect/resource/frame origins: online fetching happens through app-only MCP calls to the server, not browser fetches to source websites. The loopback preview permits only its own local API through a restrictive HTTP CSP and has no CORS. Negative tests are part of the acceptance suite; this is defense in depth, not a claim of a formal security audit.

## Persistence and locations

Local EPUB DOM traversal is iterative and caches each node's child list once, avoiding stack exhaustion and quadratic wide-node traversal. Online rules have separate parser, depth, work and output budgets. The preview client aborts ordinary requests after 15 seconds and online operations/book opening after 60 seconds; server-side online work retains its 10-second HTTP and 45-second operation bounds. Failed progress stays available for retry. Dependency overrides pin the UI package's lodash to 4.18.1; use the lockfile and repeat the dependency audit before a later release.

Original bytes are preserved verbatim under their SHA-256 ID. Source-fragment document.json is separate from mutable record.json, so scrolling never rewrites a whole novel. Updates use private file modes, fsync and atomic same-directory rename. Lock directories serialize per-book updates across processes. Settings use their own lock. Saved locators use chapter and paragraph indexes tied to the original-file hash and this normalized representation. They are not EPUB CFIs and cannot silently carry over to a different parser/representation.

Online sources, book records and lazily fetched chapter caches live separately in `online-v1`. Their source revision and stable chapter identifiers preserve online progress/bookmarks without rewriting the local TXT/EPUB representation. Unread online chapters require an enabled reachable source; already cached chapters remain readable when that source is disabled or unavailable.

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

## Prebuilt runtime installation (0.1.3)

The distribution contains all production dependencies rather than relying on a development checkout or attempting to bundle dynamic backend imports. The installer uses only Node built-ins. It validates every packaged file before copying into a versioned stable directory, creates an absolute Node/entrypoint MCP wrapper, and switches a single local marketplace catalog only after a complete version exists. Owned metadata, immutable version directories, a setup lock and retained catalog backups prevent silent overwrites. Interrupted staging and prior versions remain recoverable. User libraries are separate, and setup never creates, migrates or deletes book data. SHA-256 checks detect changed bytes; they are not code signing. Host registration and trust approval remain explicit official-client operations.
