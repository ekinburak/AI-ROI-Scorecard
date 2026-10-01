import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    dashboard: "src/dashboard/index.ts",
    "dashboard/react": "src/dashboard/react.tsx",
    "storage/index": "src/storage/index.ts",
    "storage/sqlite": "src/storage/sqlite.ts",
    "storage/postgres": "src/storage/postgres.ts",
    adapters: "src/adapters/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  noExternal: ["@noble/hashes"],
  external: ["react", "react-dom"],
  target: "es2022",
  removeNodeProtocol: false,
});
