// サーバーの入口：設定を読み、各部分を組み立てて HTTP を開く（設計 §4.1）。組み立てはここだけで行う。
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { ConfigError, loadConfig, type AppConfig } from "./config/index.js";
import { createHttpApp } from "./http/app.js";

/** apps/server。開発時（src/main.ts）もビルド後（dist/main.js）も1つ上になる */
const serverDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(serverDir, "../..");

function readConfig(): AppConfig {
  const envFile = resolve(serverDir, ".env");
  // 実際の環境変数があれば、そちらを優先する（.env は上書きしない）
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  try {
    return loadConfig({ env: process.env, repoRoot });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const app = createHttpApp({ allowedOrigins: config.server.allowedOrigins });

const { host, port } = config.server;
const shownHost = host.includes(":") ? `[${host}]` : host;
const server = serve({ fetch: app.fetch, hostname: host, port }, () => {
  const enabled = config.sources.list.filter((source) => source.enabled).length;
  console.log(`Agorack のサーバーを http://${shownHost}:${port} で開きました`);
  console.log(`受け付ける画面の住所：${config.server.allowedOrigins.join("、")}`);
  console.log(`部品の設定：${config.sources.path}（つなぐ部品 ${enabled} 件）`);
  if (config.anthropic.apiKey === null) {
    console.warn("ANTHROPIC_API_KEY がまだないため、Claude を使う会話は失敗します。");
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `${shownHost}:${port} はほかのプログラムが使っています。止めるか、apps/server/.env の SERVER_PORT で番号を替えてください。`,
    );
  } else {
    console.error("待ち受けを始められません。", error);
  }
  process.exit(1);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
