# Acceptance evidence

Candidate: 0.1.0, verified 2026-10-01. A passed stage does not imply a neighboring stage passed.

## Target environment

- ChatGPT desktop: 26.928.31416 (12553), bundle `com.openai.codex`
- macOS 27.0 (26A428), arm64; Codex CLI 0.135.0
- Node 24.19.0, npm 11.11.0; official Playwright Chromium 153.0.8010.12
- The app updater was unavailable to the delegated task. This records the installed version, not a claim that no update exists.

## Verified

- `npm run check`: strict typecheck, 34 tests in 4 files, production UI/server build
- `npm run validate:plugin`: manifest, MCP configuration and built UI validation
- `npm run test:e2e`: 4 browser scenarios passed, including import, search, bookmark, typography/theme, saved position, mobile layout, back/close, same-location save completion, and 15-second timeout recovery
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

An official MCP SDK client started the **installed** stdio configuration, listed 12 tools (11 app-only), read `ui://reader/bookshelf.html`, and called `reader_open`. The installed UI exactly matched the production build. Resource MIME: `text/html;profile=mcp-app`; SHA-256: `471ae8a62a3eb414df86651ed28681e8f4c1c95c52f1032a1b7a8c97a39ce14c`.

The server declares global/thread entrypoints on `reader_open`, and file entrypoints on `reader_open_file`. The installed OpenAI extensions SDK 0.1.0 requires dot-prefixed extensions (`.txt`, `.epub`). The model-visible tool returns only the fixed app-opening message; reading operations return data in app-only result metadata.

## Still requires the real desktop host

The delegated task cannot automate the ChatGPT/Codex app itself. No current task MCP Apps panel was available. These items are **not passed**:

- Native global/sidebar and thread view presence and operation
- Native TXT/EPUB file-handler dispatch, host resource limits and picker behavior
- Host enforcement of app-only visibility, lifecycle/teardown, and desktop restart recovery

Minimal manual continuation on the Mac:

1. When convenient, refresh/reopen ChatGPT and open a local Codex/Work task. Confirm **Reader Local → Reader** remains enabled in Plugins.
2. Invoke Reader with “打开 Reader 书架”; verify both the sidebar/global entry and the thread panel render the bookshelf.
3. Open a test TXT and EPUB through the host file surface and choose Reader. Confirm import, navigation, a bookmark and nonzero progress. Close/reopen the panel/app and check restoration.
4. Check that book paragraphs do not appear as model-visible tool text and that unsupported resource access offers manual import.

Do not report native acceptance until those steps are observed. CLI installation and the AppBridge harness alone do not establish it.

## Reproduction

Run `npm ci`, `npm run check`, `npm run validate:plugin`, install official Playwright Chromium, and run `npm run test:e2e`. For authorized real books outside the repo, run `READER_ACCEPTANCE_BOOKS_DIR=/external/books npm run test:books`. Server data stays outside the repository and generated evidence goes to ignored `artifacts/`.
