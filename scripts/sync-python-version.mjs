import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const manifestPath = resolve(root, "python/pyproject.toml");
const manifest = readFileSync(manifestPath, "utf8");
const updated = manifest.replace(/^version = "[^"]+"$/m, `version = "${packageVersion}"`);

if (manifest === updated && !manifest.includes(`version = "${packageVersion}"`)) {
  throw new Error("Could not locate the Python project version");
}

writeFileSync(manifestPath, updated);
console.log(`Synchronized Python package version to ${packageVersion}.`);
