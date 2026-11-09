import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { MOCK_EMBED_ORIGIN, MOCK_EMBED_PORT } from "./embed-origin.ts";

type MockApi = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type HandlerModule = { createMockApi: () => MockApi };
type EmbedModule = {
  renderEmbedPage: (url: string) => {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
};

/**
 * 決まったイベントを流す偽のサーバー（`npm run dev:mock -w @agorack/web` のときだけ有効）。
 * /api への要求を、本物のサーバーの代わりに handler.ts で答える。
 *
 * handler.ts は packages/contracts を使うので、Vite の設定と一緒に Node で直に読まず、
 * 最初の要求のときに Vite の読み込み（ssrLoadModule）で TypeScript のまま読む。
 *
 * あわせて、偽の埋め込み用の画面（embed-page.ts）を別の住所（MOCK_EMBED_ORIGIN）で配る。
 */
export function mockApi(): Plugin {
  return {
    name: "agorack-mock-api",
    configureServer(server) {
      let api: Promise<MockApi> | null = null;
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        api ??= server
          .ssrLoadModule("/dev/mock-api/handler.ts")
          .then((module) => (module as HandlerModule).createMockApi());
        api
          .then((handle) => handle(req, res))
          .catch((error: unknown) => {
            server.config.logger.error(`偽のサーバーの失敗：${String(error)}`);
            if (res.headersSent) {
              res.end();
              return;
            }
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(
              JSON.stringify({
                error: { code: "INTERNAL_ERROR", message: "偽のサーバーで失敗しました" },
              }),
            );
          });
      });
      server.config.logger.info("  偽のサーバー（/api）を使っています");
      startEmbedServer(server);
    },
  };
}

/** 偽の埋め込み用の画面を、画面と別の住所で配る（同じ住所だと、別の部品の画面を埋め込む形にならない） */
function startEmbedServer(server: ViteDevServer) {
  const embed = createServer((req, res) => {
    server
      .ssrLoadModule("/dev/mock-api/embed-page.ts")
      .then((module) => {
        const page = (module as EmbedModule).renderEmbedPage(req.url ?? "/");
        res.writeHead(page.status, page.headers);
        res.end(page.body);
      })
      .catch((error: unknown) => {
        server.config.logger.error(`偽の埋め込み用の画面の失敗：${String(error)}`);
        res.writeHead(500);
        res.end();
      });
  });
  embed.on("error", (error: NodeJS.ErrnoException) => {
    // 偽のサーバーを2つ（開発とスクショ）動かすと番号が重なる。先に開いた方が同じ画面を配る
    const reason = error.code === "EADDRINUSE" ? "番号が使われています" : String(error);
    server.config.logger.warn(`  偽の埋め込み用の画面を開けません（${reason}）`);
  });
  embed.listen(MOCK_EMBED_PORT, "127.0.0.1", () => {
    server.config.logger.info(`  偽の埋め込み用の画面：${MOCK_EMBED_ORIGIN}/embed`);
  });
  server.httpServer?.on("close", () => embed.close());
}
