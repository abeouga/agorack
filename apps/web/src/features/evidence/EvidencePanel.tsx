import type { Evidence } from "@agorack/contracts";
import { useEffect, useRef } from "react";
import { FiFileText } from "react-icons/fi";
import { Spinner } from "../../shared/Spinner";
import { rendererFor } from "./renderers";
import { evidenceKey } from "./selection";

/**
 * 右の欄：選んだターンの根拠の一覧。
 * 表の行のホバーで強調し、行を押すと選んだ根拠に印を付ける。中身の表示は kind ごとに renderers で選ぶ。
 */
export function EvidencePanel({
  question,
  evidence,
  pending,
  highlighted,
  selected,
  sourceName,
  onSelect,
}: {
  /** どの質問の根拠か。まだ質問がなければ null */
  question: string | null;
  evidence: Evidence[];
  /** 答えを待っている（根拠がこれから増える） */
  pending: boolean;
  highlighted: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  sourceName: (sourceId: string) => string;
  onSelect: (key: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  // 強調した根拠が見えるところまで動かす
  const focusKey = [...highlighted][0] ?? [...selected][0] ?? null;
  useEffect(() => {
    if (!focusKey) return;
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-evidence-key="${CSS.escape(focusKey)}"]`,
    );
    item?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusKey]);

  return (
    <aside className="evidence-panel" aria-label="根拠">
      <header className="evidence-head">
        <h2>
          <FiFileText aria-hidden="true" />
          根拠
          {evidence.length > 0 && <span className="evidence-count">{evidence.length}件</span>}
        </h2>
        {question && <p className="evidence-question">「{question}」の答えの根拠</p>}
      </header>
      {evidence.length === 0 ? (
        <p className="evidence-empty">
          {pending ? (
            <>
              <Spinner />
              部品から根拠を集めています…
            </>
          ) : question ? (
            "この答えには、部品から取り出した根拠がありません。"
          ) : (
            "質問すると、答えの根拠（どの部品の、どの書類・欄か）がここに出ます。"
          )}
        </p>
      ) : (
        <ol className="evidence-list" ref={listRef}>
          {evidence.map((item) => {
            const key = evidenceKey(item);
            const Renderer = rendererFor(item);
            const classes = [
              "evidence-item",
              highlighted.has(key) ? "is-highlighted" : "",
              selected.has(key) ? "is-selected" : "",
            ].join(" ");
            return (
              <li key={key} data-evidence-key={key}>
                <button
                  type="button"
                  className={classes.trim()}
                  aria-pressed={selected.has(key)}
                  onClick={() => onSelect(key)}
                >
                  <span className="evidence-source">
                    {sourceName(item.sourceId)}
                    <small>{item.recordId}</small>
                  </span>
                  <Renderer evidence={item} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
