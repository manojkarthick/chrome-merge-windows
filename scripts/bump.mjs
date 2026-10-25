import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../extension/manifest.json", import.meta.url);
const source = readFileSync(path, "utf8");
const current = JSON.parse(source).version;
const next = process.argv[2];
// Chrome accepts one to four dot-separated integers, each 0-65535, without leading zeros.
const parse = (version) => /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(version ?? "") ? version.split(".").map(Number) : null;
const parts = parse(next);
if (!parts || parts.some((part) => part > 65535)) {
  console.error(`Usage: make bump VERSION=<x.y.z> (current: ${current})`);
  process.exit(1);
}
const compare = (a, b) => {
  for (let i = 0; i < 4; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
// The Web Store rejects an upload whose version is not higher than the published one.
if (compare(parts, parse(current)) <= 0) {
  console.error(`${next} must be higher than the current version ${current}.`);
  process.exit(1);
}
writeFileSync(path, source.replace(`"version": "${current}"`, `"version": "${next}"`));
console.log(`extension/manifest.json: ${current} -> ${next}`);
