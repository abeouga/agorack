import { useEffect, useRef, type Dispatch } from "react";
import { ApiError } from "../../shared/http";
import {
  type HistoryAction,
  type HistoryState,
  currentConversation,
} from "../history/historyReducer";
import { createConversation, deleteConversation, startTurn, stopTurn } from "./api/client";
import { StreamError, readTurnEvents } from "./api/sse";
import { type ConversationAction, STOPPED_MESSAGE, isBusy } from "./state/conversation";

/** 停止を頼んでから、サーバーが turn.failed（stopped）を送ってくるのを待つ時間 */
const STOP_GRACE_MS = 3000;

type Run = {
  serverId: string | null;
  controller: AbortController;
  stopping: boolean;
  stopTimer: number | undefined;
};

/** 質問を送り、SSE を受けて会話の状態を進める。停止と会話の削除もここで行う */
export function useChat(history: HistoryState, dispatch: Dispatch<HistoryAction>) {
  const runRef = useRef<Run | null>(null);
  const busy = history.conversations.some(isBusy);

  // 画面を閉じたら受け取りをやめる（サーバーは接続が切れたことで止める）
  useEffect(() => () => runRef.current?.controller.abort(), []);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy || runRef.current) return;
    const conversation = currentConversation(history);
    const turnId = crypto.randomUUID();
    const change = (action: ConversationAction) =>
      dispatch({ type: "conversation.changed", id: conversation.id, action });
    change({ type: "turn.submitted", turnId, question, at: Date.now() });

    const run: Run = {
      serverId: conversation.serverId,
      controller: new AbortController(),
      stopping: false,
      stopTimer: undefined,
    };
    runRef.current = run;
    const open = async () => {
      const serverId = await createConversation();
      run.serverId = serverId;
      change({ type: "server.assigned", serverId });
      return serverId;
    };
    try {
      let serverId = run.serverId ?? (await open());
      let body: ReadableStream<Uint8Array>;
      try {
        body = await startTurn(serverId, question, run.controller.signal);
      } catch (error) {
        // サーバーを起動し直して会話がなくなっていたら、新しく始めて送り直す
        if (!(error instanceof ApiError && error.code === "CONVERSATION_NOT_FOUND")) throw error;
        serverId = await open();
        body = await startTurn(serverId, question, run.controller.signal);
      }
      await readTurnEvents(body, (event) => change({ type: "turn.event", turnId, event }));
    } catch (error) {
      if (run.controller.signal.aborted) {
        change({ type: "turn.abandoned", turnId, message: STOPPED_MESSAGE });
      } else {
        change({ type: "turn.errored", turnId, message: messageOf(error) });
      }
    } finally {
      window.clearTimeout(run.stopTimer);
      if (runRef.current === run) runRef.current = null;
    }
  };

  const stop = async () => {
    const run = runRef.current;
    if (!run || run.stopping) return;
    run.stopping = true;
    if (!run.serverId) {
      run.controller.abort();
      return;
    }
    try {
      await stopTurn(run.serverId);
    } catch {
      run.controller.abort();
      return;
    }
    // サーバーが turn.failed（stopped）を送って閉じるのを待つ。来なければ画面の側で受け取りをやめる
    if (runRef.current === run) {
      run.stopTimer = window.setTimeout(() => run.controller.abort(), STOP_GRACE_MS);
    }
  };

  const remove = (id: string) => {
    const target = history.conversations.find((item) => item.id === id);
    dispatch({ type: "conversation.removed", id, nextId: crypto.randomUUID(), at: Date.now() });
    // サーバーの側の会話も消す。サーバーを起動し直してもうないときもあるので、失敗は気にしない
    if (target?.serverId) deleteConversation(target.serverId).catch(() => undefined);
  };

  return { busy, send, stop, remove };
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError || error instanceof StreamError) return error.message;
  return "回答を受け取れませんでした。";
}
