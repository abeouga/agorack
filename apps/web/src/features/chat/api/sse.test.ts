import type { TurnEvent } from "@agorack/contracts";
import { describe, expect, it } from "vitest";
import { StreamError, readTurnEvents } from "./sse";

/** 文字列の断片を順に流す本文 */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> & { cancelled: () => boolean } {
  const encoder = new TextEncoder();
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      cancelled = true;
    },
  });
  return Object.assign(stream, { cancelled: () => cancelled });
}

const sse = (event: TurnEvent) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

async function collect(chunks: string[]) {
  const events: TurnEvent[] = [];
  await readTurnEvents(bodyOf(chunks), (event) => events.push(event));
  return events;
}

const started: TurnEvent = { type: "turn.started", turnId: "t1" };
const completed: TurnEvent = {
  type: "turn.completed",
  text: "黒",
  evidence: [],
  reason: "end_turn",
};

describe("SSE の読み取り", () => {
  it("断片の切れ目がイベントの途中でも、1つずつ検証して渡す", async () => {
    const text = sse(started) + sse({ type: "text.delta", text: "毛色は黒" }) + sse(completed);
    // 3文字ずつに切る（日本語の途中でも切れる）
    const chunks = text.match(/[\s\S]{1,3}/g) ?? [];
    expect(await collect(chunks)).toEqual([
      started,
      { type: "text.delta", text: "毛色は黒" },
      completed,
    ]);
  });

  it("バイト列の途中で文字が切れても読める", async () => {
    const bytes = new TextEncoder().encode(
      sse({ type: "text.delta", text: "毛色" }) + sse(completed),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 5) controller.enqueue(bytes.slice(at, at + 5));
        controller.close();
      },
    });
    const events: TurnEvent[] = [];
    await readTurnEvents(stream, (event) => events.push(event));
    expect(events[0]).toEqual({ type: "text.delta", text: "毛色" });
  });

  it("turn.failed で終える", async () => {
    const failed: TurnEvent = { type: "turn.failed", code: "stopped", message: "止めました" };
    expect(await collect([sse(started), sse(failed)])).toEqual([started, failed]);
  });

  it("終わりのイベントのあとは読まずに閉じる", async () => {
    const body = bodyOf([sse(completed), sse(started)]);
    const events: TurnEvent[] = [];
    await readTurnEvents(body, (event) => events.push(event));
    expect(events).toEqual([completed]);
    expect(body.cancelled()).toBe(true);
  });

  it.each([
    ["契約にない type", 'event: turn.paused\ndata: {"type":"turn.paused"}\n\n'],
    ["JSON でない", "event: text.delta\ndata: {oops\n\n"],
    [
      "event の名前と type が違う",
      'event: turn.started\ndata: {"type":"text.delta","text":"x"}\n\n',
    ],
    [
      "根拠の形が違う",
      `event: tool.completed\ndata: ${JSON.stringify({ type: "tool.completed", callId: "c1", ok: true, evidence: [{ kind: "document" }], summary: "" })}\n\n`,
    ],
  ])("%sイベントが来たら、読むのをやめて StreamError を投げる", async (_name, bad) => {
    const events: TurnEvent[] = [];
    const reading = readTurnEvents(bodyOf([sse(started), bad, sse(completed)]), (event) =>
      events.push(event),
    );
    await expect(reading).rejects.toMatchObject({ reason: "invalid_event" });
    expect(events).toEqual([started]);
  });

  it("終わりのイベントの前に切れたら StreamError を投げる", async () => {
    await expect(collect([sse(started)])).rejects.toBeInstanceOf(StreamError);
    await expect(collect([sse(started)])).rejects.toMatchObject({ reason: "ended_early" });
  });
});
