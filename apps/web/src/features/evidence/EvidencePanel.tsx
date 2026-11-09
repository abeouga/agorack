import type { Evidence } from "@agorack/contracts";
import { useEffect, useRef } from "react";
import { FiFileText } from "react-icons/fi";
import { Spinner } from "../../shared/Spinner";
import { EvidenceView } from "./renderers";
import { evidenceKey, focusedEvidence, valueText } from "./selection";

/**
 * 右の欄：選んだ根拠の表示（部品の埋め込み用の画面 → kind ごと → ラベルと値 の順に renderers で選ぶ）と、根拠の一覧。
 * 表の行・一覧のホバーで強調し、押すと選ぶ。出す根拠は ホバー → 選んだもの → 最初のもの の順に決める。
 */
export function EvidencePanel({
  question,
  answer,
  evidence,
  pending,
  hovered,
  selected,
  sourceName,
  embedOriginOf,
  onHover,
  onSelect,
}: {
  /** どの質問の根拠か。まだ質問がなければ null */
  question: string | null;
  /** 答えの文章（最初に出す根拠を選ぶのに使う） */
  answer: string;
  evidence: Evidence[];
  /** 答えを待っている（根拠がこれから増える） */
  pending: boolean;
  hovered: readonly string[];
  selected: readonly string[];
  sourceName: (sourceId: string) => string;
  /** 部品の埋め込み用の画面を許す住所 */
  embedOriginOf: (sourceId: string) => string | null;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}) {
  const focus = focusedEvidence(evidence, hovered, selected, answer);
  const focusKey = focus ? evidenceKey(focus) : null;
  const highlighted = new Set(hovered);
  const chosen = new Set(selected);

  // 出している根拠を一覧の見えるところまで動かす。
  // scrollIntoView は外側（ページ画像の枠など）も動かし、ほかの滑らかなスクロールを止めるので、一覧だけを動かす
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const item =
      focusKey && list?.querySelector<HTMLElement>(`[data-evidence-key="${CSS.escape(focusKey)}"]`);
    if (!list || !item) return;
    const outer = list.getBoundingClientRect();
    const inner = item.getBoundingClientRect();
    const margin = 8;
    const shift =
      inner.top < outer.top
        ? inner.top - outer.top - margin
        : inner.bottom > outer.bottom
          ? inner.bottom - outer.bottom + margin
          : 0;
    if (shift !== 0) list.scrollTo({ top: list.scrollTop + shift, behavior: "smooth" });
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
      {focus ? (
        <>
          <section className="evidence-view" aria-label="選んだ根拠">
            {/* kind が替わったら表示を作り直す（表示ごとの状態を持ち越さない） */}
            <EvidenceView
              key={focus.kind}
              evidence={focus}
              siblings={evidence}
              highlighted={highlighted}
              sourceName={sourceName(focus.sourceId)}
              embedOrigin={embedOriginOf(focus.sourceId)}
              onPick={onSelect}
            />
          </section>
          <ol className="evidence-list" ref={listRef} onMouseLeave={() => onHover(null)}>
            {evidence.map((item) => {
              const key = evidenceKey(item);
              const value = valueText(item.value);
              const classes = [
                "evidence-item",
                key === focusKey ? "is-focus" : "",
                highlighted.has(key) ? "is-highlighted" : "",
                chosen.has(key) ? "is-selected" : "",
              ];
              return (
                <li key={key} data-evidence-key={key}>
                  <button
                    type="button"
                    className={classes.join(" ").replace(/\s+/g, " ").trim()}
                    aria-pressed={chosen.has(key)}
                    onMouseEnter={() => onHover(key)}
                    onFocus={() => onHover(key)}
                    onBlur={() => onHover(null)}
                    onClick={() => onSelect(key)}
                  >
                    <span className="evidence-item-label">{item.label}</span>
                    <span
                      className={
                        value === null ? "evidence-item-value is-empty" : "evidence-item-value"
                      }
                    >
                      {value ?? "空欄"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
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
      )}
    </aside>
  );
}
