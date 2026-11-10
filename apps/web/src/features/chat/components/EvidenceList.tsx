import type { Evidence } from "@agorack/contracts";
import { useEffect, useRef } from "react";
import { groupByRecord, labelInRecord, recordKey } from "../../evidence/records";
import { evidenceKey, focusedEvidence, valueText } from "../../evidence/selection";

/** 右の欄とのつながり：どの根拠を出し、どれを強調し、どれを選んでいるか */
export type EvidenceListState = {
  /** 右の欄に出している根拠（ホバーを含む）。このターンを出していなければ null */
  focusKey: string | null;
  /** ホバーを除いて右の欄に出す根拠。どの記録の一覧を見せるかに使う */
  restingKey: string | null;
  hovered: ReadonlySet<string>;
  selected: ReadonlySet<string>;
};

/**
 * 答えの下の根拠の一覧（欄の名前と値）。押した根拠を右の欄に出し、ホバーで右の欄の欄を強調する。
 * 根拠が2つ以上の記録（書類など）にまたがるときは、上の切り替えで記録を選ぶ。一覧には、その記録の根拠だけを出す。
 */
export function EvidenceList({
  id,
  evidence,
  answer,
  state,
  onHover,
  onSelect,
}: {
  id: string;
  evidence: Evidence[];
  /** 答えの文章（記録を切り替えたとき、最初に出す根拠を選ぶのに使う） */
  answer: string;
  state: EvidenceListState;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
}) {
  const records = groupByRecord(evidence);
  const resting = evidence.find((item) => evidenceKey(item) === state.restingKey);
  const current =
    records.find((record) => resting && record.key === recordKey(resting)) ?? records[0];

  // 開いたら、一覧が見えるところまで会話の欄を動かす（下に隠れて開いたように見えないことを避ける）
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const messages = root?.closest<HTMLElement>(".chat-messages");
    if (!root || !messages) return;
    const shift = revealShift(messages.getBoundingClientRect(), root.getBoundingClientRect(), 12);
    if (shift > 0) messages.scrollTo({ top: messages.scrollTop + shift, behavior: "smooth" });
  }, []);

  // 出している根拠を一覧の見えるところまで動かす。
  // scrollIntoView は外側（会話の欄）も動かし、ほかの滑らかなスクロールを止めるので、一覧だけを動かす
  const listRef = useRef<HTMLOListElement>(null);
  const { focusKey } = state;
  useEffect(() => {
    const list = listRef.current;
    const item =
      focusKey && list?.querySelector<HTMLElement>(`[data-evidence-key="${CSS.escape(focusKey)}"]`);
    if (!list || !item) return;
    const shift = revealShift(list.getBoundingClientRect(), item.getBoundingClientRect(), 6);
    if (shift !== 0) list.scrollTo({ top: list.scrollTop + shift, behavior: "smooth" });
  }, [focusKey]);

  if (!current) return null;
  return (
    <div className="chat-evidence" id={id} ref={rootRef}>
      {records.length === 1 ? (
        <p className="chat-evidence-title">{current.title}</p>
      ) : (
        <div className="chat-evidence-records" role="group" aria-label="根拠の書類">
          {records.map((record) => {
            const active = record.key === current.key;
            return (
              <button
                key={record.key}
                type="button"
                className={active ? "chat-evidence-record active" : "chat-evidence-record"}
                aria-pressed={active}
                onClick={() => {
                  if (active) return;
                  // 切り替えた書類で最初に出す根拠は、右の欄と同じ順（答えに出てくる値 → 最初のもの）で選ぶ
                  const lead = focusedEvidence(record.items, [], [], answer);
                  if (lead) onSelect(evidenceKey(lead));
                }}
              >
                <span className="chat-evidence-record-title">{record.title}</span>
                <span className="chat-evidence-record-count">{record.items.length}</span>
              </button>
            );
          })}
        </div>
      )}
      <ol className="chat-evidence-list" ref={listRef} onMouseLeave={() => onHover(null)}>
        {current.items.map((item) => {
          const key = evidenceKey(item);
          const value = valueText(item.value);
          const classes = [
            "chat-evidence-item",
            key === focusKey ? "is-focus" : "",
            state.hovered.has(key) ? "is-highlighted" : "",
            state.selected.has(key) ? "is-selected" : "",
          ];
          return (
            <li key={key} data-evidence-key={key}>
              <button
                type="button"
                className={classes.join(" ").replace(/\s+/g, " ").trim()}
                aria-pressed={state.selected.has(key)}
                onMouseEnter={() => onHover(key)}
                onFocus={() => onHover(key)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(key)}
              >
                <span className="chat-evidence-item-label" title={item.label}>
                  {labelInRecord(item, current.title)}
                </span>
                <span
                  className={
                    value === null
                      ? "chat-evidence-item-value is-empty"
                      : "chat-evidence-item-value"
                  }
                >
                  {value ?? "空欄"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * inner を outer の中に見せるのに、outer を縦に動かす量（下へは正）。
 * inner が outer より高いときは、頭を見せる
 */
function revealShift(outer: DOMRect, inner: DOMRect, margin: number): number {
  if (inner.top < outer.top) return inner.top - outer.top - margin;
  if (inner.bottom > outer.bottom)
    return Math.min(inner.bottom - outer.bottom + margin, inner.top - outer.top - margin);
  return 0;
}
