import type { AgorackToEmbedMessage } from "@agorack/contracts";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "../../../../shared/Spinner";
import type { EmbedTarget } from "./embedTarget";
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
 * 部品の埋め込み用の画面を iframe で出す。
 * - embed:ready が届くまで回る輪を出す。embed:error が届く・EMBED_READY_TIMEOUT_MS で届かないときは onFailed
 * - 同じ記録の中で強調する欄だけが替わるときは、読み直さずに agorack:highlight を送る
 *   （記録が替わったら、親が key を替えて作り直す）
 * - 受け取るのは、この iframe から、許した住所（target.origin）で、形が合うメッセージだけ
 */
export function EmbedEvidence({
  target,
  sourceName,
  onFailed,
}: {
  target: EmbedTarget;
  sourceName: string;
  onFailed: (failure: EmbedFailure) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // 記録の画面を開いた最初の住所。欄が替わっても src は替えない（読み直さない）
  const [src] = useState(target.url);
  const [ready, setReady] = useState(false);
  // 画面が今強調している欄（最初は住所で渡した欄）
  const shownField = useRef<string | null>(target.fieldId);
  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  });

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = readEmbedMessage(event, {
        source: frame.current?.contentWindow,
        origin: target.origin,
      });
      if (!message) return;
      if (message.type === "embed:ready") setReady(true);
      else failed.current({ code: message.code });
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

  useEffect(() => {
    if (!ready || !target.fieldId || target.fieldId === shownField.current) return;
    const message: AgorackToEmbedMessage = { type: "agorack:highlight", fieldId: target.fieldId };
    frame.current?.contentWindow?.postMessage(message, target.origin);
    shownField.current = target.fieldId;
  }, [ready, target.fieldId, target.origin]);

  return (
    <div className="embed-evidence">
      <div className="embed-tools">
        <span>{sourceName}の画面</span>
      </div>
      <div className="embed-stage">
        {!ready && (
          <p className="embed-loading" role="status">
            <Spinner />
            {sourceName}の画面を開いています…
          </p>
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
