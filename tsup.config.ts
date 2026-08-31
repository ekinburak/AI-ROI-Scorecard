import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "storage/index": "src/storage/index.ts",
    "storage/sqlite": "src/storage/sqlite.ts",
    "storage/postgres": "src/storage/postgres.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  noExternal: ["@noble/hashes"],
  target: "es2022",
});
