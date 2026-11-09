import type { Evidence } from "@agorack/contracts";
import { valueText } from "../../selection";

/** 知らない kind の根拠：ラベルと値だけを出す（設計 §7.3） */
export function FallbackEvidence({ evidence }: { evidence: Evidence }) {
  const value = valueText(evidence.value);
  return (
    <div className="evidence-fallback">
      <span className="evidence-label">{evidence.label}</span>
      <span className={value === null ? "evidence-value is-empty" : "evidence-value"}>
        {value ?? "（空欄）"}
      </span>
    </div>
  );
}
