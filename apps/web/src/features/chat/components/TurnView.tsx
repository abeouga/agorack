import type { TurnEndReason } from "@agorack/contracts";
import { useState } from "react";
import { FiAlertTriangle, FiChevronDown, FiFileText, FiRefreshCw } from "react-icons/fi";
import { Markdown, type TableRowBinding } from "../../../shared/markdown/Markdown";
import type { Turn } from "../state/conversation";
import { EvidenceList, type EvidenceListState } from "./EvidenceList";
import { ToolProgress } from "./ToolProgress";

/** 答えが途中で終わった理由の知らせ（end_turn は出さない） */
const END_NOTES: Partial<Record<TurnEndReason, string>> = {
  tool_limit:
    "道具を呼ぶ回数の上限に達したため、途中で止めました。質問を絞って、もう一度聞いてください。",
  max_tokens: "答えが長すぎるため、途中で切れました。",
  refusal: "この質問には答えられませんでした。",
};

/** 1回のやり取り：質問と、答え（進み具合・Markdown・失敗）と、答えの下の根拠の一覧 */
export function TurnView({
  turn,
  latest,
  busy,
  showingEvidence,
  evidenceState,
  rows,
  sourceName,
  onShowEvidence,
  onHoverEvidence,
  onSelectEvidence,
  onRetry,
}: {
  turn: Turn;
  latest: boolean;
  busy: boolean;
  /** 右の欄にこのターンの根拠を出している */
  showingEvidence: boolean;
  evidenceState: EvidenceListState;
  rows: TableRowBinding;
  sourceName: (sourceId: string) => string;
  /** 右の欄にこのターンの根拠を出す */
  onShowEvidence: () => void;
  onHoverEvidence: (key: string | null) => void;
  /** 根拠を選んで右の欄に出す */
  onSelectEvidence: (key: string) => void;
  onRetry: () => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const listId = `evidence-${turn.id}`;
  const pending = turn.status === "pending";
  const stopped = turn.failure?.code === "stopped";
  const classes = [
    "chat-msg bot",
    pending ? "pending" : "",
    turn.failure ? (stopped ? "stopped" : "failed") : "",
  ].join(" ");
  const note = turn.endReason ? END_NOTES[turn.endReason] : undefined;
  return (
    <>
      <div className="chat-msg user">
        <div className="chat-bubble">{turn.question}</div>
      </div>
      <div className={classes.replace(/\s+/g, " ").trim()}>
        <AiAvatar thinking={pending} />
        <div className="chat-bubble">
          <ToolProgress tools={turn.tools} sourceName={sourceName} />
          {pending && !turn.text && (
            <div className="chat-thinking" role="status" aria-label="回答を準備しています">
              <i />
              <i />
              <i />
            </div>
          )}
          {turn.text && <Markdown className="chat-answer" text={turn.text} rows={rows} />}
          {note && (
            <p className="chat-caveat">
              <FiAlertTriangle aria-hidden="true" />
              {note}
            </p>
          )}
          {turn.failure && (
            <div className="chat-failed">
              {stopped ? (
                <p>{turn.failure.message}</p>
              ) : (
                <p role="alert">
                  <FiAlertTriangle aria-hidden="true" />
                  {turn.failure.message}
                </p>
              )}
              {latest && (
                <button type="button" className="secondary" disabled={busy} onClick={onRetry}>
                  <FiRefreshCw aria-hidden="true" />
                  もう一度送る
                </button>
              )}
            </div>
          )}
        </div>
        {turn.evidence.length > 0 && (
          <div className="chat-turn-actions">
            <button
              type="button"
              className={listOpen ? "chat-evidence-button active" : "chat-evidence-button"}
              aria-expanded={listOpen}
              aria-controls={listOpen ? listId : undefined}
              onClick={() => {
                setListOpen(!listOpen);
                if (!showingEvidence) onShowEvidence();
              }}
            >
              <FiFileText aria-hidden="true" />
              根拠 {turn.evidence.length}件
              <FiChevronDown className="chat-evidence-chevron" aria-hidden="true" />
            </button>
          </div>
        )}
        {listOpen && turn.evidence.length > 0 && (
          <EvidenceList
            id={listId}
            evidence={turn.evidence}
            answer={turn.text}
            state={evidenceState}
            onHover={onHoverEvidence}
            onSelect={onSelectEvidence}
          />
        )}
      </div>
    </>
  );
}

/** 答える側の印。考えている間は輪が回る */
function AiAvatar({ thinking }: { thinking: boolean }) {
  return (
    <span className={thinking ? "chat-avatar thinking" : "chat-avatar"} aria-hidden="true">
      <b>A</b>
    </span>
  );
}
