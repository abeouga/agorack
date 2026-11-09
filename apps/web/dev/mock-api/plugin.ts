import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type MockApi = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type HandlerModule = { createMockApi: () => MockApi };

/**
 * 決まったイベントを流す偽のサーバー（`npm run dev:mock -w @agorack/web` のときだけ有効）。
 * /api への要求を、本物のサーバーの代わりに handler.ts で答える。
 *
 * handler.ts は packages/contracts を使うので、Vite の設定と一緒に Node で直に読まず、
 * 最初の要求のときに Vite の読み込み（ssrLoadModule）で TypeScript のまま読む。
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
    },
  };
}
