import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeWindows } from "../extension/merge.js";
import { browser } from "./browser-model.mjs";

const target = { id: 10, tabs: [{ id: 1, pinned: true }, { id: 2, active: true }] };
const run = (state, windowId = 10, active = 2) => mergeWindows(state.api, windowId, active);
const ids = (state, windowId = 10) => state.windows.find((win) => win.id === windowId).tabs.map((tab) => tab.id);

test("keeps live identities, destination-first pin sections, source ID order, and original active tab", async () => {
  const state = browser([target, { id: 30, tabs: [{ id: 5, pinned: true }, { id: 6 }] }, { id: 20, tabs: [{ id: 3, pinned: true }, { id: 4 }] }]);
  const live = state.get(4);
  live.state = { form: "unsaved", history: ["first", "second"] };
  const result = await run(state);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.moved, 4);
  assert.equal(result.mergedWindows, 2);
  assert.equal(result.rebuiltSplits, 0);
  assert.deepEqual(ids(state), [1, 3, 5, 2, 4, 6]);
  assert.equal(state.get(4), live);
  assert.equal(state.get(4).state.form, "unsaved");
  assert.equal(state.get(2).active, true);
  assert.equal(state.windows.length, 1);
});

test("repairs pins cleared by a native transfer", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, pinned: true }, { id: 4 }] }], { unpin: true });
  assert.equal((await run(state)).ok, true);
  assert.equal(state.get(3).pinned, true);
  assert.deepEqual(ids(state), [1, 3, 2, 4]);
});

test("moves groups intact among ungrouped tabs without changing group metadata", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3 }, { id: 4, groupId: 8 }, { id: 5, groupId: 8 }, { id: 6 }] }, { id: 30, tabs: [{ id: 7, groupId: 9 }] }], {
    groups: [{ id: 8, windowId: 20, title: "Notes", color: "red", collapsed: true }, { id: 9, windowId: 30 }], expandGroups: true,
  });
  const result = await run(state);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(ids(state), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(state.moves.map(({ kind, id }) => [kind, id]), [["tab", 3], ["group", 8], ["tab", 6], ["group", 9]]);
  assert.deepEqual(state.groups.get(8), { id: 8, windowId: 10, title: "Notes", color: "red", collapsed: true });
  assert.equal(state.get(2).active, true);
});

test("attempts split source windows along with ordinary tabs in source order", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3 }, { id: 4, splitViewId: 7 }, { id: 5, splitViewId: 7 }] }, { id: 30, tabs: [{ id: 6 }] }]);
  const result = await run(state);
  assert.equal(result.ok, true);
  assert.equal(result.moved, 4);
  assert.equal(result.rebuiltSplits, 0);
  assert.deepEqual(ids(state), [1, 2, 3, 4, 5, 6]);
  assert.equal(state.get(4).splitViewId, 7);
  assert.equal(state.get(5).splitViewId, 7);
  assert.equal(state.get(2).active, true);
  assert.deepEqual(state.splitCreations, []);
});

test("attempts a source split inside a native group as one group move", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, groupId: 8, splitViewId: 7 }, { id: 4, groupId: 8, splitViewId: 7 }] }], { groups: [{ id: 8, windowId: 20 }] });
  const result = await run(state);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(state.moves.map(({ kind, id }) => [kind, id]), [["group", 8]]);
  assert.deepEqual(ids(state), [1, 2, 3, 4]);
  assert.equal(state.get(3).splitViewId, 7);
  assert.equal(state.get(4).splitViewId, 7);
  assert.deepEqual(state.splitCreations, []);
});

test("rebuilds flattened source splits while retaining live tabs and restoring activation", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, splitViewId: 7 }, { id: 4, splitViewId: 7 }] }], { breakSplits: true, activateSplit: true });
  const live = state.get(3);
  live.state = { form: "unsaved" };
  const result = await run(state);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.rebuiltSplits, 1);
  assert.ok(state.get(3).splitViewId >= 0);
  assert.notEqual(state.get(3).splitViewId, 7);
  assert.equal(state.get(3).splitViewId, state.get(4).splitViewId);
  assert.deepEqual(state.splitCreations, [[3, 4]]);
  assert.equal(result.moved, 2);
  assert.deepEqual(ids(state), [1, 2, 3, 4]);
  assert.equal(state.get(3), live);
  assert.equal(state.get(3).state.form, "unsaved");
  assert.equal(state.get(2).active, true);
});

