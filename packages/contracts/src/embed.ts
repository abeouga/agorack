import { z } from "zod";

/**
 * 部品の画面の埋め込み（設計 §7.4、決定 0004）。
 * 住所の形と、Agorack の画面と部品の埋め込み用の画面のあいだの postMessage の形を決める。
 */

/** 埋め込み用の画面の住所。http か https の絶対URL */
export const EmbedUrlSchema = z.url({
  protocol: /^https?$/,
  error: "埋め込み用の画面の住所は、http か https の絶対URLにしてください",
});

/** 埋め込みを許す住所（origin）。パスや末尾の / は付けない（例：http://127.0.0.1:5180） */
export const EmbedOriginSchema = z
  .url({ protocol: /^https?$/, error: "埋め込みを許す住所は、http か https の住所にしてください" })
  .regex(
    /^https?:\/\/[^/?#\s]+$/,
    "埋め込みを許す住所は origin（例：http://127.0.0.1:5180）だけにし、パスや末尾の / は付けないでください",
  );

// ---- postMessage ----

/** Agorack → 部品：強調する場所を替える。同じ記録の中なら、iframe を読み直さずにこれで伝える */
const HighlightMessageSchema = z.object({
  type: z.literal("agorack:highlight"),
  /** 強調する場所の ID（根拠の location にある、部品が決めた ID） */
  fieldId: z.string().min(1),
});

/** 部品 → Agorack：表示の準備ができた */
const EmbedReadyMessageSchema = z.object({
  type: z.literal("embed:ready"),
});

/** 部品 → Agorack：記録が見つからない・表示できない。Agorack は kind ごとの表示に戻す */
const EmbedErrorMessageSchema = z.object({
  type: z.literal("embed:error"),
  /** 失敗の種類（部品が決める。例：not_found） */
  code: z.string().min(1),
});

/** Agorack の画面から、部品の埋め込み用の画面へ送るメッセージ */
export const AgorackToEmbedMessageSchema = z.discriminatedUnion("type", [HighlightMessageSchema]);
export type AgorackToEmbedMessage = z.infer<typeof AgorackToEmbedMessageSchema>;

/** 部品の埋め込み用の画面から、Agorack の画面へ届くメッセージ */
export const EmbedToAgorackMessageSchema = z.discriminatedUnion("type", [
  EmbedReadyMessageSchema,
  EmbedErrorMessageSchema,
]);
export type EmbedToAgorackMessage = z.infer<typeof EmbedToAgorackMessageSchema>;
