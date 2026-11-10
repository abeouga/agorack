import type { Evidence } from "@agorack/contracts";
import type { ReactNode } from "react";
import { FiFileText, FiX } from "react-icons/fi";
import "./pane.css";

/**
 * 右の欄の上の行と案内の文（文之助のチャットの書類の欄の ask-panel-head・ask-panel-lead と同じ形）。
 * 中身を出せるまで（部品の画面を開いている間など）と、ラベルと値だけを出すときに使う。
 */

/** 右の欄の上の行に出す名前：書類の名前、なければ様式の名前、なければ部品の名前 */
export function paneTitle(evidence: Evidence, sourceName: string): string {
  const { document_name, template_name } = evidence.location;
  if (typeof document_name === "string" && document_name.length > 0) return document_name;
  if (typeof template_name === "string" && template_name.length > 0) return template_name;
  return sourceName;
}

/** 右の欄を閉じる ×。道具の行の右の端に置く */
export function PaneClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="icon-button pane-close"
      aria-label="根拠を閉じる"
      title="閉じる"
      onClick={onClose}
    >
      <FiX aria-hidden="true" />
    </button>
  );
}

/** 上の行：左に名前、右に × */
export function PaneHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="pane-head">
      <h2 className="pane-title" title={title}>
        <FiFileText aria-hidden="true" />
        <span>{title}</span>
      </h2>
      <PaneClose onClose={onClose} />
    </div>
  );
}

/** 上の行の下の案内の文（読み込み中・読めなかったなど） */
export function PaneLead({ children }: { children: ReactNode }) {
  return (
    <p className="pane-lead" role="status">
      {children}
    </p>
  );
}
