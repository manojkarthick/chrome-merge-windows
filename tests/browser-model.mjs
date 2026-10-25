export function browser(spec, options = {}) {
  const windows = structuredClone(spec).map((win) => ({ type: "normal", state: "normal", incognito: false, profile: "primary", ...win }));
  const moves = [];
  const splitCreations = [];
  let nextSplitId = Math.max(0, ...windows.flatMap((win) => win.tabs).map((tab) => tab.splitViewId ?? -1)) + 1;
  const groups = new Map((options.groups ?? []).map((group) => [group.id, { title: "Work", color: "blue", collapsed: false, ...group }]));
  function refresh() {
    for (const win of windows) win.tabs.forEach((tab, index) => Object.assign(tab, {
      windowId: win.id, index, pinned: !!tab.pinned, groupId: tab.groupId ?? -1, splitViewId: tab.splitViewId ?? -1,
    }));
  }
  function get(id) {
    const tab = windows.flatMap((win) => win.tabs).find((tab) => tab.id === id);
    if (!tab) throw new Error("Tab is unavailable.");
    return tab;
  }
  function transfer(ids, windowId, index) {
    const target = windows.find((win) => win.id === windowId);
    const tabs = ids.map(get);
    for (const tab of tabs) {
      const source = windows.find((win) => win.id === tab.windowId);
      source.tabs.splice(source.tabs.indexOf(tab), 1);
      if (!source.tabs.length) windows.splice(windows.indexOf(source), 1);
    }
    target.tabs.splice(index === -1 ? target.tabs.length : index, 0, ...tabs);
    // Real cross-window moves can change activation and pin state.
    target.tabs.forEach((tab) => { tab.active = tab === tabs[0]; });
    refresh();
  }
  const forbidden = () => { throw new Error("Must never create, close, discard, or navigate tabs."); };
  refresh();
  const visible = () => windows.filter((win) => win.profile === (options.profile ?? "primary"));
  const api = {
    windows: {
      async get(id) {
        const win = visible().find((item) => item.id === id);
        if (!win) throw new Error("Window is unavailable.");
        return structuredClone(win);
      },
      async getAll() { return structuredClone(visible()); },
      remove: forbidden,
      create: forbidden,
    },
    tabs: {
      async createSplit(ids) {
        splitCreations.push([...ids]);
        if (options.failSplit) throw new Error("Split creation failed.");
        if (ids.length !== 2 || ids[0] === ids[1]) throw new Error("A split requires two distinct tabs.");
        const [first, second] = ids.map(get);
        if (first.windowId !== second.windowId || Math.abs(first.index - second.index) !== 1 || first.pinned !== second.pinned || first.groupId !== second.groupId || first.splitViewId >= 0 || second.splitViewId >= 0) {
          throw new Error("Split tabs must be adjacent, unsplit, and match window, pins, and group.");
        }
        const id = nextSplitId++;
        if (!options.noOpSplit) first.splitViewId = second.splitViewId = id;
        if (options.activateSplit) {
          windows.find((win) => win.id === first.windowId).tabs.forEach((tab) => { tab.active = tab.id === first.id; });
        }
        return id;
      },
      async get(id) { return { ...get(id) }; },
      async query({ windowId }) {
        const win = windows.find((item) => item.id === windowId);
        if (!win) throw new Error("Window is unavailable.");
        return structuredClone(win.tabs);
      },
      async move(id, { windowId, index }) {
        moves.push({ kind: "tab", id, windowId, index });
        if (id === options.failID) throw new Error("Tab strip is not editable.");
        if (options.noOp) return;
        if (options.breakSplits && get(id).splitViewId >= 0) {
          const split = get(id).splitViewId;
          for (const tab of windows.flatMap((win) => win.tabs)) {
            if (tab.splitViewId === split) tab.splitViewId = -1;
          }
        }
        transfer([id], windowId, index);
        if (options.unpin) get(id).pinned = false;
        if (options.reverse) windows.find((win) => win.id === windowId).tabs.reverse();
        refresh();
        return { ...get(id) };
      },
      async update(id, changes) {
        if ("url" in changes) forbidden();
        if (changes.pinned !== undefined && options.failPin) throw new Error("Pin update failed.");
        if (changes.active && options.failActive) throw new Error("Activation failed.");
        const tab = get(id);
        const win = windows.find((item) => item.id === tab.windowId);
        if (changes.active) win.tabs.forEach((other) => { other.active = other.id === id; });
        if (changes.pinned !== undefined && changes.pinned !== tab.pinned) {
          win.tabs.splice(win.tabs.indexOf(tab), 1);
          tab.pinned = changes.pinned;
          win.tabs.splice(win.tabs.filter((other) => other.pinned).length, 0, tab);
        }
        refresh();
        return { ...tab };
      },
      create: forbidden,
      remove: forbidden,
      discard: forbidden,
    },
    tabGroups: {
      async get(id) {
        if (!groups.has(id)) throw new Error("Group is unavailable.");
        return { ...groups.get(id) };
      },
      async move(id, { windowId, index }) {
        moves.push({ kind: "group", id, windowId, index });
        const tabs = windows.flatMap((win) => win.tabs).filter((tab) => tab.groupId === id);
        if (options.failGroup === id) {
          if (options.partialGroup) transfer([tabs[0].id], windowId, index);
          throw new Error("Group transfer failed.");
        }
        transfer(tabs.map((tab) => tab.id), windowId, index);
        if (options.breakGroupSplits) tabs.forEach((tab) => { tab.splitViewId = -1; });
        Object.assign(groups.get(id), { windowId });
        if (options.expandGroups) groups.get(id).collapsed = false;
        if (options.loseGroup) tabs[0].groupId = -1;
        return { ...groups.get(id) };
      },
      async update(id, changes) { Object.assign(groups.get(id), changes); },
    },
  };
  return { api, windows, moves, groups, splitCreations, get };
}
