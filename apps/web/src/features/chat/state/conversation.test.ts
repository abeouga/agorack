import type { Evidence, TurnEvent } from "@agorack/contracts";
import { describe, expect, it } from "vitest";
import {
  type Conversation,
  type ConversationAction,
  conversationReducer,
  emptyConversation,
  isBusy,
} from "./conversation";

const coat = (no: number, name: string): Evidence => ({
  kind: "document",
  sourceId: "fuminosuke",
  recordId: `job-${no}`,
  label: `繁殖台帳${no}「${name}」の毛色`,
  location: { field_id: "coat" },
  value: "黒",
});

const hajime = coat(1021, "はじめ");
const koyomi = coat(1034, "こよみ");

/** 質問を送り、イベントを順に流した会話 */
function run(events: TurnEvent[], extra: ConversationAction[] = []): Conversation {
  const actions: ConversationAction[] = [
    { type: "turn.submitted", turnId: "t1", question: "毛色が黒の牛は？", at: 1000 },
    ...events.map((event): ConversationAction => ({ type: "turn.event", turnId: "t1", event })),
    ...extra,
  ];
  return actions.reduce(conversationReducer, emptyConversation("c1", 0));
}

const turnOf = (conversation: Conversation) => {
  const turn = conversation.turns[0];
  if (!turn) throw new Error("ターンがありません");
  return turn;
};

describe("質問を送る", () => {
  it("進行中のターンを足し、最初の質問を会話の題にする", () => {
    const conversation = run([]);
    expect(conversation.title).toBe("毛色が黒の牛は？");
    expect(conversation.updatedAt).toBe(1000);
    expect(turnOf(conversation)).toMatchObject({ status: "pending", text: "", tools: [] });
    expect(isBusy(conversation)).toBe(true);
  });

  it("長い質問は題を切り詰める", () => {
    const question = "あ".repeat(60);
    const conversation = conversationReducer(emptyConversation("c1", 0), {
      type: "turn.submitted",
      turnId: "t1",
      question,
      at: 1,
    });
    expect(conversation.title).toBe(`${"あ".repeat(40)}…`);
  });
});

describe("根拠付きの答え", () => {
  const events: TurnEvent[] = [
    { type: "turn.started", turnId: "server-1" },
    {
      type: "tool.called",
      callId: "c1",
      sourceId: "fuminosuke",
      tool: "search_documents",
      input: { field: "毛色" },
    },
    {
      type: "tool.completed",
      callId: "c1",
      ok: true,
      evidence: [hajime, koyomi],
      summary: "書類を2件見つけました",
    },
    { type: "text.delta", text: "黒の牛は" },
    { type: "text.delta", text: "2頭です。" },
  ];

  it("道具の呼び出しの進み具合を追う", () => {
    const called = run(events.slice(0, 2));
    expect(turnOf(called).serverTurnId).toBe("server-1");
    expect(turnOf(called).tools).toEqual([
      expect.objectContaining({ callId: "c1", status: "running", summary: null }),
    ]);
    const completed = run(events.slice(0, 3));
    expect(turnOf(completed).tools[0]).toMatchObject({
      status: "succeeded",
      summary: "書類を2件見つけました",
      evidence: [hajime, koyomi],
    });
    // 答え終わる前から、根拠を右の欄に出せる
    expect(turnOf(completed).evidence).toEqual([hajime, koyomi]);
  });

  it("文章の断片をつなげる", () => {
    expect(turnOf(run(events)).text).toBe("黒の牛は2頭です。");
  });

  it("turn.completed の全文と根拠で置き換えて終える", () => {
    const conversation = run([
      ...events,
      {
        type: "turn.completed",
        text: "黒の牛は**2頭**です。",
        evidence: [hajime],
        reason: "end_turn",
      },
    ]);
    expect(turnOf(conversation)).toMatchObject({
      status: "completed",
      text: "黒の牛は**2頭**です。",
      evidence: [hajime],
      endReason: "end_turn",
      failure: null,
    });
    expect(isBusy(conversation)).toBe(false);
  });

  it("全文が空なら、流れてきた文章を残す", () => {
    const conversation = run([
      ...events,
      { type: "turn.completed", text: "", evidence: [], reason: "max_tokens" },
    ]);
    expect(turnOf(conversation)).toMatchObject({
      text: "黒の牛は2頭です。",
      endReason: "max_tokens",
    });
  });

  it("同じ根拠は1つにまとめる", () => {
    const conversation = run([
      ...events,
      {
        type: "tool.called",
        callId: "c2",
        sourceId: "fuminosuke",
        tool: "get_document",
        input: {},
      },
      { type: "tool.completed", callId: "c2", ok: true, evidence: [koyomi], summary: "" },
    ]);
    expect(turnOf(conversation).evidence).toEqual([hajime, koyomi]);
  });

  it("同じ呼び出しの tool.called が2度届いても1つにする。知らない呼び出しの完了は捨てる", () => {
    const conversation = run([
      events[1] as TurnEvent,
      events[1] as TurnEvent,
      { type: "tool.completed", callId: "unknown", ok: true, evidence: [hajime], summary: "" },
    ]);
    expect(turnOf(conversation).tools).toHaveLength(1);
    expect(turnOf(conversation).evidence).toEqual([]);
  });
});

