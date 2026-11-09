import {
  apiErrorStatus,
  apiPaths,
  type ApiErrorResponse,
  type HealthResponse,
} from "@agorack/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { originGuard } from "./originGuard.js";

/**
 * HTTP の道筋（設計 §8.1）。入出力の形を整えるだけで、判断はしない。
 * 使う部分（会話・部品）は、組み立て（main.ts）から引数で受け取る。
 */
export type HttpAppDeps = {
  /** 要求を受け付ける画面の住所（origin） */
  allowedOrigins: readonly string[];
  /** 想定外の失敗を記録する */
  logError?: (error: unknown) => void;
};

export function createHttpApp({ allowedOrigins, logError = console.error }: HttpAppDeps): Hono {
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
