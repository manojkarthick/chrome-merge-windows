import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
const output = new URL(`../dist/chrome-merge-windows-${manifest.version}.zip`, import.meta.url);
mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
rmSync(output, { force: true });
const files = ["manifest.json", "background.js", "merge.js", "popup.html", "popup.css", "popup.js", "icons/16.png", "icons/32.png", "icons/48.png", "icons/128.png"];
const zipped = spawnSync("zip", ["-X", "-q", fileURLToPath(output), ...files], {
  cwd: new URL("../extension/", import.meta.url), stdio: "inherit",
});
if (zipped.error) throw new Error("Install a zip CLI to build the archive.", { cause: zipped.error });
if (zipped.status) process.exit(zipped.status);
console.log(fileURLToPath(output));
