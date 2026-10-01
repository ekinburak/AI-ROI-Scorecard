import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toDashboardViewModel } from "../dist/index.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/golden-v1.expected.json", import.meta.url),
);
const outputPath = fileURLToPath(
  new URL("../fixtures/golden-dashboard-view.expected.json", import.meta.url),
);

const snapshot = JSON.parse(readFileSync(fixturePath, "utf8"));
const view = toDashboardViewModel(snapshot, {
  accountName: "Demo account",
  periodState: "open",
});
writeFileSync(outputPath, `${JSON.stringify(view, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
