const main = document.querySelector("main");
const heading = document.querySelector("#heading");
const status = document.querySelector("#status");
document.querySelector("#close").addEventListener("click", () => window.close());

try {
  const target = await chrome.windows.getCurrent();
  const result = await chrome.runtime.sendMessage({ type: "report", windowId: target.id });
  if (!result) throw new Error("No result received. Inspect the windows and the toolbar tooltip.");
  heading.textContent = "Merge stopped.";
  status.setAttribute("role", "alert");
  status.textContent = result.message;
} catch (error) {
  heading.textContent = "Could not finish.";
  status.setAttribute("role", "alert");
  status.textContent = error.message;
} finally {
  main.setAttribute("aria-busy", "false");
}