test("preserves destination split pairs and group identity", async () => {
  const state = browser([{ id: 10, tabs: [{ id: 1, splitViewId: 5, groupId: 8 }, { id: 2, active: true, splitViewId: 5, groupId: 8 }] }, { id: 20, tabs: [{ id: 3 }] }], { groups: [{ id: 8, windowId: 10 }] });
  const result = await run(state);
  assert.equal(result.ok, true);
  assert.equal(result.rebuiltSplits, 0);
  assert.equal(state.get(1).splitViewId, 5);
  assert.equal(state.get(2).active, true);
});

test("rebuilds pinned source splits in the pinned section", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, pinned: true, splitViewId: 7 }, { id: 4, pinned: true, splitViewId: 7 }, { id: 5 }] }], { breakSplits: true, unpin: true });
  const result = await run(state);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.rebuiltSplits, 1);
  assert.deepEqual(ids(state), [1, 3, 4, 2, 5]);
  assert.equal(state.get(3).pinned, true);
  assert.equal(state.get(4).pinned, true);
  assert.equal(state.get(3).splitViewId, state.get(4).splitViewId);
});

test("rebuilds a grouped split if the native group transfer flattens it", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, groupId: 8, splitViewId: 7 }, { id: 4, groupId: 8, splitViewId: 7 }] }], { groups: [{ id: 8, windowId: 20 }], breakGroupSplits: true });
  const result = await run(state);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.rebuiltSplits, 1);
  assert.deepEqual(state.splitCreations, [[3, 4]]);
  assert.equal(state.get(3).groupId, 8);
  assert.equal(state.get(4).groupId, 8);
});

test("stops rebuilding on a failed split and retains already moved live tabs", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, splitViewId: 7 }, { id: 4, splitViewId: 7 }, { id: 5, splitViewId: 8 }, { id: 6, splitViewId: 8 }, { id: 7, splitViewId: 9 }, { id: 8, splitViewId: 9 }] }], { breakSplits: true });
  const createSplit = state.api.tabs.createSplit;
  state.api.tabs.createSplit = async (pair) => {
    if (pair[0] === 5) throw new Error("Split creation failed.");
    return createSplit(pair);
  };
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.match(result.error, /Could not rebuild a source split view: Split creation failed/);
  assert.equal(result.moved, 6);
  assert.equal(result.rebuiltSplits, 1);
  assert.deepEqual(state.splitCreations, [[3, 4]]);
  assert.deepEqual(ids(state), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(state.get(7).splitViewId, -1);
  assert.equal(state.get(2).active, true);
});

test("rejects a split rebuild that resolves without pairing the tabs", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, splitViewId: 7 }, { id: 4, splitViewId: 7 }] }], { breakSplits: true, noOpSplit: true });
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.match(result.error, /Source tabs were not paired after rebuilding/);
  assert.equal(result.rebuiltSplits, 0);
  assert.equal(result.moved, 2);
});

test("rejects malformed source split snapshots before moving any tabs", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, splitViewId: 7 }] }]);
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.match(result.error, /exactly two tabs/);
  assert.equal(state.moves.length, 0);
});

test("merges minimized windows while excluding unsupported types, other profiles, and other modes", async () => {
  const state = browser([target,
    { id: 20, state: "minimized", tabs: [{ id: 3 }] },
    { id: 30, incognito: true, tabs: [{ id: 4 }] },
    { id: 40, type: "popup", tabs: [{ id: 5 }] },
    { id: 50, profile: "secondary", tabs: [{ id: 6 }] },
    { id: 60, state: "fullscreen", tabs: [{ id: 7 }] },
  ]);
  const result = await run(state);
  assert.equal(result.ok, true);
  assert.deepEqual(state.moves.map((move) => move.id), [3, 7]);
  assert.equal(state.get(3).windowId, 10);
  for (const [id, win] of [[4, 30], [5, 40], [6, 50]]) assert.equal(state.get(id).windowId, win);
});

test("still reports changes to destination splits after rebuilding source splits", async () => {
  const state = browser([{ id: 10, tabs: [{ id: 1, splitViewId: 5 }, { id: 2, active: true, splitViewId: 5 }] }, { id: 20, tabs: [{ id: 3, splitViewId: 7 }, { id: 4, splitViewId: 7 }] }], { breakSplits: true });
  const move = state.api.tabs.move;
  state.api.tabs.move = async (...args) => {
    const result = await move(...args);
    state.get(1).splitViewId = -1;
    state.get(2).splitViewId = -1;
    return result;
  };
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.match(result.error, /split view in the destination changed/);
  assert.equal(result.rebuiltSplits, 1);
  assert.equal(result.moved, 2);
  assert.equal(state.get(2).active, true);
});

