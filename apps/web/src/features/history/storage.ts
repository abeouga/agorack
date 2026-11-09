import { EvidenceSchema, TurnEndReasonSchema, TurnFailureCodeSchema } from "@agorack/contracts";
import { z } from "zod";
import type { Conversation, Turn } from "../chat/state/conversation";
import { type HistoryState, MAX_CONVERSATIONS, initialHistory } from "./historyReducer";

/**
 * 会話の履歴をブラウザー（localStorage）に保存し、読み込む。
 * 読み込んだものは形を確かめ、合わなければ捨てて空から始める。
 */

const STORAGE_KEY = "agorack.history";
const VERSION = 1;

/** 読み込み直したときに、受け取りの途中だったターンに付ける文章 */
export const RELOADED_MESSAGE = "画面を読み込み直したため、回答の受け取りが止まりました。";

const ToolCallSchema = z.object({
  callId: z.string(),
  sourceId: z.string(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  summary: z.string().nullable(),
  evidence: z.array(EvidenceSchema),
});

const TurnSchema = z.object({
  id: z.string(),
  question: z.string(),
  askedAt: z.number(),
  serverTurnId: z.string().nullable(),
  text: z.string(),
  tools: z.array(ToolCallSchema),
  evidence: z.array(EvidenceSchema),
  status: z.enum(["pending", "completed", "failed"]),
  endReason: TurnEndReasonSchema.nullable(),
  failure: z
    .object({
      code: z.union([TurnFailureCodeSchema, z.literal("client_error")]),
      message: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<Turn>;

const ConversationSchema = z.object({
  id: z.string(),
  serverId: z.string().nullable(),
  title: z.string(),
  updatedAt: z.number(),
  turns: z.array(TurnSchema),
}) satisfies z.ZodType<Conversation>;

const StoredHistorySchema = z.object({
  version: z.literal(VERSION),
  currentId: z.string(),
  conversations: z.array(ConversationSchema),
});

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** 保存した履歴を読む。なければ（読めなければ）新しい会話を1つ開いた状態にする */
export function loadHistory(storage: Storage | null, newId: string, at: number): HistoryState {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    // 保存領域が使えない（プライベートウィンドウなど）
  }
  if (!raw) return initialHistory(newId, at);
  let parsed;
  try {
    parsed = StoredHistorySchema.safeParse(JSON.parse(raw));
  } catch {
    return initialHistory(newId, at);
  }
  if (!parsed.success) return initialHistory(newId, at);

  const conversations = parsed.data.conversations
    .filter((item) => item.turns.length > 0)
    .map(settlePending);
  if (conversations.some((item) => item.id === parsed.data.currentId)) {
    return { conversations, currentId: parsed.data.currentId };
  }
  // 開いていた会話が空だった（保存していない）ときは、新しい会話を開く
  const fresh = initialHistory(newId, at);
  return { ...fresh, conversations: [...fresh.conversations, ...conversations] };
}

export function saveHistory(storage: Storage | null, state: HistoryState): void {
  const stored: z.infer<typeof StoredHistorySchema> = {
    version: VERSION,
    currentId: state.currentId,
    // 質問のない会話は残さない
    conversations: state.conversations
      .filter((item) => item.turns.length > 0)
      .slice(0, MAX_CONVERSATIONS),
  };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // 保存できなくても会話は続けられる
  }
}

/** 受け取りの途中で閉じたターンは、止まったものとして読み込む */
function settlePending(conversation: Conversation): Conversation {
  if (!conversation.turns.some((turn) => turn.status === "pending")) return conversation;
  return {
    ...conversation,
    turns: conversation.turns.map((turn) =>
      turn.status === "pending"
        ? {
            ...turn,
            status: "failed",
            failure: { code: "stopped", message: RELOADED_MESSAGE },
            tools: turn.tools.map((call) =>
              call.status === "running" ? { ...call, status: "cancelled" } : call,
            ),
          }
        : turn,
    ),
  };
}
