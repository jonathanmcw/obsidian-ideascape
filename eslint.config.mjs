// @ts-check
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["main.js", "styles.css", "node_modules/**", "test/**", "scripts/**", "esbuild.config.mjs", "package-lock.json"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
  },
  {
    // The manifest is checked against the community plugin submission rules. typescript-eslint's parser reads a
    // .json file as one object expression, which is what the rule walks.
    files: ["manifest.json"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parser: tseslint.parser },
    rules: { "obsidianmd/validate-manifest": "error" },
  },
]);
