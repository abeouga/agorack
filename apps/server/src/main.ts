// サーバーの入口：設定を読み、各部分を組み立てて HTTP を開く（設計 §4.1）。組み立てはここだけで行う。
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { ConfigError, loadConfig, type AppConfig } from "./config/index.js";
import { InMemoryConversations } from "./conversations/index.js";
import { createHttpApp } from "./http/app.js";
import { SourceCatalog, createMcpConnector } from "./sources/index.js";
import { createAnthropicModelClient } from "./model/anthropic/index.js";

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

// 部品へつなぐ。つなげない部品は失敗として残し、残りで動く（設計 §6.3）
const sources = new SourceCatalog(config.sources.list, createMcpConnector());
await sources.start();

const conversations = new InMemoryConversations({
  ports: { model: createAnthropicModelClient(config.anthropic), catalog: sources },
  options: { maxToolCalls: config.agent.maxToolCalls },
});

const app = createHttpApp({
  allowedOrigins: config.server.allowedOrigins,
  listSources: () => sources.status(),
  conversations,
});

const { host, port } = config.server;
const shownHost = host.includes(":") ? `[${host}]` : host;
const server = serve({ fetch: app.fetch, hostname: host, port }, () => {
  const enabled = config.sources.list.filter((source) => source.enabled).length;
  const connected = sources.status().filter((source) => source.status === "connected").length;
  console.log(`Agorack のサーバーを http://${shownHost}:${port} で開きました`);
  console.log(`受け付ける画面の住所：${config.server.allowedOrigins.join("、")}`);
  console.log(
    `部品の設定：${config.sources.path}（つなぐ部品 ${enabled} 件、つながった部品 ${connected} 件）`,
  );
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
  void exitAfterClosingSources(1);
});

/** 部品の接続を閉じて（手元で起動した部品の子のプロセスを止めて）から終える */
async function exitAfterClosingSources(code: number): Promise<never> {
  await sources.close();
  process.exit(code);
}

function shutdown() {
  server.close();
  void exitAfterClosingSources(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
