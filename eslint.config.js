// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * 依存の向き（docs/architecture.md §4）を import の規則で守る。
 * apps/web と apps/server は互いを import せず、共有は packages/contracts だけにする。
 * packages/contracts は apps を import しない。
 */
const forbid = (/** @type {string} */ target, /** @type {string} */ message) => ({
  regex: String.raw`(^@agorack/${target}(/|$))|((^|/)apps/${target}(/|$))|(^(\.\./)+${target}(/|$))`,
  message,
});

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", "**/build/", "**/coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["apps/server/**/*.{ts,tsx,mjs}"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            forbid(
              "web",
              "サーバーから画面（apps/web）を import しない。共有するものは packages/contracts に置く。",
            ),
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            forbid(
              "server",
              "画面からサーバー（apps/server）を import しない。共有するものは packages/contracts に置く。",
            ),
          ],
        },
      ],
    },
  },
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            forbid("web", "契約から画面（apps/web）を import しない。"),
            forbid("server", "契約からサーバー（apps/server）を import しない。"),
          ],
        },
      ],
    },
  },
  { files: ["*.js"], languageOptions: { globals: globals.node } },
  prettier,
);
