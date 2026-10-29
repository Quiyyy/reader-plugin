# Windows delivery from one verified package

For a concise Chinese overview of the current workflow, Windows host limitations, and future alternatives, see [Reader 本地更新方案](LOCAL_UPDATES.md).

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
npm.cmd run upgrade:windows -- stage --codex "$cli" --receipt "$delivery/upgrade-receipt.json" --inspection artifacts/inspection-delivery/report.json
# Use the desktop plugin directory Install/Update action for the exact
# marketplacePath and pluginName returned by stage, then:
npm.cmd run upgrade:windows -- complete --codex "$cli" --receipt "$delivery/upgrade-receipt.json"
```

`stage` checks that Reader and the library have not changed since backup, registers the accepted local marketplace, and confirms that the installed runtime is still unchanged. It returns an exact host installation target and remains `awaiting-host-install`; it does not replace cached plugin files. Use the supported desktop UI to install/update **Reader from this exact local source**, rather than another same-named repository marketplace. The agent performs this operation as part of delivery; it is not a manual-update request to the user.

The desktop's `plugin/install` action refreshes the loaded chats' MCP bindings. An external CLI install only changes files and registration and must not be treated as equivalent. After the desktop action completes, `complete` verifies the installed package against the inspected bytes, starts its registered native executable with an empty PATH, checks version/UI hash/app-only interfaces, and compares persistent data with the pre-install snapshot. This native check is still separate from actual host UI acceptance. It does not reimport books, restore old library data, or terminate the desktop application.

The legacy `install` and `rollback` CLI paths reject execution inside a Codex delivery thread or while a Reader launcher from the registered cache family is running. For desktop rollback, prepare the previously accepted package as the target, then use the same staged host-installation flow. Do not clear an in-use cache before the host has replaced its connection.

5. Recheck or retire the temporary EPUB probe when requested:

```powershell
npm.cmd run upgrade:windows -- verify --codex "$cli" --receipt "$delivery/upgrade-receipt.json"
npm.cmd run upgrade:windows -- retire-probe --codex "$cli" --receipt "$delivery/upgrade-receipt.json"
```

Probe retirement first preserves registration, marketplace and cached plugin bytes, then removes only `reader-epub-probe@reader-epub-lab` through the official CLI. Its original source directory stays present. Other plugins and the formal Reader are not removed.

6. For desktop rollback, prepare the preserved previous package and use the host-installation sequence above. The following legacy command is only for a headless environment with no active Reader runtime. It changes registration while keeping newer reading state, rich sidecars and the source catalog:

```powershell
npm.cmd run upgrade:windows -- rollback --codex "$cli" --receipt "$delivery/upgrade-receipt.json"
```

Never restore the whole library over newer user data automatically. If verification detects changed bytes, retain evidence and investigate; a concurrent user read is not proof of data loss. Interrupted registration has a journal in `upgrade-receipt.json`; install failures attempt registration-only rollback. The official app may retain an already-open older Reader instance; closing/reopening that Reader surface is distinct from force-stopping the host.

The receipt is the delivery record: exact source commit, package/UI hashes, official registered path, native startup, unchanged data inventory, backup and rollback locations, probe disposition, and native-host UI limitations. Public source publication and local upgrade are independent. Coordinate main/dist once after confirming there is no older publication task in flight.

### Updating an already-open desktop host

An installed package and a running desktop instance can use different versions. The official CLI updates registration and cached package files; it does not prove that existing Reader connections, tool descriptors, or rendered panels have reloaded. The [official local plugin workflow](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually) describes restarting the desktop app after local plugin changes. For this desktop, the validated replacement path is the host's own plugin installation action: its `plugin/install` response was followed by Reader startup/ready events for the **original chat**, and that chat rendered matching UI/backend versions without restarting the desktop process. Marketplace refresh alone and a separate CLI install did not do this.

Reader keeps the current versioned UI URI in new entrypoint descriptors. From 0.2.10, a newer server also serves its current, self-contained UI at older same-major-version Reader bookshelf URIs. This prevents a cached old descriptor from failing with `Resource not found` after the host reconnects to the new server. The resource preserves the requested URI and the same restrictive CSP. Future versions, malformed versions and unrelated paths are rejected; only the canonical UI appears in the resource list.

This compatibility does not replace a running old server or refresh an already-rendered iframe. Do not claim restart-free desktop activation from isolated MCP/AppBridge acceptance. Confirm the actual host page after the host installation action, or report activation as pending. Never force-stop the desktop app, overwrite an installed immutable package in place, or add a private control channel to simulate hot reload.

For recovery from an already-broken, same-version installation, Windows may lock the launcher and prevent uninstall/reinstall. Obtain explicit authorization for Reader-only repair (reuse authorization already granted in the session), make a fresh coherent library backup, and close only positively identified Reader launcher/backend processes. Match full cache-family paths, parentage and creation times so PID reuse or another application's process cannot be targeted. Then use the host uninstall tool and desktop installation UI. Do not make forced Reader shutdown a default step for normal new-version updates, and do not interrupt unsaved Reader work.

Observed on Windows desktop package 26.1023.6621.0 during the 0.2.13 delivery: refreshing the catalog could materialize/register the new package while old Reader connections remained alive, and the installed card exposed no Update action. Treat this state as pending, not as completed host installation. If Reader-only repair is already authorized, use the recovery sequence above. Bundled backend executables can be named `node-<sha256>.exe`, so identify them by the verified Reader runtime path, server argument, launcher parentage and creation time, not only the name `node.exe`. A previously failed panel may also need to be closed and reopened through the original chat's supported Reader entry. Keep actual UI acceptance pending until that page is observed.

### Automatic handoff after each approved delivery

The user's selected workflow is one automatic synchronization check after each delivery, not periodic polling. A successful `complete` inside Codex uses `CODEX_THREAD_ID` to write `artifacts/reader-host-sync-request.json` and mark `receipt.hostSync.status` as `pending`. Installation alone is not host acceptance. A follow-up may run in a separate execution thread, so its fresh MCP process does not prove that the original chat's connection was replaced.

Before ending the delivery turn:

1. Run `node scripts/reader-host-sync.mjs automation` to obtain a human-readable, one-time heartbeat request. Inspect `$CODEX_HOME/automations/*/automation.toml` for an existing request for the same version and thread; reuse or update that pending automation instead of duplicating it.
2. Call the official `automation_update` tool with the generated arguments. It targets the current thread and runs once after two minutes. Do not substitute a standalone cron job or an independent app-server process.
3. Record the actual returned automation ID with `node scripts/reader-host-sync.mjs scheduled --automation-id <id> --expected-version <version>`. Finish the current turn promptly so synchronization runs in a subsequent turn. Do not ask the user to send “continue” or manually update the plugin.

The follow-up checks the installed version and the actual Reader page through supported host tools. The UI build embeds `<meta name="reader-version" content="...">`; read this DOM attribute from the real MCP App, save a screenshot, and record origin `codex-mcpapps`, `threadId`, actual UI `version`, the registered package `registeredVersion` and `sourceCommit`, `serverVersion` and `serverObservedAt` from the page HTML element’s `data-reader-server-version` and `data-reader-server-checked-at` attributes, `observedAt`, and the absolute `screenshot` path in an evidence JSON file. Run `node scripts/reader-host-sync.mjs accept --evidence <path>` only when the real page matches the expected version. The helper rejects preview/native-startup-only evidence, stale screenshots and evidence from another thread.

If the real page or a supported reconnect control is unavailable, use `node scripts/reader-host-sync.mjs defer --expected-version <version> --reason <reason>`. Report the concrete limit without marking synchronization complete or creating an unbounded retry loop. A subsequent delivery supersedes an older request; callbacks must not downgrade or reinstall the older package.

The official `config/mcpServer/reload` app-server request can be used only through an available supported connection to the same desktop host. `codex app-server proxy` is a supported CLI transport where the managed control socket exists. Starting a separate server and reloading it does not synchronize the desktop's existing connections.
