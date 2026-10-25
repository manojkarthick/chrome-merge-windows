import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, "155");
assert.deepEqual(manifest.permissions, ["tabGroups"]);
assert.equal(manifest.incognito, "split");
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.action.default_popup, undefined);
for (const path of [manifest.background.service_worker, "popup.html", ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
  assert.ok(existsSync(new URL(path, root)), `Missing ${path}`);
}
for (const name of readdirSync(root).filter((name) => name.endsWith(".js"))) {
  const checked = spawnSync(process.execPath, ["--check", new URL(name, root).pathname], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const source = readFileSync(new URL(name, root), "utf8");
  assert.doesNotMatch(source, /\b(?:tabs|windows)\.(?:create|remove|discard)\s*\(/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
}
console.log("Manifest, package assets, JavaScript syntax, and permission checks passed.");
