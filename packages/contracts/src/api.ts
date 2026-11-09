import { z } from "zod";
import { SourceIdSchema } from "./evidence.js";

/**
 * 画面とサーバーの HTTP の契約（設計 §8.1）。
 * 要求と応答の形、エラーの形、パスをここだけで決める。
 */

/** HTTP のパス。画面とサーバーで同じものを使う */
export const apiPaths = {
  health: () => "/api/health",
  sources: () => "/api/sources",
  conversations: () => "/api/conversations",
  conversation: (conversationId: string) =>
    `/api/conversations/${encodeURIComponent(conversationId)}`,
  turns: (conversationId: string) =>
    `/api/conversations/${encodeURIComponent(conversationId)}/turns`,
  stopTurn: (conversationId: string) =>
    `/api/conversations/${encodeURIComponent(conversationId)}/turns/current/stop`,
} as const;

// ---- GET /api/health ----

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---- GET /api/sources ----

/**
 * 部品の接続の状態（設計 §6.3）。
 * - `connected`：つながっていて、道具の一覧を取れた
 * - `failed`：つなげなかった（`error` に理由）
 * - `disabled`：設定で止めている（`enabled: false`）
 */
export const SourceStatusSchema = z.enum(["connected", "failed", "disabled"]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceInfoSchema = z.object({
  id: SourceIdSchema,
  name: z.string().min(1),
  description: z.string(),
  status: SourceStatusSchema,
  /** つなげなかった理由。`failed` のときだけ入る */
  error: z.string().nullable(),
  /** 使える道具の数。つながっていないときは 0 */
  toolCount: z.number().int().nonnegative(),
});
export type SourceInfo = z.infer<typeof SourceInfoSchema>;

export const SourcesResponseSchema = z.object({
  sources: z.array(SourceInfoSchema),
});
export type SourcesResponse = z.infer<typeof SourcesResponseSchema>;

// ---- POST /api/conversations ----

export const CreateConversationResponseSchema = z.object({
  conversationId: z.string().min(1),
});
export type CreateConversationResponse = z.infer<typeof CreateConversationResponseSchema>;

// ---- POST /api/conversations/:id/turns ----
// 応答は text/event-stream。イベントは events.ts の TurnEvent。

/** 1回の質問の長さの上限（文字数） */
export const MAX_QUESTION_LENGTH = 4000;

export const StartTurnRequestSchema = z.object({
  text: z.string().trim().min(1, "質問が空です").max(MAX_QUESTION_LENGTH, "質問が長すぎます"),
});
export type StartTurnRequest = z.infer<typeof StartTurnRequestSchema>;

// ---- POST /api/conversations/:id/turns/current/stop ----
// ---- DELETE /api/conversations/:id ----
// どちらも成功は 204（本文なし）。

// ---- エラー ----

/**
 * エラーのコード（設計 §8.1、Issue #8 のエラーの表）。
 * - `INVALID_REQUEST`（400）：要求の形が違う
 * - `CONVERSATION_NOT_FOUND`（404）：会話がない
 * - `TURN_IN_PROGRESS`（409）：同じ会話でターンが進行中
 * - `INTERNAL_ERROR`（500）：想定外の失敗
 */
export const ApiErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "CONVERSATION_NOT_FOUND",
  "TURN_IN_PROGRESS",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** エラーのコードと HTTP の状態の対応 */
export const apiErrorStatus = {
  INVALID_REQUEST: 400,
  CONVERSATION_NOT_FOUND: 404,
  TURN_IN_PROGRESS: 409,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ApiErrorCode, number>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    /** 利用者に見せる文章 */
    message: z.string(),
    /** どの項目が悪いか（`INVALID_REQUEST` のとき） */
    issues: z
      .array(
        z.object({
          path: z.string(),
          message: z.string(),
        }),
      )
      .optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
