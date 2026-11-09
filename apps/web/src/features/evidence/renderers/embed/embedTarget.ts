import { type Evidence, EmbedUrlSchema } from "@agorack/contracts";

/**
 * 根拠を部品の埋め込み用の画面で見せられるか（設計 §7.4、決定 0004）。
 * 根拠の embedUrl の住所（origin）が、その部品に許した住所（GET /api/sources の embedOrigin）と同じときだけ使う。
 */
export type EmbedTarget = {
  /** iframe に読ませる住所 */
  url: string;
  /** 相手の住所。postMessage の送り先と、受け取るメッセージの確かめに使う */
  origin: string;
  /**
   * どの記録の画面か（部品の id と記録の ID）。同じ記録の中で欄だけ替わるときは、iframe を読み直さない
   */
  recordKey: string;
  /** 強調する場所の ID（location.field_id）。ないときは null */
  fieldId: string | null;
};

export function embedTarget(evidence: Evidence, embedOrigin: string | null): EmbedTarget | null {
  if (!evidence.embedUrl || !embedOrigin) return null;
  const parsed = EmbedUrlSchema.safeParse(evidence.embedUrl);
  if (!parsed.success) return null;
  let origin: string;
  try {
    origin = new URL(parsed.data).origin;
  } catch {
    return null;
  }
  if (origin !== embedOrigin) return null;
  const fieldId = evidence.location.field_id;
  return {
    url: parsed.data,
    origin,
    recordKey: recordKeyOf(evidence),
    fieldId: typeof fieldId === "string" && fieldId.length > 0 ? fieldId : null,
  };
}

export function recordKeyOf(evidence: Evidence): string {
  return `${evidence.sourceId}\u0000${evidence.recordId}`;
}
