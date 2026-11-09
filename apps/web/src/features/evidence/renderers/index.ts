import type { Evidence } from "@agorack/contracts";
import { createElement } from "react";
import { DocumentEvidence } from "./document/DocumentEvidence";
import { FallbackEvidence } from "./fallback/FallbackEvidence";
import type { EvidenceRenderer, EvidenceViewProps } from "./types";

/**
 * 根拠の kind ごとの表示を選ぶ（設計 §7.3）。
 * 表示を足すときは、renderers/<名前>/ に EvidenceRenderer を作り、ここに登録する。
 * 部品の埋め込み用の画面（embed、#14）は、embedUrl を見てこの表より先に選ぶ形で足す。
 */
const renderers: Readonly<Record<string, EvidenceRenderer>> = {
  document: DocumentEvidence,
};

export function rendererFor(evidence: Evidence): EvidenceRenderer {
  return Object.hasOwn(renderers, evidence.kind)
    ? (renderers[evidence.kind] ?? FallbackEvidence)
    : FallbackEvidence;
}

/** 根拠の kind に合う表示を出す */
export function EvidenceView(props: EvidenceViewProps) {
  return createElement(rendererFor(props.evidence), props);
}

export type { EvidenceRenderer, EvidenceViewProps } from "./types";
