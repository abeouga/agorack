import type { Evidence } from "@agorack/contracts";
import { useEffect, useRef } from "react";
import { EvidenceView } from "./renderers";
import { focusedEvidence } from "./selection";
import { Splitter } from "./Splitter";

/**
 * 右の欄：文之助のチャットの書類の欄と同じ「書類の欄」1枚（設計 §7.3、決定 0005）。
 * 外の枠（枠線・角の丸み・チャットとの境目のつまみ）をここで描き、中に選んだ根拠の表示を1つだけ置く
 * （部品の埋め込み用の画面 → kind ごと → ラベルと値 の順に renderers で選ぶ）。見出しや質問の文は置かない。
 * 根拠の一覧は答えの下にある（features/chat）。答えの表の行・答えの下の一覧のホバーで強調し、押すと選ぶ。
 * 出す根拠は ホバー → 選んだもの → 答えに出てくる値 → 最初のもの の順に決める。
 * 根拠がない答えでは、右の欄そのものを出さない（呼ぶ側が決める）。
 */
export function EvidencePanel({
  answer,
  evidence,
  hovered,
  selected,
  sourceName,
  embedOriginOf,
  split,
  onResize,
  onSelect,
  onClose,
}: {
  /** 答えの文章（最初に出す根拠を選ぶのに使う） */
  answer: string;
  evidence: Evidence[];
  hovered: readonly string[];
  selected: readonly string[];
  sourceName: (sourceId: string) => string;
  /** 部品の埋め込み用の画面を許す住所 */
  embedOriginOf: (sourceId: string) => string | null;
  /** 今のチャットの割合（境目のつまみに出す） */
  split: number;
  /** 境目のつまみで、チャットの割合を変えた */
  onResize: (ratio: number) => void;
  onSelect: (key: string) => void;
  /** 右の欄を閉じる（× ・Esc キー） */
  onClose: () => void;
}) {
  const focus = focusedEvidence(evidence, hovered, selected, answer);
  const highlighted = new Set(hovered);

  // 文之助のチャットの書類の欄と同じく、Esc キーでも閉じる
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className="evidence-panel" aria-label="根拠">
      <Splitter value={split} onResize={onResize} />
      {focus && (
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
            onClose={onClose}
          />
        </section>
      )}
    </aside>
  );
}
