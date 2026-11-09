import type { Evidence } from "@agorack/contracts";
import type { ComponentType } from "react";
import { FallbackEvidence } from "./fallback/FallbackEvidence";

/**
 * 根拠の kind ごとの表示を選ぶ（設計 §7.3）。
 * 書類（document）のページ画像・部品の埋め込み用の画面は、あとでここに足す。
 */
export type EvidenceRenderer = ComponentType<{ evidence: Evidence }>;

const renderers: Record<string, EvidenceRenderer> = {};

export function rendererFor(evidence: Evidence): EvidenceRenderer {
  return renderers[evidence.kind] ?? FallbackEvidence;
}
