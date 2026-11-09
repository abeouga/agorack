import { type TurnEvent, TurnEventSchema } from "@agorack/contracts";
import { createParser } from "eventsource-parser";

/**
 * 1ターンの SSE の本文を読み、イベントを1つずつ渡す。
 * 届いたイベントは全部 TurnEventSchema で確かめ、形の合わないものが来たら読むのをやめる。
 * turn.completed か turn.failed で終わる。その前に本文が切れたら StreamError を投げる。
 */

export class StreamError extends Error {
  constructor(
    readonly reason: "invalid_event" | "ended_early",
    message: string,
  ) {
    super(message);
    this.name = "StreamError";
  }
}

export const INVALID_EVENT_MESSAGE =
  "サーバーから形の違う知らせが届いたため、受け取りをやめました。";
export const ENDED_EARLY_MESSAGE = "回答の途中で、サーバーとの接続が切れました。";

const isTerminal = (event: TurnEvent) =>
  event.type === "turn.completed" || event.type === "turn.failed";

export async function readTurnEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TurnEvent) => void,
): Promise<void> {
  const state: { problem: StreamError | null; finished: boolean } = {
    problem: null,
    finished: false,
  };
  const parser = createParser({
    onEvent(message) {
      if (state.problem || state.finished) return;
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        state.problem = new StreamError("invalid_event", INVALID_EVENT_MESSAGE);
        return;
      }
      const parsed = TurnEventSchema.safeParse(data);
      // SSE の event: の名前は type と同じにする取り決め（設計 §8.2）
      if (!parsed.success || (message.event && message.event !== parsed.data.type)) {
        state.problem = new StreamError("invalid_event", INVALID_EVENT_MESSAGE);
        return;
      }
      onEvent(parsed.data);
      if (isTerminal(parsed.data)) state.finished = true;
    },
    onError() {
      state.problem = new StreamError("invalid_event", INVALID_EVENT_MESSAGE);
    },
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  try {
    while (!state.problem && !state.finished) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        break;
      }
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
  } finally {
    // 終わりのイベントのあとや、形の違うイベントのあとは、残りを読まずに閉じる
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (state.problem) throw state.problem;
  if (!state.finished) throw new StreamError("ended_early", ENDED_EARLY_MESSAGE);
}
