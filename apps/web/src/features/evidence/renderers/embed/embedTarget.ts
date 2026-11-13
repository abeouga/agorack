import {
  type AgorackToEmbedMessage,
  AgorackToEmbedMessageSchema,
  type Evidence,
  EmbedUrlSchema,
  HIGHLIGHT_TARGET_IDS_MAX,
  HIGHLIGHT_TARGET_ID_MAX_LENGTH,
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
  /** 強調する場所の ID（rawTargetIdOf を参照）。ないときは null */
  targetId: string | null;
};

/**
 * 根拠から、埋め込み用の画面で強調する場所の ID を取り出す（長さはまだ確かめない）。
 * いまは書類の根拠の location.field_id だけを見る。根拠の外枠に部品に依らない ID の欄ができたら、ここだけを替える。
 */
function rawTargetIdOf(evidence: Evidence): unknown {
  return evidence.location.field_id;
}

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
  const targetId = rawTargetIdOf(evidence);
  return {
    url: parsed.data,
    origin,
    recordKey: recordKeyOf(evidence),
    targetId: typeof targetId === "string" && targetId.length > 0 ? targetId : null,
  };
}

/** 契約に合う場所の ID か（1〜HIGHLIGHT_TARGET_ID_MAX_LENGTH 文字の文字列） */
function targetIdOf(evidence: Evidence): string | null {
  const targetId = rawTargetIdOf(evidence);
  return typeof targetId === "string" &&
    targetId.length > 0 &&
    targetId.length <= HIGHLIGHT_TARGET_ID_MAX_LENGTH
    ? targetId
    : null;
}

/**
 * 埋め込み用の画面に送る agorack:highlight（設計 §7.4、決定 0005。0006 は検討中）。
 * - targetId：選んだ場所（target.targetId）
 * - targetIds：この答えの根拠（siblings）のうち、同じ記録の場所の ID の全部。重なりは除き、選んだ場所を必ず含める。
 *   上限（HIGHLIGHT_TARGET_IDS_MAX）を超えるときは、選んだ場所と、答えの順に前から残す
 * - fieldId・fieldIds：移行用の古い名前。targetId・targetIds と同じ値を入れる（0006、検討中）
 * 選んだ場所がない・契約の形に合わないときは null（送らない）。送る前に契約の zod で確かめる。
 */
export function highlightMessage(
  target: EmbedTarget,
  siblings: readonly Evidence[],
): AgorackToEmbedMessage | null {
  const targetId = target.targetId;
  if (!targetId) return null;
  const others = new Set<string>();
  for (const item of siblings) {
    if (recordKeyOf(item) !== target.recordKey) continue;
    const id = targetIdOf(item);
    if (id && id !== targetId) others.add(id);
  }
  const targetIds = [targetId, ...[...others].slice(0, HIGHLIGHT_TARGET_IDS_MAX - 1)];
  const parsed = AgorackToEmbedMessageSchema.safeParse({
    type: "agorack:highlight",
    targetId,
    targetIds,
    fieldId: targetId,
    fieldIds: targetIds,
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
