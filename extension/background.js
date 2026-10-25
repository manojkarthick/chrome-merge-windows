import { mergeWindows } from "./merge.js";

let running;
let successBadgeTimer;
let report;

async function feedback(text, color, title) {
  await Promise.allSettled([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setTitle({ title }),
  ]);
}

async function run(windowId, activeTabId) {
  clearTimeout(successBadgeTimer);
  await feedback("…", "#36576b", "Merging windows…");
  const result = await mergeWindows(chrome, windowId, activeTabId);
  const splitNote = result.rebuiltSplits ? ` Rebuilt ${result.rebuiltSplits} source split view${result.rebuiltSplits === 1 ? "" : "s"} side-by-side at 50/50.` : "";
  await feedback(result.ok ? "✓" : "!", result.ok ? "#28664b" : "#a32f2f", `Last merge: ${result.message}${splitNote}`);
  if (result.ok) {
    // Brief feedback only; the result remains available in the toolbar tooltip.
    successBadgeTimer = setTimeout(() => {
      chrome.action.setBadgeText({ text: "" }).catch(() => {});
    }, 1000);
  }
  return result;
}

async function handleClick(tab) {
  if (running) return;
  running = true;
  try {
    let result;
    try {
      result = await run(tab.windowId, tab.id);
    } catch (error) {
      result = { ok: false, message: `Merge interrupted: ${error.message}. Inspect the windows before trying again.` };
      await feedback("!", "#a32f2f", `Last merge: ${result.message}`);
    }
    if (result.ok) return;
    report = { windowId: tab.windowId, result };
    try {
      // Configure the popup only while opening details. Clearing the setting
      // afterward lets the next toolbar click invoke another merge directly.
      await chrome.action.setPopup({ popup: "popup.html" });
      await chrome.action.openPopup({ windowId: tab.windowId });
    } catch {
      // If Chrome cannot open details, the badge and tooltip retain the result.
    } finally {
      await chrome.action.setPopup({ popup: "" });
    }
  } finally {
    running = false;
  }
}

chrome.action.onClicked.addListener(handleClick);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") || message?.type !== "report") return;
  sendResponse(report?.windowId === message.windowId ? report.result : null);
});
