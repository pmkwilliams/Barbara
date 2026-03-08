import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["node_modules/", "dist/", "**/drizzle/"]
  },
  {
    ...js.configs.recommended,
    files: ["**/*.ts"],
  },
  ...tseslint.configs.recommended
];
