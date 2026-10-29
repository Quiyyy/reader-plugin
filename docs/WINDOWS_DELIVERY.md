# Windows delivery from one verified package

This workflow uses the existing native launcher, package inventory, official Codex plugin CLI and isolated Reader inspector. It adds no remote control endpoint, debugging permission or CI layer. Keep native Codex UI checks separate from native MCP/AppBridge checks. Missing native UI tooling must remain explicitly unverified; it need not block a user-authorized local upgrade.

1. Read current remote versions and installed Reader before selecting a new version. Preserve the installed source lineage. Coordinate main/dist separately; never race another publication task or reuse a released version for different bytes.
2. Commit the candidate and require a clean tree. Run the checks affected by the change, reusing existing valid evidence. Do not run full CI repeatedly. For an explicitly authorized no-CI source handoff, use a source-only branch and an explicit `[skip ci]` commit message; do not change workflow policy.
3. Build once, package once, inspect that package once. The packager requires the current commit/source/UI stamp and refuses to overwrite an existing package directory. Keep the exact inventory, manifest and source SHA with the inspection result.

```powershell
npm.cmd run inspect:reader -- --build-only
# Set READER_GO to the already verified, pinned Go 1.27.1 executable if needed.
npm.cmd run package:marketplace -- --target win32-x64 --archive '<verified official Node archive>'
npm.cmd run inspect:reader -- --surface bridge --scenario epub --package artifacts/marketplace/win32-x64 --no-build --output artifacts/inspection-delivery
```

4. Prepare a coherent backup and two local marketplaces. `prepare` verifies all package bytes, copies persistent data without transient locks, preserves the previous installed package as a rollback marketplace, and backs up Codex config. It never overwrites an existing output directory. Use an absolute output outside the real data directory. Keep this directory for future rollback; it contains private data and must not be uploaded or committed.

```powershell
$cli = '<existing official codex.exe>'
$delivery = '<new private absolute delivery directory>'
npm.cmd run upgrade:windows -- prepare --codex "$cli" --package artifacts/marketplace/win32-x64 --expected-previous 0.1.10 --output "$delivery"
npm.cmd run upgrade:windows -- install --codex "$cli" --receipt "$delivery/upgrade-receipt.json" --inspection artifacts/inspection-delivery/report.json
```

`install` checks that the current Reader and library have not changed since backup. It uses only official marketplace remove/add and plugin add commands. The package installed is a verified byte-for-byte copy of the inspected package. It then launches the registered native executable with its registered runtime cache and real data path, an empty PATH, and disabled Node injection variables. Read-only MCP calls verify version, UI resource hash, app-only EPUB interfaces, bookshelf/source visibility, and preservation of every persistent data file. It does not reimport or replace the source catalog, open actual book content, or migrate real positions merely to test an upgrade. It does not force-stop Codex or any existing Reader process.

5. Recheck or retire the temporary EPUB probe when requested:

```powershell
npm.cmd run upgrade:windows -- verify --codex "$cli" --receipt "$delivery/upgrade-receipt.json"
npm.cmd run upgrade:windows -- retire-probe --codex "$cli" --receipt "$delivery/upgrade-receipt.json"
```

Probe retirement first preserves registration, marketplace and cached plugin bytes, then removes only `reader-epub-probe@reader-epub-lab` through the official CLI. Its original source directory stays present. Other plugins and the formal Reader are not removed.

6. Local rollback reuses the preserved previous package and changes only plugin registration. Newer reading state, rich sidecars and source catalog stay in place:

```powershell
npm.cmd run upgrade:windows -- rollback --codex "$cli" --receipt "$delivery/upgrade-receipt.json"
```

Never restore the whole library over newer user data automatically. If verification detects changed bytes, retain evidence and investigate; a concurrent user read is not proof of data loss. Interrupted registration has a journal in `upgrade-receipt.json`; install failures attempt registration-only rollback. The official app may retain an already-open older Reader instance; closing/reopening that Reader surface is distinct from force-stopping the host.

The receipt is the delivery record: exact source commit, package/UI hashes, official registered path, native startup, unchanged data inventory, backup and rollback locations, probe disposition, and native-host UI limitations. Public source publication and local upgrade are independent. Coordinate main/dist once after confirming there is no older publication task in flight.

### Updating an already-open desktop host

An installed package and a running desktop instance can use different versions. The official CLI updates registration and cached package files; it does not prove that existing Reader connections, tool descriptors, or rendered panels have reloaded. The [official local plugin workflow](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually) currently calls for restarting the desktop app after local plugin changes. Marketplace refresh alone is not a documented desktop MCP restart command.

Reader keeps the current versioned UI URI in new entrypoint descriptors. From 0.2.10, a newer server also serves its current, self-contained UI at older same-major-version Reader bookshelf URIs. This prevents a cached old descriptor from failing with `Resource not found` after the host reconnects to the new server. The resource preserves the requested URI and the same restrictive CSP. Future versions, malformed versions and unrelated paths are rejected; only the canonical UI appears in the resource list.

This compatibility does not replace a running old server or refresh an already-rendered iframe. Do not claim restart-free desktop activation from isolated MCP/AppBridge acceptance. Confirm the actual host page after the user reloads the plugin through supported host controls, or report activation as pending. Never force-stop the desktop app, overwrite an installed immutable package in place, or add a private control channel to simulate hot reload.

### Automatic handoff after each approved delivery

The user's selected workflow is one automatic synchronization check after each delivery, not periodic polling. A successful `install` inside Codex uses `CODEX_THREAD_ID` to write `artifacts/reader-host-sync-request.json` and mark `receipt.hostSync.status` as `pending`. Installation alone is not host acceptance.

Before ending the delivery turn:

1. Run `node scripts/reader-host-sync.mjs automation` to obtain a human-readable, one-time heartbeat request. Inspect `$CODEX_HOME/automations/*/automation.toml` for an existing request for the same version and thread; reuse or update that pending automation instead of duplicating it.
2. Call the official `automation_update` tool with the generated arguments. It targets the current thread and runs once after two minutes. Do not substitute a standalone cron job or an independent app-server process.
3. Record the actual returned automation ID with `node scripts/reader-host-sync.mjs scheduled --automation-id <id> --expected-version <version>`. Finish the current turn promptly so synchronization runs in a subsequent turn. Do not ask the user to send “continue” or manually update the plugin.

The follow-up checks the installed version and the actual Reader page through supported host tools. The UI build embeds `<meta name="reader-version" content="...">`; read this DOM attribute from the real MCP App, save a screenshot, and record origin `codex-mcpapps`, `threadId`, actual UI `version`, the registered package `registeredVersion` and `sourceCommit`, `serverVersion` and `serverObservedAt` from the page HTML element’s `data-reader-server-version` and `data-reader-server-checked-at` attributes, `observedAt`, and the absolute `screenshot` path in an evidence JSON file. Run `node scripts/reader-host-sync.mjs accept --evidence <path>` only when the real page matches the expected version. The helper rejects preview/native-startup-only evidence, stale screenshots and evidence from another thread.

If the real page or a supported reconnect control is unavailable, use `node scripts/reader-host-sync.mjs defer --expected-version <version> --reason <reason>`. Report the concrete limit without marking synchronization complete or creating an unbounded retry loop. A subsequent delivery supersedes an older request; callbacks must not downgrade or reinstall the older package.

The official `config/mcpServer/reload` app-server request can be used only through an available supported connection to the same desktop host. `codex app-server proxy` is a supported CLI transport where the managed control socket exists. Starting a separate server and reloading it does not synchronize the desktop's existing connections.