test("an Incognito target only receives Incognito tabs", async () => {
  const state = browser([{ ...target, incognito: true }, { id: 20, tabs: [{ id: 3 }] }, { id: 30, incognito: true, tabs: [{ id: 4 }] }]);
  assert.equal((await run(state)).ok, true);
  assert.deepEqual(state.moves.map((move) => move.id), [4]);
});

test("the explicit invocation target wins over enumeration and focus", async () => {
  const state = browser([{ id: 20, focused: true, tabs: [{ id: 3 }] }, target]);
  assert.equal((await run(state)).ok, true);
  assert.equal(state.get(3).windowId, 10);
});

test("no-op and empty source windows stay untouched", async () => {
  for (const windows of [[target], [target, { id: 20, tabs: [] }]]) {
    const state = browser(windows);
    const result = await run(state);
    assert.equal(result.ok, true);
    assert.equal(result.moved, 0);
    assert.equal(state.windows.length, windows.length);
    assert.equal(state.moves.length, 0);
  }
});

test("rejects unavailable, non-normal, empty, and stale-active destinations before moving", async () => {
  for (const [win, id, active] of [[target, -2, 2], [target, 999, 2], [{ ...target, type: "popup" }, 10, 2], [{ id: 10, tabs: [] }, 10, 2], [target, 10, 500]]) {
    const state = browser([win, { id: 20, tabs: [{ id: 3 }] }]);
    assert.equal((await run(state, id, active)).ok, false);
    assert.equal(state.moves.length, 0);
  }
});

test("stops on first failure, reports partial completion, preserves remaining tabs, and restores activation", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3 }, { id: 4 }, { id: 5 }] }], { failID: 4 });
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.equal(result.moved, 1);
  assert.equal(result.mergedWindows, 0);
  assert.match(result.message, /Stopped after 1 tab moved/);
  assert.deepEqual(state.moves.map((move) => move.id), [3, 4]);
  assert.deepEqual(ids(state, 20), [4, 5]);
  assert.equal(state.get(2).active, true);
});

test("failure on first transfer does not close or remove anything", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3 }] }], { failID: 3 });
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.equal(result.moved, 0);
  assert.equal(state.windows.length, 2);
});

test("counts a successful transfer even when pin repair fails", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, pinned: true }, { id: 4 }] }], { unpin: true, failPin: true });
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.equal(result.moved, 1);
  assert.equal(state.get(4).windowId, 20);
  assert.equal(state.get(2).active, true);
});

test("counts partial transfers inside a rejected group move and stops", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3, groupId: 8 }, { id: 4, groupId: 8 }, { id: 5 }] }], {
    groups: [{ id: 8, windowId: 20 }], failGroup: 8, partialGroup: true,
  });
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.equal(result.moved, 1);
  assert.deepEqual(ids(state, 20), [4, 5]);
  assert.equal(state.moves.length, 1);
});

test("detects silent no-op, unexpected order, and lost group identity", async () => {
  for (const options of [{ noOp: true }, { reverse: true }]) {
    const state = browser([target, { id: 20, tabs: [{ id: 3 }] }], options);
    assert.equal((await run(state)).ok, false);
  }
  const state = browser([target, { id: 20, tabs: [{ id: 3, groupId: 8 }] }], { groups: [{ id: 8, windowId: 20 }], loseGroup: true });
  assert.equal((await run(state)).ok, false);
});

test("reports active restoration failure separately after transferred tabs", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3 }] }], { failActive: true });
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.equal(result.moved, 1);
  assert.match(result.error, /Could not restore the active tab/);
});

test("reports a lower bound if destination readback fails", async () => {
  const state = browser([target, { id: 20, tabs: [{ id: 3 }, { id: 4 }] }], { failID: 4 });
  state.api.tabs.query = async () => { throw new Error("Window is closing."); };
  const result = await run(state);
  assert.equal(result.ok, false);
  assert.equal(result.moved, 1);
  assert.equal(result.countExact, false);
  assert.match(result.message, /at least 1 tab/);
});