describe("失敗と停止", () => {
  const called: TurnEvent = {
    type: "tool.called",
    callId: "c1",
    sourceId: "fuminosuke",
    tool: "get_document",
    input: { name: "ゆうき" },
  };

  it("道具の失敗は、ターンを止めずに呼び出しの印だけを変える", () => {
    const conversation = run([
      called,
      {
        type: "tool.completed",
        callId: "c1",
        ok: false,
        evidence: [],
        summary: "書類が見つかりません",
      },
    ]);
    expect(turnOf(conversation).status).toBe("pending");
    expect(turnOf(conversation).tools[0]).toMatchObject({
      status: "failed",
      summary: "書類が見つかりません",
    });
  });

  it("turn.failed で失敗として終え、途中の文章と、動いていた呼び出しを止めた印を残す", () => {
    const conversation = run([
      called,
      { type: "text.delta", text: "確認して" },
      { type: "turn.failed", code: "model_error", message: "Claude の呼び出しに失敗しました" },
    ]);
    expect(turnOf(conversation)).toMatchObject({
      status: "failed",
      text: "確認して",
      failure: { code: "model_error", message: "Claude の呼び出しに失敗しました" },
    });
    expect(turnOf(conversation).tools[0]?.status).toBe("cancelled");
    expect(isBusy(conversation)).toBe(false);
  });

  it("停止（turn.failed の stopped）で止まる", () => {
    const conversation = run([
      called,
      { type: "turn.failed", code: "stopped", message: "回答を止めました。" },
    ]);
    expect(turnOf(conversation).failure).toEqual({
      code: "stopped",
      message: "回答を止めました。",
    });
  });

  it("画面の側で受け取りをやめたときも停止として終える", () => {
    const conversation = run(
      [called],
      [{ type: "turn.abandoned", turnId: "t1", message: "止めました" }],
    );
    expect(turnOf(conversation)).toMatchObject({
      status: "failed",
      failure: { code: "stopped", message: "止めました" },
    });
  });

  it("つながらないなど、画面の側の失敗を記録する", () => {
    const conversation = run(
      [],
      [{ type: "turn.errored", turnId: "t1", message: "つながりません" }],
    );
    expect(turnOf(conversation).failure).toEqual({
      code: "client_error",
      message: "つながりません",
    });
  });

  it("終わったターンに遅れて届いたイベントは捨てる", () => {
    const finished = run([{ type: "turn.failed", code: "stopped", message: "止めました" }]);
    const late = [
      { type: "text.delta", text: "遅れた文章" },
      { type: "turn.completed", text: "遅れた答え", evidence: [hajime], reason: "end_turn" },
    ] satisfies TurnEvent[];
    const after = late.reduce(
      (conversation, event) =>
        conversationReducer(conversation, { type: "turn.event", turnId: "t1", event }),
      finished,
    );
    expect(after).toBe(finished);
    expect(
      conversationReducer(finished, { type: "turn.errored", turnId: "t1", message: "x" }),
    ).toBe(finished);
  });
});

it("サーバーの会話の ID を覚える", () => {
  const conversation = conversationReducer(emptyConversation("c1", 0), {
    type: "server.assigned",
    serverId: "s1",
  });
  expect(conversation.serverId).toBe("s1");
});
