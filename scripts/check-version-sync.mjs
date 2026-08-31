import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const pythonManifest = readFileSync(resolve(root, "python/pyproject.toml"), "utf8");
const pythonVersion = pythonManifest.match(/^version = "([^"]+)"$/m)?.[1];

if (!pythonVersion || packageVersion !== pythonVersion) {
  throw new Error(
    `Package versions must match. npm=${packageVersion}; PyPI=${pythonVersion ?? "missing"}`,
  );
}

console.log(`Package versions are synchronized at ${packageVersion}.`);
