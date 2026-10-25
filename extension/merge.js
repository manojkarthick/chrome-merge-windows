const sortedTabs = (win) => [...(win.tabs ?? [])].sort((a, b) => a.index - b.index);
const groupId = (tab) => tab.groupId ?? -1;
const splitId = (tab) => tab.splitViewId ?? -1;
const noun = (count, singular) => `${count} ${singular}${count === 1 ? "" : "s"}`;

export function describeResult(result) {
  const summary = result.ok
    ? result.moved
      ? `Merged ${noun(result.moved, "tab")} from ${noun(result.mergedWindows, "window")}.`
      : "No other eligible windows to merge."
    : `Stopped after ${result.countExact ? "" : "at least "}${noun(result.moved, "tab")} moved. ${result.error} Inspect the remaining windows before trying again.`;
  return summary;
}

export async function mergeWindows(api, windowId, activeTabId) {
  const result = { ok: false, moved: 0, mergedWindows: 0, countExact: true, rebuiltSplits: 0 };
  let sources = [];
  let incoming = [];
  const confirmed = new Set();
  let target;
  let error;

  try {
    if (!Number.isInteger(windowId) || windowId < 0) throw new Error("The invocation window is unavailable.");
    target = await api.windows.get(windowId, { populate: true });
    if (target.type !== "normal") throw new Error("Invoke this extension in a normal Chrome window.");
    const original = sortedTabs(target);
    const originalSplits = new Map(original.map((tab) => [tab.id, splitId(tab)]));
    if (!original.some((tab) => tab.id === activeTabId && tab.active)) {
      throw new Error("The original active tab is unavailable; no tabs moved.");
    }

    // Chrome exposes only this extension's profile. Split Incognito contexts plus
    // this explicit mode check keep regular and Incognito windows separate.
    const candidates = (await api.windows.getAll({ populate: true, windowTypes: ["normal"] }))
      .filter((win) => win.id !== windowId && win.type === "normal" && win.incognito === target.incognito)
      .sort((a, b) => a.id - b.id);
    for (const win of candidates) {
      const tabs = sortedTabs(win);
      if (tabs.length) sources.push({ ...win, tabs });
    }
    incoming = sources.flatMap((win) => win.tabs);
    const sourceSplits = new Map();
    for (const tab of incoming) {
      const id = splitId(tab);
      if (id < 0) continue;
      if (!sourceSplits.has(id)) sourceSplits.set(id, []);
      sourceSplits.get(id).push(tab.id);
    }
    if ([...sourceSplits.values()].some((pair) => pair.length !== 2)) {
      throw new Error("A source split view does not contain exactly two tabs; no tabs moved.");
    }
    const all = [...original, ...incoming];
    const expected = [...all.filter((tab) => tab.pinned), ...all.filter((tab) => !tab.pinned)];
    const groups = new Map();
    for (const tab of all) {
      if (groupId(tab) >= 0 && !groups.has(groupId(tab))) {
        groups.set(groupId(tab), await api.tabGroups.get(groupId(tab)));
      }
    }
    let pinnedCount = original.filter((tab) => tab.pinned).length;
    for (const source of sources) {
      const movedGroups = new Set();
      for (const tab of source.tabs) {
        const id = groupId(tab);
        if (id >= 0 && movedGroups.has(id)) continue;
        if (id >= 0) {
          await api.tabGroups.move(id, { windowId, index: -1 });
          movedGroups.add(id);
          for (const member of source.tabs.filter((item) => groupId(item) === id)) {
            const actual = await api.tabs.get(member.id);
            if (actual.windowId !== windowId) throw new Error("A group tab did not reach the destination.");
            confirmed.add(member.id);
            if (groupId(actual) !== id) throw new Error("A moved tab lost its group.");
          }
          const actualGroup = await api.tabGroups.get(id);
          const originalGroup = groups.get(id);
          if (actualGroup.collapsed !== originalGroup.collapsed) {
            await api.tabGroups.update(id, { collapsed: originalGroup.collapsed });
          }
        } else {
          await api.tabs.move(tab.id, { windowId, index: tab.pinned ? pinnedCount : -1 });
          const actual = await api.tabs.get(tab.id);
          if (actual.windowId !== windowId) throw new Error("A tab did not reach the destination.");
          // Count the transfer even if a later pin repair fails.
          confirmed.add(tab.id);
          if (actual.pinned !== tab.pinned) await api.tabs.update(tab.id, { pinned: tab.pinned });
          if (tab.pinned) pinnedCount++;
        }
      }
    }

    for (const pair of sourceSplits.values()) {
      const [first, second] = await Promise.all(pair.map((id) => api.tabs.get(id)));
      if (splitId(first) >= 0 && splitId(first) === splitId(second)) continue;
      try {
        // Native single-tab transfers can dissolve a split. Chrome recreates
        // the pair side-by-side at 50/50; its original layout is not exposed.
        await api.tabs.createSplit(pair);
        const [rebuiltFirst, rebuiltSecond] = await Promise.all(pair.map((id) => api.tabs.get(id)));
        if (splitId(rebuiltFirst) < 0 || splitId(rebuiltFirst) !== splitId(rebuiltSecond)) {
          throw new Error("Source tabs were not paired after rebuilding.");
        }
        result.rebuiltSplits++;
      } catch (cause) {
        throw new Error(`Could not rebuild a source split view: ${cause.message}`);
      }
    }

    const final = (await api.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
    if (final.length !== expected.length || final.some((tab, index) => {
      const before = expected[index];
      return tab.id !== before.id || tab.pinned !== before.pinned ||
        groupId(tab) !== groupId(before);
    })) throw new Error("The final tab order, pins, or groups did not match.");
    if (final.some((tab) => originalSplits.has(tab.id) && splitId(tab) !== originalSplits.get(tab.id))) {
      throw new Error("A split view in the destination changed during the merge.");
    }
    const finalById = new Map(final.map((tab) => [tab.id, tab]));
    for (const [first, second] of sourceSplits.values()) {
      if (splitId(finalById.get(first)) < 0 || splitId(finalById.get(first)) !== splitId(finalById.get(second))) {
        throw new Error("A source split view was not paired after the merge.");
      }
    }

    for (const [id, before] of groups) {
      const after = await api.tabGroups.get(id);
      if (after.windowId !== windowId || ["title", "color", "collapsed"].some((key) => after[key] !== before[key])) {
        throw new Error("A tab group's appearance did not match.");
      }
    }
  } catch (cause) {
    error = cause.message || String(cause);
  }

  if (target?.type === "normal" && Number.isInteger(activeTabId)) {
    try {
      const active = await api.tabs.get(activeTabId);
      if (active.windowId !== windowId) throw new Error("The original active tab changed windows.");
      if (!active.active) await api.tabs.update(activeTabId, { active: true });
    } catch (cause) {
      error = [error, `Could not restore the active tab: ${cause.message}`].filter(Boolean).join(" ");
    }
  }

  // A rejected group operation may have transferred some members. Read back
  // actual destinations instead of treating a rejection as an atomic failure.
  if (incoming.length) {
    try {
      const destination = new Set((await api.tabs.query({ windowId })).map((tab) => tab.id));
      result.moved = incoming.filter((tab) => destination.has(tab.id)).length;
      result.mergedWindows = sources.filter((win) => win.tabs.every((tab) => destination.has(tab.id))).length;
    } catch (cause) {
      result.moved = confirmed.size;
      result.countExact = false;
      error = [error, `Could not verify transferred tabs: ${cause.message}`].filter(Boolean).join(" ");
    }
  }
  result.ok = !error;
  if (error) result.error = error;
  result.message = describeResult(result);
  return result;
}
