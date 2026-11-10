import { FiInfo } from "react-icons/fi";
import { valueText } from "../../selection";
import { PaneHead, paneTitle } from "../pane/PaneHead";
import type { EvidenceViewProps } from "../types";
import "./fallback.css";

/**
 * 知らない kind の根拠：ラベルと値だけを出す（設計 §7.3）。
 * ほかの表示が出せないとき（書類の画像が読めないなど）も、notice を添えてこれに戻す。
 * 上の行（名前と ×）は、ほかの表示と同じく右の欄の上の端に置く。
 */
export function FallbackEvidence({
  evidence,
  sourceName,
  notice,
  onClose,
}: Pick<EvidenceViewProps, "evidence" | "sourceName" | "onClose"> & { notice?: string }) {
  const value = valueText(evidence.value);
  return (
    <div className="evidence-fallback-pane">
      <PaneHead title={paneTitle(evidence, sourceName)} onClose={onClose} />
      <div className="evidence-fallback">
        <span className="evidence-fallback-source">
          {sourceName}
          <small>{evidence.kind}</small>
        </span>
        <span className="evidence-fallback-label">{evidence.label}</span>
        <span
          className={
            value === null ? "evidence-fallback-value is-empty" : "evidence-fallback-value"
          }
        >
          {value ?? "（空欄）"}
        </span>
        {notice && (
          <p className="evidence-fallback-notice" role="status">
            <FiInfo aria-hidden="true" />
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
