import { describe, expect, it } from "vitest";
import {
  AgorackToEmbedMessageSchema,
  ApiErrorResponseSchema,
  EmbedToAgorackMessageSchema,
  EvidenceSchema,
  SourceInfoSchema,
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
  embedUrl: "http://127.0.0.1:5180/embed?job=job-1021&field=coat",
};

describe("根拠", () => {
  it("形の合う根拠を受け付ける。location の中身は問わない", () => {
    expect(EvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(
      EvidenceSchema.parse({ ...evidence, kind: "ride", location: {}, value: null }),
    ).toBeTruthy();
    expect(EvidenceSchema.parse({ ...evidence, embedUrl: null }).embedUrl).toBeNull();
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
    ["embedUrl がない", { ...evidence, embedUrl: undefined }],
    ["embedUrl が相対の住所", { ...evidence, embedUrl: "/embed?job=1" }],
    ["embedUrl が http・https でない", { ...evidence, embedUrl: "javascript:alert(1)" }],
    [
      "部品の MCP の名前（embed_url）のまま",
      { ...evidence, embedUrl: undefined, embed_url: "http://127.0.0.1:5180/embed" },
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

describe("部品の状態", () => {
  const source = {
    id: "fuminosuke",
    name: "文之助",
    description: "帳票",
    status: "connected",
    error: null,
    toolCount: 6,
    embedOrigin: "http://127.0.0.1:5180",
  };

  it("埋め込みを許す住所（origin）か null を受け付ける", () => {
    expect(SourceInfoSchema.parse(source)).toEqual(source);
    expect(SourceInfoSchema.parse({ ...source, embedOrigin: null }).embedOrigin).toBeNull();
  });

  it.each([
    ["ない", undefined],
    ["パスが付いている", "http://127.0.0.1:5180/embed"],
    ["末尾に / が付いている", "http://127.0.0.1:5180/"],
    ["http・https でない", "file://C:/embed"],
    ["住所でない", "127.0.0.1:5180"],
  ])("embedOrigin が%sものを拒否する", (_name, embedOrigin) => {
    expect(SourceInfoSchema.safeParse({ ...source, embedOrigin }).success).toBe(false);
  });
});

describe("埋め込みの postMessage", () => {
  it("Agorack から部品へは、強調する場所を替えるメッセージだけを受け付ける", () => {
    const message = { type: "agorack:highlight", fieldId: "coat" };
    expect(AgorackToEmbedMessageSchema.parse(message)).toEqual(message);
  });

  it("部品から Agorack へは、準備ができた・失敗のメッセージを受け付ける", () => {
    expect(EmbedToAgorackMessageSchema.parse({ type: "embed:ready" })).toEqual({
      type: "embed:ready",
    });
    expect(EmbedToAgorackMessageSchema.parse({ type: "embed:error", code: "not_found" })).toEqual({
      type: "embed:error",
      code: "not_found",
    });
  });

  it.each([
    ["強調する場所がない", AgorackToEmbedMessageSchema, { type: "agorack:highlight" }],
    ["強調する場所が空", AgorackToEmbedMessageSchema, { type: "agorack:highlight", fieldId: "" }],
    ["向きが逆（部品のメッセージを部品へ）", AgorackToEmbedMessageSchema, { type: "embed:ready" }],
    ["失敗の種類がない", EmbedToAgorackMessageSchema, { type: "embed:error" }],
    ["失敗の種類が文字列でない", EmbedToAgorackMessageSchema, { type: "embed:error", code: 404 }],
    [
      "向きが逆（Agorack のメッセージを Agorack へ）",
      EmbedToAgorackMessageSchema,
      { type: "agorack:highlight", fieldId: "coat" },
    ],
    ["知らない種類", EmbedToAgorackMessageSchema, { type: "embed:unknown" }],
    ["オブジェクトでない", EmbedToAgorackMessageSchema, "embed:ready"],
    ["null", EmbedToAgorackMessageSchema, null],
  ] as const)("形の合わないメッセージ（%s）を拒否する", (_name, schema, message) => {
    expect(schema.safeParse(message).success).toBe(false);
  });
});
