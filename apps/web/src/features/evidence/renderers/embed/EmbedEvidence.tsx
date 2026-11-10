import type { Evidence } from "@agorack/contracts";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "../../../../shared/Spinner";
import { PaneHead, PaneLead } from "../pane/PaneHead";
import { type EmbedTarget, highlightMessage } from "./embedTarget";
import { readEmbedMessage } from "./messages";
import "./embed.css";

/** embed:ready を待つ時間。過ぎたら kind ごとの表示に戻す */
export const EMBED_READY_TIMEOUT_MS = 8000;

/**
 * iframe に与える権限（設計 §7.4）。上の画面を動かす・フォームを送る権限は与えない。
 * allow-popups-to-escape-sandbox は、「部品で開く」の新しいタブを制限なしの普通の画面として開くため。
 */
export const EMBED_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/** 埋め込めなかった理由（embed:error のコード、または timeout） */
export type EmbedFailure = { code: string };

/**
 * 部品の埋め込み用の画面を iframe で出す。iframe は枠線なしで右の欄いっぱいに置く（外の枠は右の欄が描く）。
 * - embed:ready が届くまで、文之助のチャットの書類の欄と同じく、上の行（書類の名前と ×）と案内の文を重ねて出す。embed:error が届く・EMBED_READY_TIMEOUT_MS で届かないときは onFailed
 * - embed:ready を受けたらすぐ、agorack:highlight（選んだ欄と、同じ記録の根拠の欄の全部 fieldIds）を送る。
 *   選んだ欄や同じ記録の根拠が替わったときも、読み直さずに送り直す（記録が替わったら、親が key を替えて作り直す）
 * - embed:close（部品の画面の ×）が届いたら、右の欄を閉じる（onClose）
 * - 受け取るのは、この iframe から、許した住所（target.origin）で、形が合うメッセージだけ
 */
export function EmbedEvidence({
  target,
  siblings,
  title,
  sourceName,
  onFailed,
  onClose,
}: {
  target: EmbedTarget;
  /** 同じ答えの根拠の全部（同じ記録の欄を fieldIds にまとめて送る） */
  siblings: readonly Evidence[];
  /** 開いている間の上の行に出す名前（書類の名前など） */
  title: string;
  sourceName: string;
  onFailed: (failure: EmbedFailure) => void;
  /** 右の欄を閉じる（開いている間の上の行の ×） */
  onClose: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // 記録の画面を開いた最初の住所。欄が替わっても src は替えない（読み直さない）
  const [src] = useState(target.url);
  const [ready, setReady] = useState(false);
  // 最後に送った agorack:highlight（同じものを何度も送らない）
  const sent = useRef<string | null>(null);
  const failed = useRef(onFailed);
  const closed = useRef(onClose);
  useEffect(() => {
    failed.current = onFailed;
    closed.current = onClose;
  });

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = readEmbedMessage(event, {
        source: frame.current?.contentWindow,
        origin: target.origin,
      });
      if (!message) return;
      if (message.type === "embed:ready") setReady(true);
      else if (message.type === "embed:error") failed.current({ code: message.code });
      else if (message.type === "embed:close") closed.current();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [target.origin]);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(
      () => failed.current({ code: "timeout" }),
      EMBED_READY_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [ready]);

  // 送るもの。中身が同じなら同じ文字列になるので、根拠の配列が作り直されても送り直さない
  const message = highlightMessage(target, siblings);
  const messageKey = message ? JSON.stringify(message) : null;
  const latest = useRef(message);
  useEffect(() => {
    latest.current = message;
  });
  useEffect(() => {
    const next = latest.current;
    if (!ready || !next || messageKey === sent.current) return;
    frame.current?.contentWindow?.postMessage(next, target.origin);
    sent.current = messageKey;
  }, [ready, messageKey, target.origin]);

  return (
    <div className="embed-evidence">
      <div className="embed-stage">
        {!ready && (
          <div className="embed-loading">
            <PaneHead title={title} onClose={onClose} />
            <PaneLead>
              <Spinner />
              {sourceName}の画面を開いています…
            </PaneLead>
          </div>
        )}
        <iframe
          ref={frame}
          className={ready ? "embed-frame is-ready" : "embed-frame"}
          src={src}
          title={`${sourceName}の埋め込み用の画面`}
          sandbox={EMBED_SANDBOX}
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}
