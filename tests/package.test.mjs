import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("packaging uses the manifest version and rebuilds exact runtime contents", (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "chrome-merge-package-test-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  cpSync(new URL("../extension/", import.meta.url), join(fixture, "extension"), { recursive: true });
  mkdirSync(join(fixture, "scripts"));
  cpSync(new URL("../scripts/package.mjs", import.meta.url), join(fixture, "scripts/package.mjs"));
  const manifestPath = join(fixture, "extension/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = "2.3.4";
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const archive = join(fixture, "dist/chrome-merge-windows-2.3.4.zip");
  const entries = ["manifest.json", "background.js", "merge.js", "popup.html", "popup.css", "popup.js", "icons/16.png", "icons/32.png", "icons/48.png", "icons/128.png"];
  const run = (command, args) => {
    const result = spawnSync(command, args);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr.toString());
    return result.stdout;
  };
  const build = () => run(process.execPath, [join(fixture, "scripts/package.mjs")]);
  const verify = () => {
    assert.deepEqual(run("unzip", ["-Z1", archive]).toString().trim().split("\n").sort(), [...entries].sort());
    for (const entry of entries) {
      assert.deepEqual(run("unzip", ["-p", archive, entry]), readFileSync(join(fixture, "extension", entry)), entry);
    }
  };
  build();
  verify();
  writeFileSync(join(fixture, "extension/merge.js"), "export const revised = true;\n");
  writeFileSync(join(fixture, "extension/not-for-distribution.txt"), "Unrelated source file.\n");
  run("zip", ["-q", "-j", archive, join(fixture, "extension/not-for-distribution.txt")]);
  build();
  verify();
});
