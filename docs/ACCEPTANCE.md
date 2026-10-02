# 0.1.2 Windows-native automation scope

The CI matrix now runs Windows Node 22/24, macOS Node 24 and Linux Node 24 from a checkout with spaces and Chinese characters. It runs script syntax checks, TypeScript, 37 existing unit/protocol cases, build/plugin validation, 5 platform cases (the Windows default-directory case is skipped on other systems), and 5 browser scenarios. Platform tests cover generated installation metadata, absolute paths, real stdio processes, TXT/EPUB sources and persisted reading state across restart, plus Windows/UNC containment and realpath alias rejection. Exact results are attached to each commit in [Actions](https://github.com/Quiyyy/reader-plugin/actions).

These are automation targets, not a declaration that an unrun job passed. The user Windows machine was offline and unauthorised during development. Native Windows desktop global/thread/file entries, trust prompts and restart behaviour remain unverified. See [Windows acceptance checklist](WINDOWS.md). The Mac host routing issue [#50152](https://github.com/openai/codex/issues/50152) is separate and remains unresolved.

The following sections preserve the previous 0.1.1 acceptance evidence.

# Acceptance evidence

Version: 0.1.1, verified 2026-10-01. A passed stage does not imply a neighboring stage passed.

## Target environment

- ChatGPT desktop: 26.928.31416 (12553), bundle `com.openai.codex`
- macOS 27.0 (26A428), arm64; Codex CLI 0.135.0
- Node 24.19.0, npm 11.11.0; official Playwright Chromium 153.0.8010.12
- The app updater was unavailable to the delegated task. This records the installed version, not a claim that no update exists.

## Verified

- `npm run check`: strict typecheck, 37 tests in 4 files, production UI/server build
- `npm run validate:plugin`: manifest, MCP configuration and built UI validation
- `npm run test:e2e`: 5 browser scenarios passed, including import, search, bookmark, typography/theme, saved position, mobile layout, back/close, same-location save completion, and 15-second timeout recovery
- Official AppBridge test host: real postMessage/resource reads in a sandboxed opaque iframe with networking disabled
- `npm run test:books`: five public-domain/derived samples passed UI flows at nonzero positions and fresh-browser restoration after replacing the Node service process; see CORPUS.md
- TXT original bytes and encodings; chapter punctuation, digit-style Chinese zero, joined column headings, duplicate-source preservation
- EPUB metadata/spine/nav/NCX; opening chapter labels take priority over generic HTML titles and later fragment labels
- 16,000-paragraph wide EPUB regression preserves all paragraphs and completes within a 3-second test budget
- ZIP limits, bounded inflation, CRC, traversal, malformed/encrypted input rejection, script/active-content stripping
- Atomic storage, cross-process updates, bookmarks/settings/progress and original-byte persistence
- HTTP loopback Host/Origin/CSRF/content-type/body limits; no book-resource network loading
- Final dependency audit: 0 reported vulnerabilities; scoped lodash override 4.18.1

## Installed local plugin and protocol probe

The supported CLI installed `reader-plugin@reader-local` from a dedicated Reader Local marketplace. The plugin is enabled. Existing configuration values were preserved; no authentication, permissions, hooks, or global git identity were changed. The machine-specific marketplace and absolute paths are outside this repository.

An official MCP SDK client started the **installed** stdio configuration, listed 12 tools (11 app-only), read `ui://reader/v0.1.1/bookshelf.html`, and called `reader_open`. The installed UI exactly matched the production build. Resource MIME: `text/html;profile=mcp-app`; SHA-256: `14f52f8fda0b2f1ab01873313fc30d0f7658a4b57baa2d0dfb63eeb02ea8abac`.

The server declares global/thread entrypoints on `reader_open`, and file entrypoints on `reader_open_file`. The installed OpenAI extensions SDK 0.1.0 requires dot-prefixed extensions (`.txt`, `.epub`). The model-visible tool returns only the fixed app-opening message; reading operations return data in app-only result metadata.

## Native host evidence and remaining checks

The user directly confirmed that the global Reader navigation and a local Codex thread panel both display the bookshelf. The delegated task cannot automate the ChatGPT/Codex app itself. The dot conversation panel fails before receiving HTML with host error `-32600: thread not found`; see HOST_ROUTING.md. This remains unresolved. These items are **not passed**:
- Native TXT/EPUB file-handler dispatch, host resource limits and picker behavior
- Host enforcement of app-only visibility, lifecycle/teardown, and desktop restart recovery

Minimal manual continuation on the Mac:

1. When convenient, refresh/reopen ChatGPT and open a local Codex/Work task. Confirm **Reader Local → Reader** remains enabled in Plugins.
2. Invoke Reader with “打开 Reader 书架”; verify both the sidebar/global entry and the thread panel render the bookshelf.
3. Open a test TXT and EPUB through the host file surface and choose Reader. Confirm import, navigation, a bookmark and nonzero progress. Close/reopen the panel/app and check restoration.
4. Check that book paragraphs do not appear as model-visible tool text and that unsupported resource access offers manual import.

The user confirmation applies to global and local Codex thread display. Do not extend it to dot threads, file handling, privacy enforcement or lifecycle behavior. CLI installation and the AppBridge harness alone do not establish those checks.

## Reproduction

Run `npm ci`, `npm run check`, `npm run validate:plugin`, install official Playwright Chromium, and run `npm run test:e2e`. For authorized real books outside the repo, run `READER_ACCEPTANCE_BOOKS_DIR=/external/books npm run test:books`. Server data stays outside the repository and generated evidence goes to ignored `artifacts/`.

## Chinese layout update

Version 0.1.1 adds reading paragraph boundaries without renumbering source fragments. Cross-line search and fragment-bookmark restoration pass browser tests. Legacy TXT documents receive an atomic layout-only upgrade under the existing per-book lock, with original document/record backups. Source bytes, all fragment arrays, chapter indexes and mutable records remain unchanged. On the installed four-book library, before/after hashes confirmed all source files and records were unchanged; EPUB documents were also unchanged. 三国 now displays 4,254 reading paragraphs from 17,893 preserved source fragments, and 红楼 3,956 from 28,239.
