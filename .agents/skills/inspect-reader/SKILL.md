---
name: inspect-reader
description: Inspect the production Reader UI in an isolated development library and retain reproducible UI evidence.
---

Use the repository's existing preview, native MCP server and AppBridge test harness:

```powershell
npm run inspect:reader -- --surface bridge --scenario epub
npm run inspect:reader -- --surface bridge --scenario epub --book "D:/Download/万历十五年.epub"
npm run inspect:reader -- --surface standalone --serve
npm run inspect:reader -- --build-only
npm run inspect:reader -- --surface bridge --scenario epub --package artifacts/marketplace/win32-x64 --no-build
```

The command builds the production UI and server before inspecting. `--no-build` is allowed only when the command's fingerprint check succeeds. Every run uses its own `READER_DATA_DIR`. Never point it at a user's library. Use only an authorized book or the original bundled sample. `--output` selects a local evidence directory, not a publication destination.

For delivery, commit first, use `--build-only`, then package once with the existing marketplace packager. Inspect that exact package using `--package ... --no-build`; this starts its native launcher with isolated data and an empty PATH. Reuse that package for installation. Follow `docs/WINDOWS_DELIVERY.md`; never rebuild between accepted package inspection and installation.

Inspect `report.json`, screenshots, DOM, ARIA snapshots and `trace.zip`. Check content, controls, narrow widths, resources, navigation, position and reopening; successful compilation is insufficient. Reports contain private book content: do not publish them automatically.

The bridge surface uses the real native MCP transport/resource and a simulated AppBridge. It is **not actual Codex host acceptance**. Standalone is also not host acceptance. Report this distinction explicitly. A real-host gate requires a supported host capability or a manual operator. Do not use private app pipes, remote debugging, `bypassCSP`, new domains or new user-facing MCP tools to obtain access. Keep the existing CSP intact.

`--serve` exposes only the existing production preview on loopback with isolated data. Stop the process when inspection is finished. No agent control endpoint or new MCP API is needed.
