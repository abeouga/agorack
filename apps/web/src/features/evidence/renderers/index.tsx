import type { Evidence } from "@agorack/contracts";
import { createElement, useState } from "react";
import { FiInfo } from "react-icons/fi";
import { DocumentEvidence } from "./document/DocumentEvidence";
import { type EmbedFailure, EmbedEvidence } from "./embed/EmbedEvidence";
import { embedFailureKey, embedFailureOf, embedTarget } from "./embed/embedTarget";
import { FallbackEvidence } from "./fallback/FallbackEvidence";
import type { EvidenceRenderer, EvidenceViewProps } from "./types";

/**
 * 根拠の表示を選ぶ（設計 §7.3）。順は「部品の埋め込み用の画面 → kind ごとの表示 → ラベルと値」。
 * kind ごとの表示を足すときは、renderers/<名前>/ に EvidenceRenderer を作り、ここに登録する。
 */
const renderers: Readonly<Record<string, EvidenceRenderer>> = {
  document: DocumentEvidence,
};

export function rendererFor(evidence: Evidence): EvidenceRenderer {
  return Object.hasOwn(renderers, evidence.kind)
    ? (renderers[evidence.kind] ?? FallbackEvidence)
    : FallbackEvidence;
}

const FAILURE_TEXT: Record<string, string> = {
  timeout: "応答がありません",
  DOCUMENT_NOT_FOUND: "記録が見つかりません",
  FIELD_NOT_FOUND: "欄が見つかりません",
  LOAD_FAILED: "読み込めません",
};

/**
 * 根拠を出す。埋め込めるときは部品の画面を、埋め込めない・失敗したときは kind ごとの表示を出す。
 * 埋め込みに失敗したことは覚えておき、試し直さない（覚える単位は embedFailureKey。
 * 欄がないときはその欄だけ、記録が開けないときは記録の全部）。
 */
export function EvidenceView(props: EvidenceViewProps) {
  const [failures, setFailures] = useState<ReadonlyMap<string, EmbedFailure>>(new Map());
  const target = embedTarget(props.evidence, props.embedOrigin);
  const failure = target ? embedFailureOf(failures, props.evidence) : undefined;
  if (target && !failure) {
    return (
      <EmbedEvidence
        key={target.recordKey}
        target={target}
        sourceName={props.sourceName}
        onFailed={(next) =>
          setFailures((current) =>
            new Map(current).set(embedFailureKey(next.code, props.evidence), next),
          )
        }
      />
    );
  }
  const kindView = createElement(rendererFor(props.evidence), props);
  if (!failure) return kindView;
  return (
    <>
      <p className="embed-fallback-notice" role="status">
        <FiInfo aria-hidden="true" />
        {props.sourceName}の画面を埋め込めませんでした（{FAILURE_TEXT[failure.code] ?? failure.code}
        ）。代わりの表示に切り替えています。
      </p>
      {kindView}
    </>
  );
}

export type { EvidenceRenderer, EvidenceViewProps } from "./types";
