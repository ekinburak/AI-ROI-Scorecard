import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const requestedRoots = process.argv.slice(2).map((entry) => resolve(entry));
const roots = requestedRoots.length ? requestedRoots : [root];
const excludedDirectories = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
]);
const binaryExtensions = new Set([
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".pyc",
  ".tar",
  ".tgz",
  ".woff",
  ".woff2",
  ".zip",
]);
const genericPatterns = [
  { label: "absolute workstation path", pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "common access token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/ },
  { label: "consumer email address", pattern: /\b[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo)\.[A-Z]{2,}\b/i },
];
const privateTerms = (process.env.PRIVATE_BOUNDARY_TERMS ?? "")
  .split("\n")
  .map((term) => term.trim())
  .filter(Boolean)
  .map((term) => {
    const word = term.startsWith("word:");
    const value = word ? term.slice("word:".length) : term.replace(/^literal:/, "");
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      value,
      pattern: word ? new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "i") : null,
    };
  });

function filesBelow(path) {
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) return [];
    return filesBelow(join(path, entry.name));
  });
}

const failures = [];
for (const file of roots.flatMap(filesBelow)) {
  if (binaryExtensions.has(extname(file).toLowerCase())) continue;
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const displayPath = relative(root, file) || file;
  for (const { label, pattern } of genericPatterns) {
    if (pattern.test(content) || pattern.test(displayPath)) failures.push(`${displayPath}: ${label}`);
  }
  const lowerContent = content.toLowerCase();
  const lowerPath = displayPath.toLowerCase();
  for (const term of privateTerms) {
    const found = term.pattern
      ? term.pattern.test(content) || term.pattern.test(displayPath)
      : lowerContent.includes(term.value.toLowerCase()) || lowerPath.includes(term.value.toLowerCase());
    if (found) {
      failures.push(`${displayPath}: private boundary term`);
    }
  }
}

if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exit(1);
}

console.log(`Public boundary check passed (${privateTerms.length} owner terms loaded).`);
