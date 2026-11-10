import {
  type AgorackToEmbedMessage,
  AgorackToEmbedMessageSchema,
  type Evidence,
  EmbedUrlSchema,
  HIGHLIGHT_FIELD_IDS_MAX,
  HIGHLIGHT_FIELD_ID_MAX_LENGTH,
} from "@agorack/contracts";
import { evidenceKey } from "../../selection";

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

/** 契約に合う場所の ID か（1〜HIGHLIGHT_FIELD_ID_MAX_LENGTH 文字の文字列） */
function fieldIdOf(evidence: Evidence): string | null {
  const fieldId = evidence.location.field_id;
  return typeof fieldId === "string" &&
    fieldId.length > 0 &&
    fieldId.length <= HIGHLIGHT_FIELD_ID_MAX_LENGTH
    ? fieldId
    : null;
}

/**
 * 埋め込み用の画面に送る agorack:highlight（設計 §7.4、決定 0005）。
 * - fieldId：選んだ場所（target.fieldId）
 * - fieldIds：この答えの根拠（siblings）のうち、同じ記録の場所の ID の全部。重なりは除き、選んだ場所を必ず含める。
 *   上限（HIGHLIGHT_FIELD_IDS_MAX）を超えるときは、選んだ場所と、答えの順に前から残す
 * 選んだ場所がない・契約の形に合わないときは null（送らない）。送る前に契約の zod で確かめる。
 */
export function highlightMessage(
  target: EmbedTarget,
  siblings: readonly Evidence[],
): AgorackToEmbedMessage | null {
  const fieldId = target.fieldId;
  if (!fieldId) return null;
  const others = new Set<string>();
  for (const item of siblings) {
    if (recordKeyOf(item) !== target.recordKey) continue;
    const id = fieldIdOf(item);
    if (id && id !== fieldId) others.add(id);
  }
  const fieldIds = [fieldId, ...[...others].slice(0, HIGHLIGHT_FIELD_IDS_MAX - 1)];
  const parsed = AgorackToEmbedMessageSchema.safeParse({
    type: "agorack:highlight",
    fieldId,
    fieldIds,
  });
  return parsed.success ? parsed.data : null;
}

export function recordKeyOf(evidence: Evidence): string {
  return `${evidence.sourceId}\u0000${evidence.recordId}`;
}

/**
 * 埋め込みに失敗したことを覚えておく単位。
 * - FIELD_NOT_FOUND（書類は出ているが、その欄がない）：その欄の根拠だけ。同じ記録のほかの欄は埋め込みを続ける
 * - それ以外（DOCUMENT_NOT_FOUND・LOAD_FAILED・時間切れなど）：記録の全部。同じ記録では埋め込みを試し直さない
 */
export function embedFailureKey(code: string, evidence: Evidence): string {
  return code === "FIELD_NOT_FOUND"
    ? `field:${evidenceKey(evidence)}`
    : `record:${recordKeyOf(evidence)}`;
}

/** 根拠について覚えている失敗（欄の失敗を先に見る） */
export function embedFailureOf<T>(
  failures: ReadonlyMap<string, T>,
  evidence: Evidence,
): T | undefined {
  return (
    failures.get(embedFailureKey("FIELD_NOT_FOUND", evidence)) ??
    failures.get(embedFailureKey("", evidence))
  );
}
