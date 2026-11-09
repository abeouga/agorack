import type { TurnEvent } from "@agorack/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  documentResult,
  FakeCatalog,
  FakeModel,
  respond,
  respondUntilAborted,
  stop,
  textDelta,
  toolUse,
} from "../testing/fakePorts.js";
import { InMemoryConversations, type StartTurnResult } from "./index.js";

function setup(model: FakeModel, catalog = new FakeCatalog()) {
  let n = 0;
  const logError = vi.fn();
  const conversations = new InMemoryConversations({
    ports: { model, catalog },
    options: { maxToolCalls: 5, instructions: "共通の指示" },
    newId: () => `id-${++n}`,
    logError,
  });
  return { conversations, logError };
}

function started(result: StartTurnResult) {
  if (!result.ok) throw new Error(`ターンを始められない：${result.error}`);
  return result;
}

async function readAll(events: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("1ターンの実行", () => {
  it("イベントが順に流れ、最後に答えと根拠が届く", async () => {
    const model = new FakeModel([
      respond(
        textDelta("探します。"),
        toolUse("call-1", "fuminosuke__get_document", { id: "1" }),
        stop("tool_use"),
      ),
      respond(textDelta("黒です。"), stop("end_turn")),
    ]);
    const catalog = new FakeCatalog({ fuminosuke__get_document: documentResult("1", "黒") });
    const { conversations } = setup(model, catalog);
    const id = conversations.create();

    const turn = started(conversations.startTurn(id, "毛色は？"));
    const events = await readAll(turn.events);

    expect(events.map((e) => e.type)).toEqual([
      "turn.started",
      "text.delta",
      "tool.called",
      "tool.completed",
      "text.delta",
      "turn.completed",
    ]);
    expect(events[0]).toEqual({ type: "turn.started", turnId: turn.turnId });
    expect(events.at(-1)).toMatchObject({
      type: "turn.completed",
      text: "探します。黒です。",
      reason: "end_turn",
      evidence: [{ kind: "document", sourceId: "fuminosuke", recordId: "1", value: "黒" }],
    });
  });

  it("答えを出したターンは履歴に残り、次のターンでモデルに渡る", async () => {
    const model = new FakeModel([
      respond(textDelta("黒です。"), stop("end_turn")),
      respond(textDelta("はい。"), stop("end_turn")),
    ]);
    const { conversations } = setup(model);
    const id = conversations.create();
    await readAll(started(conversations.startTurn(id, "毛色は？")).events);
    await readAll(started(conversations.startTurn(id, "本当？")).events);

    expect(model.requests[1]?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "毛色は？" }] },
      { role: "assistant", content: [{ type: "text", text: "黒です。" }] },
      { role: "user", content: [{ type: "text", text: "本当？" }] },
    ]);
  });

  it("会話ごとに履歴を分ける", async () => {
    const model = new FakeModel([
      respond(textDelta("A"), stop("end_turn")),
      respond(textDelta("B"), stop("end_turn")),
    ]);
    const { conversations } = setup(model);
    const first = conversations.create();
    const second = conversations.create();
    await readAll(started(conversations.startTurn(first, "1つ目")).events);
    await readAll(started(conversations.startTurn(second, "2つ目")).events);
    expect(model.requests[1]?.messages).toHaveLength(1);
  });

  it("ない会話には not_found を返す", () => {
    const { conversations } = setup(new FakeModel([]));
    expect(conversations.startTurn("nope", "q")).toEqual({ ok: false, error: "not_found" });
    expect(conversations.stopTurn("nope")).toBe(false);
    expect(conversations.delete("nope")).toBe(false);
  });

  it("Claude の呼び出しが失敗したら turn.failed で終え、原因を記録し、履歴には足さない", async () => {
    const failing = new FakeModel([
      // eslint-disable-next-line require-yield
      async function* () {
        throw new Error("API の失敗");
      },
      respond(textDelta("はい"), stop("end_turn")),
    ]);
    const { conversations, logError } = setup(failing);
    const id = conversations.create();
    const events = await readAll(started(conversations.startTurn(id, "q")).events);
    expect(events.at(-1)).toMatchObject({ type: "turn.failed", code: "model_error" });
    expect(logError).toHaveBeenCalledOnce();

    await readAll(started(conversations.startTurn(id, "もう一度")).events);
    expect(failing.requests[1]?.messages).toHaveLength(1);
  });
});

describe("同時に1ターンだけ・停止・切断", () => {
  it("進行中のターンがあると turn_in_progress を返す。止めると stopped で終わり、次を始められる", async () => {
    const model = new FakeModel([
      respondUntilAborted("考え中"),
      respond(textDelta("はい"), stop("end_turn")),
    ]);
    const { conversations, logError } = setup(model);
    const id = conversations.create();
    const turn = started(conversations.startTurn(id, "長い質問"));
    const reading = readAll(turn.events);

    await vi.waitFor(() => expect(model.requests).toHaveLength(1));
    expect(conversations.startTurn(id, "割り込み")).toEqual({
      ok: false,
      error: "turn_in_progress",
    });

    expect(conversations.stopTurn(id)).toBe(true);
    const events = await reading;
    expect(events.map((e) => e.type)).toEqual(["turn.started", "text.delta", "turn.failed"]);
    expect(events.at(-1)).toMatchObject({ code: "stopped" });
    expect(logError).not.toHaveBeenCalled();

    // 止めたターンは履歴に足さない
    await readAll(started(conversations.startTurn(id, "次の質問")).events);
    expect(model.requests[1]?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "次の質問" }] },
    ]);
  });

  it("進行中のターンがなくても、止めるのは成功する", () => {
    const { conversations } = setup(new FakeModel([]));
    expect(conversations.stopTurn(conversations.create())).toBe(true);
  });

  it("イベントを読むのをやめたら（接続の切断）、ターンを止める", async () => {
    let signal: AbortSignal | undefined;
    const model = new FakeModel([
      async function* (request, s) {
        signal = s;
        yield* respondUntilAborted("考え中")(request, s);
      },
      respond(textDelta("はい"), stop("end_turn")),
    ]);
    const { conversations } = setup(model);
    const id = conversations.create();
    for await (const event of started(conversations.startTurn(id, "q")).events) {
      if (event.type === "text.delta") break;
    }
    expect(signal?.aborted).toBe(true);
    // ターンが終わると、次を始められる
    await vi.waitFor(() => expect(conversations.startTurn(id, "次").ok).toBe(true));
  });

  it("外から渡した signal（HTTP の接続）が中断されたら、ターンを止める", async () => {
    const model = new FakeModel([respondUntilAborted("考え中")]);
    const { conversations } = setup(model);
    const id = conversations.create();
    const connection = new AbortController();
    const turn = started(conversations.startTurn(id, "q", connection.signal));
    const reading = readAll(turn.events);
    await vi.waitFor(() => expect(model.requests).toHaveLength(1));
    connection.abort();
    expect((await reading).at(-1)).toMatchObject({ type: "turn.failed", code: "stopped" });
  });

  it("会話を消すと、進行中のターンを止め、会話はなくなる", async () => {
    const model = new FakeModel([respondUntilAborted("考え中")]);
    const { conversations } = setup(model);
    const id = conversations.create();
    const reading = readAll(started(conversations.startTurn(id, "q")).events);
    await vi.waitFor(() => expect(model.requests).toHaveLength(1));

    expect(conversations.delete(id)).toBe(true);
    expect((await reading).at(-1)).toMatchObject({ type: "turn.failed", code: "stopped" });
    expect(conversations.startTurn(id, "q")).toEqual({ ok: false, error: "not_found" });
  });
});
