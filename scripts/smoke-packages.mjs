import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync, spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(process.argv[2] ?? join(root, "artifacts"));
const files = readdirSync(artifacts);
const archive = join(artifacts, files.find((file) => file.endsWith(".tgz")) ?? "missing.tgz");
const wheel = join(artifacts, files.find((file) => file.endsWith(".whl")) ?? "missing.whl");
const temporary = mkdtempSync(join(tmpdir(), "scorecard-packages-"));
function run(executable, args, {cwd = temporary, input, status = 0} = {}) {
  const result = spawnSync(executable, args, {cwd, input, encoding:"utf8", env:process.env});
  assert.equal(result.status, status, `${executable} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function concurrent(executable, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {cwd:temporary});
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveResult(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
}
try {
  writeFileSync(join(temporary, "package.json"), '{"private":true,"type":"module"}');
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive, "react@19", "react-dom@19"]);
  run("uv", ["venv", join(temporary,"venv"), "--python", process.env.SMOKE_PYTHON ?? "3.11"]);
  const python = join(temporary, "venv/bin/python");
  run("uv", ["pip", "install", "--python", python, wheel]);
  const manifest = JSON.parse(readFileSync(join(root,"package.json"), "utf8"));
  const entries = Object.keys(manifest.exports).map((key) => key === "." ? manifest.name : manifest.name + key.slice(1));
  writeFileSync(join(temporary,"imports.mjs"), `import {createRequire} from 'node:module';\nconst require = createRequire(import.meta.url);\nfor (const entry of ${JSON.stringify(entries)}) { await import(entry); require(entry); }\nfor (const library of [await import('ai-roi-scorecard/storage/sqlite'), require('ai-roi-scorecard/storage/sqlite')]) { const db = new library.SqliteScorecardRepository(); await db.migrate(); await db.close(); }`);
  run(process.execPath,[join(temporary,"imports.mjs")]);
  const commands = [
    [join(temporary,"node_modules/.bin/ai-roi-scorecard"), []],
    [join(temporary,"venv/bin/ai-roi-scorecard"), []],
    [python, ["-m","ai_roi_scorecard"]],
  ];
  const fixture = (name) => join(root,"fixtures",name);
  const generated = "2026-08-28T08:00:00.000Z";
  const snapshots = [], estimates = [];
  for (const [index, [exe, prefix]] of commands.entries()) {
    const cli = (args, options) => run(exe,[...prefix,...args],options);
    assert.equal(cli(["--version"]).trim(), manifest.version);
    const db = join(temporary,`ledger-${index}.sqlite`);
    assert.deepEqual(JSON.parse(cli(["init","--db",db])), {initialized:true});
    cli(["init","--db",db]);
    cli(["policies","import","--db",db,"--input",fixture("cli/policies.json")]);
    cli(["policies","import","--db",db,"--input",fixture("cli/policies.json")]);
    const policies = JSON.parse(readFileSync(fixture("cli/policies.json"),"utf8"));
    policies[0].manualMinutesPerUnit++;
    cli(["policies","import","--db",db,"--input","-"], {input:JSON.stringify(policies),status:2});
    const ingest = ["ingest","--db",db,"--account","demo-account","--input",fixture("golden-otlp.input.json"),"--input-format","otlp"];
    assert.deepEqual(JSON.parse(cli(ingest)), {spans:1,mapped:3,appended:3,skipped:0});
    assert.deepEqual(JSON.parse(cli(ingest)), {spans:1,mapped:3,appended:0,skipped:3});
    const parallel = await Promise.all(Array.from({length:8}, () => concurrent(exe,[...prefix,...ingest])));
    assert(parallel.every((result) => result.appended === 0 && result.skipped === 3));
    const report = ["report","--db",db,"--input",fixture("cli/report.json"),"--generated-at",generated];
    const snapshot = JSON.parse(cli(report));
    snapshots.push(snapshot);
    assert.equal(snapshot.schemaVersion,2);
    assert.equal(snapshot.runtimeMeasurement,"measured");
    assert.equal(snapshot.totals.timeSavedMs,"2698800"); // approved triage baseline is 45 minutes
    assert.equal(JSON.parse(cli(report)).snapshotHash,snapshot.snapshotHash);
    for (const format of ["text","html"]) {
      const output = join(temporary,`report-${index}.${format}`);
      assert.equal(cli([...report,"--format",format,"--output",output]), "");
      assert(readFileSync(output,"utf8").includes("Estimated"));
      cli(["render","--input",output,"--format",format],{status:2}); // rendered text is not snapshot JSON
      cli(["render","--input",fixture("golden-v1.expected.json"),"--format",format]);
    }
    estimates.push(JSON.parse(cli(["estimate","--input","-"],{input:readFileSync(fixture("cli/estimate.json"),"utf8")})));
    cli(["estimate","--input",fixture("cli/estimate.json"),"--format","text"]);
    cli(["estimate","--input",fixture("cli/estimate.json"),"--format","html"]);
    const omitted = join(temporary,`omit-${index}.sqlite`);
    cli(["policies","import","--db",omitted,"--input",fixture("cli/policies.json")]);
    cli(["ingest","--db",omitted,"--account","demo-account","--input",fixture("cli/logs.json"),"--input-format","json","--mapping",fixture("cli/mapping.json"),"--duration-mode","omit"]);
    const unmeasured = JSON.parse(cli(["report","--db",omitted,"--input",fixture("cli/report.json"),"--generated-at",generated]));
    assert.equal(unmeasured.runtimeMeasurement,"not_provided");
    assert.equal(unmeasured.totals.timeSavedMs,null);
    assert.equal(unmeasured.totals.estimatedValueMinor,snapshot.totals.estimatedValueMinor);
    assert(cli(["report","--db",omitted,"--input",fixture("cli/report.json"),"--generated-at",generated,"--format","text"]).includes("Manual hours replaced"));
    const wrongAccount = [...ingest]; wrongAccount[4] = "other";
    cli(wrongAccount,{status:2});
    const otlp = JSON.parse(readFileSync(fixture("golden-otlp.input.json"),"utf8"));
    for (const units of [0, -1, 1.5, true, 1_000_000_001]) {
      const invalid = structuredClone(otlp);
      invalid.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({key:"roi.units",value:typeof units === "boolean" ? {boolValue:units} : {doubleValue:units}});
      cli(["ingest","--db",db,"--account","demo-account","--input","-","--input-format","otlp"],{input:JSON.stringify(invalid),status:2});
    }
    const conflict = structuredClone(otlp);
    conflict.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({key:"roi.units",value:{intValue:"2"}});
    cli(["ingest","--db",db,"--account","demo-account","--input","-","--input-format","otlp"],{input:JSON.stringify(conflict),status:2});
    assert.equal(JSON.parse(cli(report)).snapshotHash,snapshot.snapshotHash);
    cli(["ingest","--db",db,"--account","demo-account","--input","-","--input-format","json"],{input:"{}",status:2});
    const attentionDb = join(temporary,`attention-${index}.sqlite`);
    cli([...ingest.slice(0,2),attentionDb,...ingest.slice(3)]);
    assert.equal(JSON.parse(cli(["report","--db",attentionDb,"--input",fixture("cli/report.json"),"--generated-at",generated],{status:3})).status,"needs_attention");
    const emptyDb = join(temporary,`empty-${index}.sqlite`);
    assert.equal(JSON.parse(cli(["report","--db",emptyDb,"--input",fixture("cli/report.json"),"--generated-at",generated])).status,"send_not_recommended");
    cli(["init","--db",join(temporary,"missing/directory/db")],{status:1});
    cli(["report","--db",db,"--input",fixture("cli/report.json"),"--generated-at","invalid"],{status:2});
    cli(["unknown"],{status:2});
  }
  assert.deepEqual(snapshots[0], snapshots[1]); assert.deepEqual(snapshots[1], snapshots[2]);
  assert.deepEqual(estimates[0], estimates[1]); assert.deepEqual(estimates[1], estimates[2]);
  console.log("Installed npm ESM/CJS entries and npm/Python CLIs passed; snapshots and hashes match.");
} finally { rmSync(temporary,{recursive:true,force:true}); }
