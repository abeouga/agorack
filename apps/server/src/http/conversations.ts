import {
  apiErrorStatus,
  StartTurnRequestSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
  type CreateConversationResponse,
} from "@agorack/contracts";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { z } from "zod";
import type { ConversationService } from "../conversations/index.js";

/**
 * 会話の API（設計 §8.1）。要求の形を確かめ、会話の窓口を呼び、応答の形に整えるだけで、判断はしない。
 * パスは契約の apiPaths と同じ形（:id の部分を Hono の書き方にしたもの）。
 */
const paths = {
  conversations: "/api/conversations",
  conversation: "/api/conversations/:id",
  turns: "/api/conversations/:id/turns",
  stopTurn: "/api/conversations/:id/turns/current/stop",
} as const;

const MESSAGES = {
  INVALID_REQUEST: "要求の形が違います。",
  CONVERSATION_NOT_FOUND: "会話が見つかりません。新しい会話を始めてください。",
  TURN_IN_PROGRESS:
    "この会話では、前の質問への答えをまだ作っています。止めるか、終わるのを待ってください。",
} as const satisfies Partial<Record<ApiErrorCode, string>>;

function apiError(
  c: Context,
  code: keyof typeof MESSAGES,
  issues?: ApiErrorResponse["error"]["issues"],
) {
  const body: ApiErrorResponse = {
    error: { code, message: MESSAGES[code], ...(issues ? { issues } : {}) },
  };
  return c.json(body, apiErrorStatus[code]);
}

function issuesOf(error: z.ZodError): NonNullable<ApiErrorResponse["error"]["issues"]> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function addConversationRoutes(app: Hono, conversations: ConversationService): void {
  app.post(paths.conversations, (c) => {
    const body: CreateConversationResponse = { conversationId: conversations.create() };
    return c.json(body, 201);
  });

  app.delete(paths.conversation, (c) => {
    if (!conversations.delete(c.req.param("id"))) return apiError(c, "CONVERSATION_NOT_FOUND");
    return c.body(null, 204);
  });

  app.post(paths.stopTurn, (c) => {
    if (!conversations.stopTurn(c.req.param("id"))) return apiError(c, "CONVERSATION_NOT_FOUND");
    return c.body(null, 204);
  });

  app.post(paths.turns, async (c) => {
    let json: unknown;
    try {
      json = JSON.parse(await c.req.text());
    } catch {
      return apiError(c, "INVALID_REQUEST", [{ path: "", message: "本文が JSON ではありません" }]);
    }
    const parsed = StartTurnRequestSchema.safeParse(json);
    if (!parsed.success) return apiError(c, "INVALID_REQUEST", issuesOf(parsed.error));

    // 画面との接続が切れたら、ターンを止める
    const started = conversations.startTurn(c.req.param("id"), parsed.data.text, c.req.raw.signal);
    if (!started.ok) {
      return apiError(
        c,
        started.error === "not_found" ? "CONVERSATION_NOT_FOUND" : "TURN_IN_PROGRESS",
      );
    }

    // SSE の event: は TurnEvent の type、data: は JSON（契約 events.ts）
    return streamSSE(c, async (stream) => {
      for await (const event of started.events) {
        if (stream.aborted) break;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
    });
  });
}
