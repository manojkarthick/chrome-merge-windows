# Validation

## Automated tests

`make test` runs 27 tests: 26 API-model/worker tests and one packaging regression test. They cover destination-first pinned/unpinned order; live object identity; pin repair; group identity and appearance; keeping intact source splits; rebuilding flattened ungrouped, grouped, and pinned splits; destination split preservation; malformed split snapshots; split-rebuild rejection and silent no-op detection; stopping subsequent rebuilds after a failure; active-tab restoration; minimized-window inclusion; profile/mode/type boundaries; no-op/empty cases; partial tab/group moves; and readback lower bounds.

The worker test verifies silent success, one-second badge expiry, duplicate-click exclusion, rebuilt-split tooltip notes, error-only popups, split-rebuild error reporting, target-specific report access, and feedback when opening details fails. These tests model browser behavior; they do not prove native layout or web-page state preservation.

The packaging test changes the manifest version in a temporary project, builds a real ZIP, compares its exact entries and bytes against runtime assets, changes the source, adds an unwanted archive entry, and verifies that rebuilding replaces stale contents. It requires system `zip` and `unzip` tools.

## Real-browser integration

`make test-live` requires agent-browser and Chrome for Testing 155+. Set `AGENT_BROWSER_EXECUTABLE_PATH` when the bundled browser is older. The harness starts fresh disposable profiles, enables Incognito only in its test profile, serves local fixture pages, and closes/removes its browser profiles afterward.

A disposable extension copy exposes its registered click handler to the debugger; this test hook is absent from the shipped package. The harness calls the handler inside the real service worker and observes native popup targets. It does not simulate a physical mouse click on the toolbar.

The fixture creates real ungrouped, grouped, pinned, and destination split views through `chrome.tabs.createSplit`. It checks that flattened source pairs are rebuilt with their original live tab IDs, intact grouped pairs are kept, destination split IDs remain unchanged, and final order/pins/groups/activation match. It also records activation before and after native split creation.

Other checks cover minimized-window merging; profile/mode/type boundaries; unsaved form input, unchanged page identity, and working navigation history; one-second success feedback; silent success/no-op results; and the real partial-failure popup followed by a successful retry. Move failures are injected between real transfers. Group-partial/readback failures are modeled only.

The second profile runs in a separate browser process. Two profiles in one interactive Chrome process remain a manual scenario. API tests do not inspect Chrome's native help tips or measure split proportions.

Results on October 24, 2026: **27/27 automated tests and 20/20 live integration checks passed** with Chrome for Testing **155.0.8059.84** in headless mode. Ungrouped and pinned source pairs were rebuilt with new split IDs and the same tab IDs. The grouped source split retained its original split ID through `tabGroups.move`, so it was not rebuilt. Destination split identity remained unchanged. Neither of the two rebuild calls changed the destination's active tab in this fixture. No conclusion is drawn about native in-product help tips because browser chrome was not visually inspected.

## Remaining manual checks

Use disposable profiles and local test pages:

1. Physically click the toolbar icon and confirm success shows only a brief tick. Trigger a move error and check popup readability in light/dark modes, keyboard focus, and screen-reader announcements.
2. Resize a source split or stack it vertically. After an ungrouped transfer, confirm it is re-paired side-by-side at 50/50. Check whether Chrome displays an in-product help tip. Original source layout/ratio are not available to the extension.
3. Resize a destination split and merge other windows into it. Confirm its visible layout/proportions stay intact; automated tests check membership and identity.
4. Open two profiles in one interactive Chrome process and confirm each invocation merges only that profile and browsing mode.
5. Run a large merge including minimized windows. Confirm no popup appears during work and only errors open details.
6. Make a source tab disappear or lock a tab strip during transfer. Confirm a partial-completion error and that no remaining tabs are removed. There is no rollback or explicit source-window closure.

The static check validates Manifest V3, Chrome 155 minimum, the sole `tabGroups` permission, split Incognito configuration, referenced assets, JavaScript syntax, and absence of tab/window creation, removal, discard, or network calls. `createSplit` pairs existing tabs; it does not create new pages. Packaging uses an allowlist and derives the archive version from the manifest. Generated archives and previously extracted copies must be rebuilt/replaced after source changes; `make check` does not require generated `dist/` files.
