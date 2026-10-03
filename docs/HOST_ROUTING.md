# Desktop entrypoint diagnosis — 2026-10-01

Client: ChatGPT 26.928.31416 (12553), macOS 27.0 arm64, local Reader stdio plugin.

| Surface | Evidence | Status |
| --- | --- | --- |
| Main/global Reader navigation | User directly confirmed the four-book bookshelf is visible; desktop log recorded successful local resources/read | Working display |
| Local Codex conversation sidebar | User directly confirmed Reader is visible | Working display |
| dot conversation sidebar | Supplied screenshot shows the host's blue-robot “无法显示 Reader / 重试” fallback; host log below | Failing before UI delivery |
| TXT/EPUB native file handler | Declared and tested with the official AppBridge harness | Actual host dispatch still unverified |

## Direct diagnostic evidence

At 16:20:29 and 16:22:04 UTC the desktop logged `MCP app error displayed`, error code `-32600`, error message `thread not found: <dot-thread-id>`, and `htmlByteLength=undefined`. The identifier matches the affected dot conversation. User screenshots and raw logs are excluded from this public repository.

In the same period, the global/local resource requests used `hostId=local` and `server=reader`, returned `outcome=success`, and delivered `text/html;profile=mcp-app` HTML. The installed cache configuration was checked: it launches an absolute Node 24 executable and the intended built server, with the same persistent Reader data directory. An SDK probe against that installed configuration matched the local build exactly.

These two dated log events locate that particular dot failure at host thread resolution before Reader HTML/init. They do not establish that every affected route fails before HTML delivery. Subsequent project verification of a separately authorized remote probe reached HTML delivery and the app handshake, then failed during tool dispatch. The precise host implementation defect is not established; these observations identify different failing stages, not a proven single cause. Missing `.app.json`, CSS, a CSP violation, or an absent build are **not** demonstrated causes. A protocol probe cannot prove complete host routing, and a working global entry cannot prove a dot thread entry.

## Safe current use and refresh

Use the main/global Reader entry or a local Codex task sidebar. Version 0.1.1 changes the UI cache key to `ui://reader/v0.1.1/bookshelf.html`. Close old Reader panels, refresh the installed plugin metadata if the client offers it, and open a fresh local task. If an old live server remains cached, restart the app when convenient after pending reading saves complete.

Do not loosen CSP or expose the unauthenticated preview server to fix this error. Reader cannot catch a host failure that occurs before its HTML is delivered. This route needs working host routing; a separately authorized cloud connection is a different deployment option and does not by itself prove that dispatch works. Version 0.1.1 does not claim to fix the host failure.

When HTML and the handshake succeed but tool dispatch fails, an HTML/CSP change alone does not establish a fix either. Validate resource delivery, handshake, tool routing and state persistence separately on the actual affected host surface.

If cloud access is required independently of host local routing, the official private development route is Secure MCP Tunnel to this stdio service, with a user-approved tunnel registration and ChatGPT connector mapping. That would let the connected host transport book/tool data outside the current local-only boundary, requires keeping the Mac service available, and must be separately reviewed and authorized before setup. No tunnel or remote service was created by this update.

Official references: [UI resource cache keys and CSP](https://developers.openai.com/plugins/build/chatgpt-ui), [connecting local/private MCP servers and refreshing metadata](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## 0.1.2 platform update

Windows-native setup and cross-platform automated tests do not repair this host issue. Tracking: [openai/codex#50152](https://github.com/openai/codex/issues/50152). No host patch, private RPC, remote probe, tunnel or security-policy change is part of 0.1.2. The resource cache key is now `ui://reader/v0.1.2/bookshelf.html`. Earlier 0.1.1 observations above remain historical evidence; Windows global/thread/file desktop acceptance is pending.

## 0.1.6 validation boundary

The current resource is `ui://reader/v0.1.6/bookshelf.html`. Online-source HTTP access is confined to the local server's safe public-network client; it does not add browser CSP origins or change host routing. Browser preview, AppBridge harness, official app-server discovery and installed-package tests each cover their stated surface. They do not prove native ChatGPT global/thread/file panels work, or that #50152 is fixed. The remote-probe observation above is diagnostic context, not a remote service or tunnel shipped by Reader 0.1.6.
