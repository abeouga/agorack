import { describe, expect, it } from "vitest";
import {
  ApiErrorResponseSchema,
  EvidenceSchema,
  MAX_QUESTION_LENGTH,
  StartTurnRequestSchema,
  TurnEventSchema,
  apiPaths,
} from "./index.js";

const evidence = {
  kind: "document",
  sourceId: "fuminosuke",
  recordId: "job-1021",
  label: "繁殖台帳1021「はじめ」の毛色",
  location: { field_id: "coat", page_id: "p1", box: { x: 1, y: 2, width: 3, height: 4 } },
  value: "黒",
};

describe("根拠", () => {
  it("形の合う根拠を受け付ける。location の中身は問わない", () => {
    expect(EvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(
      EvidenceSchema.parse({ ...evidence, kind: "ride", location: {}, value: null }),
    ).toBeTruthy();
  });

  it.each([
    ["kind がない", { ...evidence, kind: undefined }],
    ["kind が空", { ...evidence, kind: "" }],
    ["部品の id に使えない文字", { ...evidence, sourceId: "fumi-nosuke" }],
    ["recordId が空", { ...evidence, recordId: "" }],
    ["label がない", { ...evidence, label: undefined }],
    ["location が配列", { ...evidence, location: [] }],
    [
      "部品の MCP の名前（source_id）のまま",
      { ...evidence, recordId: undefined, source_id: "job-1021" },
    ],
  ])("%s根拠を拒否する", (_name, input) => {
    expect(EvidenceSchema.safeParse(input).success).toBe(false);
  });
});

describe("1ターンのイベント", () => {
  it.each([
    { type: "turn.started", turnId: "t1" },
    { type: "text.delta", text: "こよみの毛色は" },
    {
      type: "tool.called",
      callId: "c1",
      sourceId: "fuminosuke",
      tool: "get_document",
      input: { name: "こよみ" },
    },
    {
      type: "tool.completed",
      callId: "c1",
      ok: true,
      evidence: [evidence],
      summary: "書類を1件見つけました",
    },
    {
      type: "tool.completed",
      callId: "c2",
      ok: false,
      evidence: [],
      summary: "書類が見つかりません",
    },
    { type: "turn.completed", text: "黒です。", evidence: [evidence], reason: "end_turn" },
    { type: "turn.completed", text: "", evidence: [], reason: "tool_limit" },
    { type: "turn.failed", code: "stopped", message: "止めました" },
  ])("$type を受け付ける", (event) => {
    expect(TurnEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    ["知らない type", { type: "turn.paused" }],
    ["type がない", { text: "黒" }],
    ["text.delta に text がない", { type: "text.delta" }],
    [
      "tool.called の部品の id が不正",
      { type: "tool.called", callId: "c1", sourceId: "a b", tool: "x", input: {} },
    ],
    [
      "tool.completed の根拠の形が違う",
      {
        type: "tool.completed",
        callId: "c1",
        ok: true,
        evidence: [{ kind: "document" }],
        summary: "",
      },
    ],
    [
      "turn.completed の知らない理由",
      { type: "turn.completed", text: "", evidence: [], reason: "timeout" },
    ],
    ["turn.failed の知らないコード", { type: "turn.failed", code: "oops", message: "" }],
  ])("%s イベントを拒否する", (_name, input) => {
    expect(TurnEventSchema.safeParse(input).success).toBe(false);
  });
});

describe("HTTP", () => {
  it("質問の前後の空白を落とす", () => {
    expect(StartTurnRequestSchema.parse({ text: "  こよみの毛色は？ \n" })).toEqual({
      text: "こよみの毛色は？",
    });
  });

  it.each([
    ["空の質問", { text: "" }],
    ["空白だけの質問", { text: "  \n " }],
    ["長すぎる質問", { text: "あ".repeat(MAX_QUESTION_LENGTH + 1) }],
    ["text がない", {}],
  ])("%sを拒否する", (_name, input) => {
    expect(StartTurnRequestSchema.safeParse(input).success).toBe(false);
  });

  it("知らないエラーのコードを拒否する", () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        error: { code: "TURN_IN_PROGRESS", message: "進行中です" },
      }).success,
    ).toBe(true);
    expect(
      ApiErrorResponseSchema.safeParse({ error: { code: "TEAPOT", message: "" } }).success,
    ).toBe(false);
  });

  it("パスの中の会話の ID を符号化する", () => {
    expect(apiPaths.stopTurn("a/b")).toBe("/api/conversations/a%2Fb/turns/current/stop");
  });
});
