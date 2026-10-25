import assert from "node:assert/strict";
import { test } from "node:test";
import { browser } from "./browser-model.mjs";

test("toolbar clicks silently merge minimized and split sources, with tooltip notes and error-only popups", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = browser([{ id: 10, tabs: [{ id: 1, active: true }] }, { id: 20, tabs: [{ id: 2 }, { id: 3 }] }, { id: 30, state: "minimized", tabs: [{ id: 4, splitViewId: 7 }, { id: 5, splitViewId: 7 }] }], { breakSplits: true });
  const badges = [];
  const titles = [];
  const popups = [];
  let click;
  let message;
  let release;
  let failPopup = false;
  let popupSetting = "";
  const gate = new Promise((resolve) => { release = resolve; });
  const move = state.api.tabs.move;
  state.api.tabs.move = async (...args) => { await gate; return move(...args); };
  globalThis.chrome = {
    ...state.api,
    runtime: {
      id: "test-extension",
      getURL: (path) => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: (callback) => { message = callback; } },
    },
    action: {
      onClicked: { addListener: (callback) => { click = callback; } },
      async setBadgeText({ text }) { badges.push(text); },
      async setBadgeBackgroundColor() {},
      async setTitle({ title }) { titles.push(title); },
      async setPopup({ popup }) { popupSetting = popup; },
      async openPopup({ windowId }) {
        assert.equal(popupSetting, "popup.html");
        if (failPopup) throw new Error("Window is unavailable.");
        popups.push(windowId);
      },
    },
  };
  await import("../extension/background.js");
  const tab = { id: 1, windowId: 10 };
  const merge = click(tab);
  await click(tab);
  await click({ id: 2, windowId: 20 });
  release();
  await merge;
  assert.deepEqual(state.moves.map((item) => item.id), [2, 3, 4, 5]);
  assert.deepEqual(badges, ["…", "✓"]);
  assert.deepEqual(popups, [], "Success must never open a popup");
  assert.match(titles.at(-1), /Rebuilt 1 source split view side-by-side at 50\/50/);
  assert.equal(state.get(1).active, true);
  t.mock.timers.tick(999);
  assert.equal(badges.at(-1), "✓");
  t.mock.timers.tick(1);
  assert.equal(badges.at(-1), "");

  await click(tab);
  assert.equal(badges.at(-1), "✓");
  assert.deepEqual(popups, [], "A no-op must also stay silent");
  assert.doesNotMatch(titles.at(-1), /Rebuilt/);
  const sender = { id: "test-extension", url: "chrome-extension://test-extension/popup.html" };
  message({ type: "report", windowId: 20 }, sender, (value) => { assert.equal(value, null); });
  message({ type: "report", windowId: 10 }, { id: "unrelated" }, () => assert.fail("Unrelated message accepted"));
  message({ type: "merge", windowId: 10 }, sender, () => assert.fail("Opening details must never start a merge"));

  state.api.windows.getAll = async () => { throw new Error("Window enumeration failed."); };
  await click(tab);
  assert.equal(badges.at(-1), "!");
  assert.deepEqual(popups, [10]);
  assert.equal(popupSetting, "", "The next click must still invoke a merge");
  message({ type: "report", windowId: 20 }, sender, (value) => { assert.equal(value, null); });
  message({ type: "report", windowId: 10 }, sender, (value) => { assert.match(value.message, /Window enumeration failed/); });
  t.mock.timers.tick(1000);
  assert.equal(badges.at(-1), "!", "An old success timer must not erase an error");
  state.api.windows.getAll = async () => [{ id: 10, type: "normal", incognito: false, tabs: state.windows[0].tabs }, { id: 40, type: "normal", incognito: false, tabs: [{ id: 6, index: 0, splitViewId: 12, pinned: false }, { id: 7, index: 1, splitViewId: 12, pinned: false }] }];
  state.windows.push({ id: 40, type: "normal", profile: "primary", incognito: false, tabs: [{ id: 6, windowId: 40, index: 0, splitViewId: 12, pinned: false, groupId: -1 }, { id: 7, windowId: 40, index: 1, splitViewId: 12, pinned: false, groupId: -1 }] });
  state.api.tabs.createSplit = async () => { throw new Error("Split creation failed."); };
  await click(tab);
  assert.equal(badges.at(-1), "!");
  message({ type: "report", windowId: 10 }, sender, (value) => { assert.match(value.message, /Could not rebuild a source split view/); });
  assert.deepEqual(popups, [10, 10]);
  failPopup = true;
  await click(tab);
  assert.equal(badges.at(-1), "!");
  assert.equal(popupSetting, "", "Popup failure must not change the next click's behavior");
  delete globalThis.chrome;
});
