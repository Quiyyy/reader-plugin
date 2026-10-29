# Reader local delivery

- Follow `docs/WINDOWS_DELIVERY.md` for authorized local plugin updates.
- For a running desktop host, use `prepare → stage → desktop Reader Install/Update → complete`. The desktop installation action rebuilds the original chat's MCP bindings. Do not use external `codex plugin add` as a substitute for that action.
- Keep the currently installed package running while preparing and staging a different version. Same-version repair that requires closing Reader processes or uninstalling the plugin needs explicit user authorization unless already granted in the session; never close unrelated processes.
- Continue authorized local updates automatically, including the normal package, startup and data-integrity checks in `complete`.
- Do not automatically create host-sync requests, schedule follow-up heartbeats, reopen the Reader UI, or require screenshots after every delivery. Perform additional host UI verification only when explicitly requested or needed to diagnose a reported failure.
- Report the checks actually performed. Installation and observed host activation are distinct; do not label an unobserved page as verified, and do not make routine delivery wait for a separate UI acceptance gate.
- Use supported host tools. Do not ask the user to manually update or send “continue” for each version, terminate the desktop app, or fabricate success from a separate server process.
