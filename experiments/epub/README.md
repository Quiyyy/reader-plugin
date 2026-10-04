# Reader EPUB host probe

Development-only prerequisite for the structural EPUB upgrade. See [design, gate result and integration plan](../../docs/EPUB_CANDIDATE.md). **Not a production EPUB reader and not accepted in a real Codex host.**

The checked-in assets are original: sample prose, a drawn PNG and a three-glyph diagnostic font. `generate-assets.py` regenerates the latter two using Pillow/fontTools, but normal builds use the committed bytes. MIT notices for the pinned upstream code are in `vendor/foliate/LICENSE`; the probe source/assets may be used under that same MIT license. Generated EPUB contains nested TOC entries into a single XHTML document, an inert NCX external DOCTYPE, a picture, a font, a table and a footnote.

From the repository root, using the existing locked project dependencies:

```powershell
node experiments/epub/build.mjs
node experiments/epub/check.mjs
```

The check launches the installed Microsoft Edge headlessly, confines page requests to the local preview and writes `artifacts/epub-probe/checks.json`. Override `CHROMIUM_PATH` only with an installed compatible Chromium executable. It checks metadata and design layout, and confirms that the unchanged preview CSP blocks the real Foliate blob iframe. Expected preview denial is **not** a successful book-rendering test. No browser download, unsafe launch option or actual host automation is involved.

Output:

- `probe.html`: actual isolated Foliate renderer sample; no DOM fallback.
- `design.html`: ordinary-DOM visual mockup for design review only.
- `server.mjs`: MCP stdio server, or `node artifacts/epub-probe/server.mjs --http` for local `/probe` and `/design` previews.
- `original-river.epub`: the original rich-format fixture.
- `marketplace`: unregistered, separate `reader-epub-probe@reader-epub-lab` development plugin. It preserves the existing `Reader` title. Its MCP server ID and marketplace name differ from the installed Reader.
- `build-manifest.json`: source hashes, sandbox change, unchanged CSP and unperformed host status.
- `design-*.png`: browser design previews; `probe-blocked-preview.png`: actual preview denial.

Build copies the server but resolves its packages from this checkout's node_modules. This is a reproducible local development kit, not a portable packaged release. Keep the checkout and current Node executable at their recorded paths until the parent removes the probe. No registration or install occurs during build/check.

The official Windows CLI syntax below matches the previously authorized local installation workflow. These commands have **not** been executed for the probe; the parent coordinates the separate host test:

```powershell
$cli = 'C:\Users\qyd\.codex\plugins\.plugin-appserver\codex.exe'
$marketplace = (Resolve-Path 'artifacts\epub-probe\marketplace').Path
& $cli plugin marketplace add $marketplace --json
& $cli plugin add 'reader-epub-probe@reader-epub-lab' --json
```

Do not remove or change `reader-marketplace` or the installed `reader` MCP server. Open the probe through its actual Reader entry or `reader_epub_probe_open`. Menu → `兼容检查` exposes its diagnostic report. The report intentionally never self-certifies a real host. Capture actual host evidence separately. The persisted probe state is only original sample data; successful save RPCs cannot prove host teardown/resume behavior.

If the unchanged host policy blocks the nested document, stop there. Do not add `blob:`, `data:`, `*`, `allow-scripts`, unsafe-eval, a tunnel or external origins as a workaround. Request a supported, narrowly scoped mechanism for script-free in-memory book frames.

Read-only existing-library audit (explicit local paths, no writes to the library):

```powershell
node --import tsx experiments/epub/audit-library.mjs '<Reader data directory>' '<authorized EPUB path>' '<workspace report.json>'
```

The audit checks source hashes, exact reproducibility of existing legacy paragraphs and hashes all persisted files before/after. It does not open ReaderStore, mark books read, restore trash or perform migration. Keep reports containing user book IDs, filesystem paths or library inventories outside the public repository.
