# Privacy

Merge Chrome Windows runs locally in Chrome. It sends no data to a server and has no telemetry, analytics, advertisements, backend, or remote code.

It uses tab/window IDs, tab positions, pin and group/split membership, browsing mode, window state, and tab-group appearance to merge eligible windows. These values are used temporarily. It does not request permission to read visited URLs, page titles, website contents, browsing history, or unsaved form contents. It moves existing tabs instead of reading or recreating their pages.

The `tabGroups` permission allows it to move groups and preserve their appearance. Chrome's basic Tabs and Windows operations need no additional permission for this purpose.

There is no persistent extension storage. A result summary and any Chrome API error are shown in the popup and toolbar hover text. Regular and Incognito runs use separate extension contexts; Incognito requires the user's explicit enablement in Chrome. Other profiles are outside the extension instance's API scope.
