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

This compatibility does not replace a running old server or refresh an already-rendered iframe. Do not claim restart-free desktop activation from isolated MCP/AppBridge acceptance. When host UI verification is explicitly requested or needed to diagnose a reported failure, inspect the actual page and report only what was observed. Never force-stop the desktop app, overwrite an installed immutable package in place, or add a private control channel to simulate hot reload.

For recovery from an already-broken, same-version installation, Windows may lock the launcher and prevent uninstall/reinstall. Obtain explicit authorization for Reader-only repair (reuse authorization already granted in the session), make a fresh coherent library backup, and close only positively identified Reader launcher/backend processes. Match full cache-family paths, parentage and creation times so PID reuse or another application's process cannot be targeted. Then use the host uninstall tool and desktop installation UI. Do not make forced Reader shutdown a default step for normal new-version updates, and do not interrupt unsaved Reader work.

Observed on Windows desktop package 26.1023.6621.0 during the 0.2.13 delivery: refreshing the catalog could materialize/register the new package while old Reader connections remained alive, and the installed card exposed no Update action. Do not treat registration alone as proof that the original connection was replaced. If Reader-only repair is already authorized, use the recovery sequence above. Bundled backend executables can be named `node-<sha256>.exe`, so identify them by the verified Reader runtime path, server argument, launcher parentage and creation time, not only the name `node.exe`. A previously failed panel may also need to be closed and reopened through the original chat's supported Reader entry. Record actual page observations separately from installation checks.

### Optional host diagnostics

Normal delivery ends after the host installation action and a successful `complete`. The package, registered native startup and data-integrity checks remain; `install` and `complete` no longer enqueue a host-sync request, require a page screenshot or schedule a follow-up heartbeat. Do not automatically reopen Reader after every update.

Use `scripts/reader-host-sync.mjs` only when the user explicitly requests additional host verification, or for a reported activation failure. Start an optional diagnostic with `request --receipt <path> --thread-id <original-thread-id>`. Scheduling is a separate action requiring a specific user request; it is not a delivery step.

For an optional diagnostic, read the real MCP App's `reader-version` metadata and the HTML element's `data-reader-server-version` and `data-reader-server-checked-at`. Record the registered package version/source, original thread, observation time and screenshot, then use `accept --evidence <path>` for matching evidence or `defer --expected-version <version> --reason <reason>` when unavailable. These evidence rules prevent false verification; they do not impose a routine post-delivery gate.

The official `config/mcpServer/reload` app-server request can be used only through an available supported connection to the same desktop host. Starting a separate server or a fresh turn does not prove that the desktop's existing connection was replaced.
