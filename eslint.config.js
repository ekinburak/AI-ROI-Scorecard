import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "coverage/**", "python/**", "examples/python/**"],
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        fetch: "readonly",
        structuredClone: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["examples/dashboard/**/*.mjs"],
    languageOptions: {
      globals: {
        customElements: "readonly",
        document: "readonly",
        window: "readonly",
      },
    },
  },
);
