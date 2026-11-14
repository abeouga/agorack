import { z } from "zod";
import { EmbedUrlSchema } from "./embed.js";

/**
 * 部品の id（設定の `id`）。道具の名前の接頭辞にも使うので、英数字と `_` だけ（設計 §6.1）。
 */
export const SourceIdSchema = z.string().regex(/^[A-Za-z0-9_]+$/, "部品の id は英数字と _ だけ");
export type SourceId = z.infer<typeof SourceIdSchema>;

/**
 * 答えの根拠の共通の形（設計 §7.1）。
 * 外枠だけをそろえ、`location` の中身は部品ごとに違ってよい。Agorack は `location` を解釈しない。
 */
export const EvidenceSchema = z.object({
  /** 根拠の種類（例：document、ride）。画面はこれで表示を選ぶ */
  kind: z.string().min(1),
  /** どの部品か（設定の id）。Agorack が、どの部品の道具を呼んだかから付ける */
  sourceId: SourceIdSchema,
  /** 部品の中の記録の ID（書類 ID・走行 ID など）。部品の MCP の `source_id` */
  recordId: z.string().min(1),
  /** 人が読める説明（例：繁殖台帳「個体A」の毛色） */
  label: z.string().min(1),
  /** 部品ごとの位置の情報 */
  location: z.record(z.string(), z.unknown()),
  /** 値。空欄は null */
  value: z.unknown(),
  /**
   * 部品の埋め込み用の画面の絶対URL（設計 §7.4）。埋め込めないときは null。
   * サーバーが、部品の設定（embed.origin）で許した住所のものだけを残す。
   */
  embedUrl: EmbedUrlSchema.nullable(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
