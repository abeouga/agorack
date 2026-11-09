import { z } from "zod";
import { EvidenceSchema, SourceIdSchema } from "./evidence.js";

/**
 * 1ターンの SSE のイベント（設計 §8.2）。
 * `type` で見分ける。SSE の `event:` の名前にも `type` をそのまま使い、`data:` に JSON を入れる。
 */

const TurnStartedSchema = z.object({
  type: z.literal("turn.started"),
  turnId: z.string().min(1),
});

const TextDeltaSchema = z.object({
  type: z.literal("text.delta"),
  /** 答えの文章の断片。つなげると答えになる */
  text: z.string(),
});

const ToolCalledSchema = z.object({
  type: z.literal("tool.called"),
  /** 道具の呼び出しの ID。`tool.completed` と対にする */
  callId: z.string().min(1),
  /** どの部品の道具か */
  sourceId: SourceIdSchema,
  /** 部品の道具の名前（接頭辞なし。例：get_document） */
  tool: z.string().min(1),
  /** 道具に渡した入力 */
  input: z.record(z.string(), z.unknown()),
});

const ToolCompletedSchema = z.object({
  type: z.literal("tool.completed"),
  callId: z.string().min(1),
  /** 道具が成功したか。失敗も落とさず、Claude に返したうえでここに出す */
  ok: z.boolean(),
  /** この呼び出しで取り出した根拠 */
  evidence: z.array(EvidenceSchema),
  /** 画面の進み具合に出す短い要約（例：書類を3件見つけました） */
  summary: z.string(),
});

/**
 * ターンが答えを出して終わった理由。
 * - `end_turn`：答え終わった
 * - `tool_limit`：道具の呼び出しの回数の上限で止めた（設計 §5）
 * - `max_tokens`：答えの長さの上限で切れた
 * - `refusal`：モデルが応答を断った（切り替え先のモデルでも断られた）
 */
export const TurnEndReasonSchema = z.enum(["end_turn", "tool_limit", "max_tokens", "refusal"]);
export type TurnEndReason = z.infer<typeof TurnEndReasonSchema>;

const TurnCompletedSchema = z.object({
  type: z.literal("turn.completed"),
  /** 最後の答えの全文（Markdown） */
  text: z.string(),
  /** このターンの根拠の全部（同じ根拠は1つにまとめたもの） */
  evidence: z.array(EvidenceSchema),
  reason: TurnEndReasonSchema,
});

/**
 * ターンが答えを出さずに終わった理由。
 * - `stopped`：利用者が止めた・画面との接続が切れた
 * - `model_error`：Claude の呼び出しに失敗した
 * - `internal_error`：Agorack の中の想定外の失敗
 */
export const TurnFailureCodeSchema = z.enum(["stopped", "model_error", "internal_error"]);
export type TurnFailureCode = z.infer<typeof TurnFailureCodeSchema>;

const TurnFailedSchema = z.object({
  type: z.literal("turn.failed"),
  code: TurnFailureCodeSchema,
  /** 利用者に見せる文章 */
  message: z.string(),
});

export const TurnEventSchema = z.discriminatedUnion("type", [
  TurnStartedSchema,
  TextDeltaSchema,
  ToolCalledSchema,
  ToolCompletedSchema,
  TurnCompletedSchema,
  TurnFailedSchema,
]);
export type TurnEvent = z.infer<typeof TurnEventSchema>;
export type TurnEventType = TurnEvent["type"];

/** `type` を指定して、その種類のイベントの型を取り出す（例：TurnEventOf<"tool.called">） */
export type TurnEventOf<T extends TurnEventType> = Extract<TurnEvent, { type: T }>;
