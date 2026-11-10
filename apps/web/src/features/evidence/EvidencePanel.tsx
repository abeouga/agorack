import type { Evidence } from "@agorack/contracts";
import { FiFileText } from "react-icons/fi";
import { Spinner } from "../../shared/Spinner";
import { EvidenceView } from "./renderers";
import { focusedEvidence } from "./selection";

/**
 * 右の欄：選んだ根拠の表示（部品の埋め込み用の画面 → kind ごと → ラベルと値 の順に renderers で選ぶ）。
 * 根拠の一覧は答えの下にある（features/chat）。答えの表の行・答えの下の一覧のホバーで強調し、押すと選ぶ。
 * 出す根拠は ホバー → 選んだもの → 答えに出てくる値 → 最初のもの の順に決める。
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
  onSelect: (key: string) => void;
}) {
  const focus = focusedEvidence(evidence, hovered, selected, answer);
  const highlighted = new Set(hovered);

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
