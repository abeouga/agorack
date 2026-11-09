import { MAX_QUESTION_LENGTH } from "@agorack/contracts";
import { useLayoutEffect, useRef } from "react";
import { FiArrowUp } from "react-icons/fi";

/** 残りの文字数を出し始める長さ */
const COUNT_FROM = MAX_QUESTION_LENGTH - 200;
const MAX_INPUT_HEIGHT = 168;

/** 質問の入力欄。答えている間は、送信のボタンが停止のボタンになる */
export function Composer({
  draft,
  busy,
  onChange,
  onSend,
  onStop,
}: {
  draft: string;
  busy: boolean;
  onChange: (draft: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);
  const length = draft.trim().length;
  const tooLong = length > MAX_QUESTION_LENGTH;
  const canSend = !busy && length > 0 && !tooLong;
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="chat-input-row">
        <label className="sr-only" htmlFor="chat-input">
          質問
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          value={draft}
          rows={1}
          placeholder="質問を入力（Enter で送信、Shift + Enter で改行）"
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // 日本語の変換中の Enter は送らない
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canSend) onSend();
          }}
        />
        {busy ? (
          <button
            type="button"
            className="chat-round-button chat-send chat-stop"
            aria-label="回答を止める"
            title="回答を止める"
            onClick={onStop}
          >
            <span className="chat-stop-mark" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="chat-round-button chat-send"
            disabled={!canSend}
            aria-label="送信"
            title="送信（Enter）"
          >
            <FiArrowUp aria-hidden="true" />
          </button>
        )}
      </div>
      {length > COUNT_FROM && (
        <p className={tooLong ? "chat-composer-foot is-danger" : "chat-composer-foot"}>
          {length} / {MAX_QUESTION_LENGTH} 文字
        </p>
      )}
    </form>
  );
}
