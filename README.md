# Merge Chrome Windows

A standalone, dependency-free Manifest V3 extension. Click its toolbar icon to move other eligible windows' **existing live tabs** into that window. Requires Chrome 155 or newer.

## Install and use

1. Clone or download this repository and keep it in a permanent location. The extension is ready to load directly from `extension/`; no build is needed.
2. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this repository's `extension/` folder.
3. Pin **Merge Chrome Windows** using Chrome's Extensions menu.
4. Click its icon in the window you want to keep. Merging starts immediately; there is no confirmation or preview.

Successful merges and no-op results open no popup. A successful invocation shows `✓` for about one second, then clears the badge. Only errors show `!` and open a details popup; **Done** dismisses it. The error badge remains until the next invocation. Hover text retains the last result, including if Chrome cannot open details. When source split views need rebuilding, the tooltip reports how many were rebuilt side-by-side at 50/50. Clicking again starts a new invocation; clicks during a merge are ignored. Badges and hover text describe the last invocation in that profile/mode and can appear in other windows too; they are not a per-window history.

To use it privately, enable **Allow in Incognito** in the extension's Details page. Regular and Incognito contexts remain separate. Install the extension separately in each profile where you want it available. No Raycast, AppleScript, global shortcut, helper tab, or backend is involved.

## Merge rules

- Chrome supplies the invocation tab and window directly to the toolbar click handler. Later focus changes do not change the destination.
- All other **normal** windows in the same profile and browsing mode qualify, including minimized windows. Popups, app windows, and developer tools windows are outside the merge scope. Empty sources are left alone.
- Source split pairs are remembered before moving. After transfers, any pair that separated is rebuilt with the same two live tabs, side-by-side at 50/50. A pair that survives a native group move is kept intact. Destination splits keep their original identity; source pairs are verified together even when rebuilding assigns a new split ID.
- Source windows are processed by ascending Chrome window ID. This is deterministic within a browser session; it is not a promise of creation-time order.
- Within Chrome's pinned/unpinned constraint: destination pins, source pins, destination unpinned tabs, source unpinned tabs. Each section keeps its original order; source sections follow source window order.
- Existing tab groups move intact with the native group API. Group identity, name, color, collapse state, and member order are checked. Groups are not merged by matching names.
- The destination's original active tab is restored, including after failure. The extension does not focus, restore, or minimize windows.
- On the first move, split-rebuild, or preservation failure, further work stops. The result counts incoming tabs actually found in the destination. A readback failure explicitly labels the count as a lower bound. Already moved tabs remain in the destination; no rollback is attempted.
- The extension never explicitly closes windows, deletes tabs, discards tabs, or recreates tabs from URLs. Chrome can close source windows automatically after their last tab moves out.

## Privacy and permissions

The only requested permission is **`tabGroups`**, for moving existing groups and checking their appearance. Chrome's basic tab query/move/update APIs do not require the sensitive `tabs` permission. There are no host permissions, content scripts, external requests, analytics, telemetry, remote code, or persistent extension storage. Group metadata and tab IDs are used temporarily during the operation. Status counts and API errors appear in the popup and toolbar tooltip. The extension cannot read page contents, URLs, tab titles, or form values through its granted permissions.

See [PRIVACY.md](PRIVACY.md) for the standalone privacy statement.

## Limits

Live-ID moves keep the existing tabs, which preserves their loaded page state and history where Chrome supports it. Already discarded tabs have no live page state to preserve. Chrome controls native move behavior, saved/shared group bookkeeping, automatic window closure, and split-view handling. This extension does not promise to preserve undocumented browser internals.

Rebuilding a source split resets it to side-by-side at 50/50. Chrome's public API does not expose its original layout or ratio, so stacked or resized pairs lose that arrangement when rebuilt. To keep an existing layout, invoke from the window containing it; destination splits are not rebuilt. Chrome 155's `tabs.createSplit` is required, with no fallback for older versions. Avoid rearranging tabs while a merge runs; a changed or closed tab can stop the operation and leave tabs across windows. Inspect them before clicking again after an error.

Validation coverage and remaining visual/accessibility checks are listed in [VALIDATION.md](VALIDATION.md). Failure injection is identified separately from native Chrome errors.

## Development

Use Node.js 22.15+ and pnpm. There are no npm dependencies and no build step for the extension.

```sh
make check       # syntax, manifest, permission and asset checks
make test        # API-model tests, including deliberate failures
make package     # run checks/tests; create the installable ZIP
make test-live   # integration test; requires agent-browser and Chrome for Testing 155+
```

The live harness starts disposable profiles, serves local fixture pages, enables Incognito only in its test profile, and closes its browsers and removes its profiles afterward. It uses the installed `agent-browser` CLI; no runtime dependency is shipped. See [agent-browser](https://github.com/vercel-labs/agent-browser) for setup. It needs permission to launch browsers and bind a loopback test server in restricted environments. It never attaches to the user's Chrome profile. Browser files and agent-browser's own session metadata are managed by that CLI.

If agent-browser's bundled Chrome is older than 155, set `AGENT_BROWSER_EXECUTABLE_PATH` to a Chrome for Testing 155+ executable before running `make test-live`. The harness checks the browser version before loading the extension. Obtain browser binaries from [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/).

Edit `extension/` and click **Reload** on `chrome://extensions` before testing again. `node scripts/icons.mjs` regenerates the bundled PNG icons.

To create a distributable archive, run `make package`. It writes `dist/chrome-merge-windows-<version>.zip`, using the version from `extension/manifest.json`. `dist/` is generated and gitignored, so a fresh clone has no ZIP. Rebuild after changing the source. Recipients can extract the generated ZIP into a permanent folder and load that folder through **Load unpacked**. An already extracted copy must be replaced after rebuilding; reloading it in Chrome alone does not copy new files into it.

`scripts/package.mjs` uses the system `zip` CLI and an explicit file allowlist; the ZIP contains only runtime assets with `manifest.json` at its root. The packaging regression test uses `unzip` to verify the archive's exact entries and bytes, its manifest-derived filename, and replacement of a stale archive. Nothing is published or signed by these commands.

Implementation and reuse research is recorded in [docs/decisions.md](docs/decisions.md).

## CI and releases

GitHub Actions runs `make package` (checks, tests, and the ZIP build) on every pull request and push to `main`, and keeps the ZIP as a workflow artifact. The live integration test is not run in CI.

`extension/manifest.json` holds the only version number. To release, run the **Release** workflow from the Actions tab on `main` and enter the new version, or use `gh workflow run release.yml -f version=x.y.z`. The workflow:

1. Sets the manifest version with `scripts/bump.mjs`. The run fails unless the version is valid for Chrome and higher than the current one, because the Chrome Web Store rejects an upload that isn't higher than the published version.
2. Runs the full `make package`.
3. Commits `chore: release x.y.z` to `main`, tags it `vx.y.z`, and pushes both.
4. Creates a GitHub release with the ZIP attached. That ZIP is the one to upload to the store.

## License

[MIT](LICENSE)
