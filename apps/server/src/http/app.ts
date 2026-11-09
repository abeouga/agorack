import {
  apiErrorStatus,
  apiPaths,
  type ApiErrorResponse,
  type HealthResponse,
  type SourceInfo,
  type SourcesResponse,
} from "@agorack/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { ConversationService } from "../conversations/index.js";
import { addConversationRoutes } from "./conversations.js";
import { originGuard } from "./originGuard.js";

/**
 * HTTP の道筋（設計 §8.1）。入出力の形を整えるだけで、判断はしない。
 * 使う部分（会話・部品）は、組み立て（main.ts）から引数で受け取る。
 */
export type HttpAppDeps = {
  /** 要求を受け付ける画面の住所（origin） */
  allowedOrigins: readonly string[];
  /** 部品の一覧と接続の状態（GET /api/sources） */
  listSources: () => SourceInfo[];
  /** 会話の窓口 */
  conversations: ConversationService;
  /** 想定外の失敗を記録する */
  logError?: (error: unknown) => void;
};

export function createHttpApp({
  allowedOrigins,
  listSources,
  conversations,
  logError = console.error,
}: HttpAppDeps): Hono {
  const app = new Hono();

  app.use("*", originGuard(allowedOrigins));
  app.use(
    "/api/*",
    cors({
      origin: [...allowedOrigins],
      allowMethods: ["GET", "POST", "DELETE"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );

  app.get(apiPaths.health(), (c) => c.json({ status: "ok" } satisfies HealthResponse));
  app.get(apiPaths.sources(), (c) => c.json({ sources: listSources() } satisfies SourcesResponse));
  addConversationRoutes(app, conversations);

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    logError(error);
    const body: ApiErrorResponse = {
      error: { code: "INTERNAL_ERROR", message: "サーバーの中で想定外の失敗が起きました" },
    };
    return c.json(body, apiErrorStatus.INTERNAL_ERROR);
  });

  return app;
}
