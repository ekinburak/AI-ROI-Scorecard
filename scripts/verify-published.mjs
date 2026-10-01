import { createHash } from "node:crypto";
import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Only exact matching bytes may be reused during a publication retry.
const [ecosystem, directory, expected = ""] = process.argv.slice(2);
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url),"utf8")).version;
const artifacts = resolve(directory ?? "artifacts");
const response = await fetch(ecosystem === "npm" ? `https://registry.npmjs.org/ai-roi-scorecard/${version}` : `https://pypi.org/pypi/ai-roi-scorecard/${version}/json`);
let state = "new";
if (response.status !== 404) {
  if (!response.ok) throw new Error(`Registry lookup failed (${response.status})`);
  const metadata = await response.json();
  if (ecosystem === "npm") {
    const filename = readdirSync(artifacts).find((file) => file.endsWith(".tgz"));
    const digest = createHash("sha512").update(readFileSync(join(artifacts,filename))).digest("base64");
    if (metadata.dist?.integrity !== `sha512-${digest}`) throw new Error("Existing npm version does not match the tested tarball");
    const tarball = await fetch(metadata.dist.tarball);
    if (!tarball.ok || createHash("sha512").update(new Uint8Array(await tarball.arrayBuffer())).digest("base64") !== digest) throw new Error("Published npm tarball verification failed");
    state = "matching";
  } else if (ecosystem === "pypi") {
    const files = readdirSync(artifacts).filter((file) => file.endsWith(".whl") || file.endsWith(".tar.gz"));
    for (const published of metadata.urls) {
      if (!files.includes(published.filename)) throw new Error("PyPI contains an unexpected release artifact");
      const digest = createHash("sha256").update(readFileSync(join(artifacts,published.filename))).digest("hex");
      if (published.digests.sha256 !== digest) throw new Error(`Existing PyPI artifact differs: ${published.filename}`);
      const download = await fetch(published.url);
      if (!download.ok || createHash("sha256").update(new Uint8Array(await download.arrayBuffer())).digest("hex") !== digest) throw new Error("Published PyPI artifact verification failed");
    }
    state = files.every((file) => metadata.urls.some((entry) => entry.filename === file)) ? "matching" : "partial";
  } else throw new Error("Expected npm or pypi");
}
if (expected === "matching" && state !== "matching") throw new Error(`Release is incomplete: ${state}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
console.log(`${ecosystem} ${version}: ${state}`);
