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
