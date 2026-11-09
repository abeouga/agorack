import type { Evidence } from "@agorack/contracts";
import { useLayoutEffect, useRef, useState } from "react";
import { evidenceForRow, evidenceKey } from "../../evidence/selection";
import type { Conversation } from "../state/conversation";
import { Composer } from "./Composer";
import { TurnView } from "./TurnView";

/** 下の端からこれより近ければ、流れてくる答えに合わせて下へ送る */
const FOLLOW_GAP = 120;

/** チャットの欄：会話と入力欄 */
export function ChatPanel({
  conversation,
  busy,
  shownTurnId,
  selectedKeys,
  sourceName,
  onSend,
  onStop,
  onShowEvidence,
  onHoverEvidence,
  onSelectEvidence,
}: {
  conversation: Conversation;
  busy: boolean;
  /** 右の欄に根拠を出しているターン */
  shownTurnId: string | null;
  selectedKeys: ReadonlySet<string>;
  sourceName: (sourceId: string) => string;
  onSend: (question: string) => void;
  onStop: () => void;
  onShowEvidence: (turnId: string) => void;
  onHoverEvidence: (turnId: string, keys: string[]) => void;
  onSelectEvidence: (turnId: string, keys: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const turns = conversation.turns;
  const last = turns[turns.length - 1];

  // 新しいやり取りが見えるように会話の中だけを動かす。答え終わったら、長い答えも頭から読めるように質問から見せる
  const scrollKey = `${conversation.id}:${turns.length}:${last?.status}`;
  const shownKey = useRef("");
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const first = !shownKey.current.startsWith(`${conversation.id}:`);
    shownKey.current = scrollKey;
    const bottom = list.scrollHeight - list.clientHeight;
    const asked = [...list.querySelectorAll<HTMLElement>(".chat-msg.user")].pop();
    const top =
      asked && last?.status !== "pending" ? Math.min(bottom, asked.offsetTop - 12) : bottom;
    list.scrollTo({ top: Math.max(top, 0), behavior: first ? "instant" : "smooth" });
    // scrollKey が変わったときだけ動かす（読んでいる場所を勝手に変えない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);
  // 答えが流れている間は、下の端を見ているときだけ付いていく
  const streamed = last?.status === "pending" ? `${last.text.length}:${last.tools.length}` : "";
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !streamed) return;
    const gap = list.scrollHeight - list.clientHeight - list.scrollTop;
    if (gap < FOLLOW_GAP) list.scrollTop = list.scrollHeight;
  }, [streamed]);

  const send = () => {
    const question = draft.trim();
    if (!question) return;
    setDraft("");
    onSend(question);
  };

  const keysOf = (cells: string[], evidence: Evidence[]) =>
    evidenceForRow(cells, evidence).map(evidenceKey);

  return (
    <section className="chat-panel" aria-label="チャット">
      <div className="chat-messages" ref={listRef} role="log" aria-live="polite">
        {turns.length === 0 ? (
          <div className="chat-welcome">
            <h2>
              <span className="chat-welcome-hello">{greeting(new Date())}</span>
              <span className="chat-welcome-ask">何を調べますか？</span>
            </h2>
            <p>部品（文之助など）が返した値と根拠だけで答えます。</p>
          </div>
        ) : (
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              latest={turn.id === last?.id}
              busy={busy}
              showingEvidence={turn.id === shownTurnId}
              sourceName={sourceName}
              onShowEvidence={() => onShowEvidence(turn.id)}
              onRetry={() => onSend(turn.question)}
              rows={{
                linked: (cells) => keysOf(cells, turn.evidence).length > 0,
                active: (cells) =>
                  turn.id === shownTurnId &&
                  keysOf(cells, turn.evidence).some((key) => selectedKeys.has(key)),
                onHover: (cells) =>
                  onHoverEvidence(turn.id, cells ? keysOf(cells, turn.evidence) : []),
                onSelect: (cells) => onSelectEvidence(turn.id, keysOf(cells, turn.evidence)),
              }}
            />
          ))
        )}
      </div>
      <Composer draft={draft} busy={busy} onChange={setDraft} onSend={send} onStop={onStop} />
    </section>
  );
}

/** 時刻に合わせたあいさつ */
function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour >= 4 && hour < 11) return "おはようございます";
  if (hour >= 11 && hour < 18) return "こんにちは";
  return "こんばんは";
}
