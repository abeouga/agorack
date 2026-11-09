// 本番用のビルド：src/main.ts を esbuild で dist/main.js の1ファイルにまとめる。
// - 共通の契約（@agorack/*）は TypeScript のソースのまま公開しているので、取り込んでまとめる
// - それ以外の依存（hono・zod など）はまとめず、実行時に node_modules から読む
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const serverDir = fileURLToPath(new URL("..", import.meta.url));

/** @type {import("esbuild").Plugin} */
const externalizeDependencies = {
  name: "externalize-dependencies",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === "entry-point" || args.path.startsWith("@agorack/")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await build({
  absWorkingDir: serverDir,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  plugins: [externalizeDependencies],
  logLevel: "info",
});
