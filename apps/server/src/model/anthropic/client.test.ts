import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Message, ModelRequest, ModelStreamEvent } from "../../agent/ports.js";
import { ConfigError } from "../../config/index.js";
import { createModelClientWith } from "./client.js";
import { createAnthropicModelClient, ModelResponseError, type AnthropicSettings } from "./index.js";

const settings: AnthropicSettings = {
  apiKey: "test-key",
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 64000,
};

// ---- 偽の API（SSE を返す fetch） ----

type RawEvent = Record<string, unknown> & { type: string };

const messageStart = (model = "claude-opus-5-5"): RawEvent => ({
  type: "message_start",
  message: {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 0 },
  },
});
const blockStart = (index: number, content_block: Record<string, unknown>): RawEvent => ({
  type: "content_block_start",
  index,
  content_block,
});
const delta = (index: number, d: Record<string, unknown>): RawEvent => ({
  type: "content_block_delta",
  index,
  delta: d,
});
const blockStop = (index: number): RawEvent => ({ type: "content_block_stop", index });
const messageEnd = (stop_reason: string): RawEvent[] => [
  {
    type: "message_delta",
    delta: { stop_reason, stop_sequence: null },
    usage: { output_tokens: 5 },
  },
  { type: "message_stop" },
];

const textBlock = (index: number, ...parts: string[]): RawEvent[] => [
  blockStart(index, { type: "text", text: "" }),
  ...parts.map((text) => delta(index, { type: "text_delta", text })),
  blockStop(index),
];
const thinkingBlock = (index: number, signature: string): RawEvent[] => [
  blockStart(index, { type: "thinking", thinking: "", signature: "" }),
  delta(index, { type: "signature_delta", signature }),
  blockStop(index),
];
const toolUseBlock = (index: number, id: string, name: string, ...json: string[]): RawEvent[] => [
  blockStart(index, { type: "tool_use", id, name, input: {} }),
  ...json.map((partial_json) => delta(index, { type: "input_json_delta", partial_json })),
  blockStop(index),
];

const encoder = new TextEncoder();
const sse = (event: RawEvent) =>
  encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

type Captured = { body: Record<string, unknown>; headers: Headers; signal: AbortSignal | null };

/**
 * 偽の API。events を SSE で返す。hang が true なら、送り終えたあと中断されるまで待つ。
 */
function fakeApi(events: RawEvent[], { hang = false } = {}) {
  const calls: Captured[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const signal = init?.signal ?? null;
    calls.push({
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
      signal,
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(sse(event));
        if (!hang) {
          controller.close();
          return;
        }
        signal?.addEventListener("abort", () => controller.error(signal.reason));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const client = new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 });
  return { client, calls };
}

const ask = (messages: Message[], tools: ModelRequest["tools"] = []): ModelRequest => ({
  system: "共通の指示",
  messages,
  tools,
});
const question = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });

async function collect(
  events: RawEvent[],
  request: ModelRequest = ask([question("こんにちは")]),
): Promise<{ out: ModelStreamEvent[]; calls: Captured[] }> {
  const { client, calls } = fakeApi(events);
  const model = createModelClientWith(settings, () => client);
  const out: ModelStreamEvent[] = [];
  for await (const event of model.stream(request, new AbortController().signal)) out.push(event);
  return { out, calls };
}

const getDocument = {
  name: "fuminosuke__get_document",
  description: "書類を1件読む",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
};

// ---- 試験 ----

describe("要求の形", () => {
  it("設定のモデル・effort・最大の出力量と、切り替え（fallbacks）を付けて messages.stream で呼ぶ", async () => {
    const { calls } = await collect([
      messageStart(),
      ...textBlock(0, "はい"),
      ...messageEnd("end_turn"),
    ]);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: "共通の指示",
      messages: [{ role: "user", content: [{ type: "text", text: "こんにちは" }] }],
      fallbacks: "default",
      stream: true,
    });
    expect(call?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("道具は auto で選ばせ、入力を作りながら流す設定を付ける", async () => {
    const { calls } = await collect(
      [messageStart(), ...textBlock(0, "はい"), ...messageEnd("end_turn")],
      ask([question("書類を見せて")], [getDocument]),
    );
    expect(calls[0]?.body).toMatchObject({
      tools: [
        {
          name: "fuminosuke__get_document",
          description: "書類を1件読む",
          input_schema: getDocument.inputSchema,
          eager_input_streaming: true,
        },
      ],
      tool_choice: { type: "auto" },
    });
  });

  it("履歴（道具の結果・画像・そのまま返すブロック）を API の形に変える", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-1" };
    const history: Message[] = [
      question("書類1を見せて"),
      {
        role: "assistant",
        content: [
          { type: "passthrough", data: thinking },
          { type: "text", text: "読みます。" },
          { type: "tool_use", id: "toolu_1", name: "fuminosuke__get_document", input: { id: "1" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: "toolu_1",
            isError: false,
            content: [
              { type: "text", text: "毛色：黒" },
              { type: "image", mimeType: "image/png", data: "AAAA" },
              { type: "image", mimeType: "image/tiff", data: "BBBB" },
            ],
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "黒です" },
        ],
      },
      question("ありがとう"),
    ];
    const { calls } = await collect(
      [messageStart(), ...textBlock(0, "どういたしまして"), ...messageEnd("end_turn")],
      ask(history, [getDocument]),
    );
    expect(calls[0]?.body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "書類1を見せて" }] },
      {
        role: "assistant",
        content: [
          thinking,
          { type: "text", text: "読みます。" },
          { type: "tool_use", id: "toolu_1", name: "fuminosuke__get_document", input: { id: "1" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            is_error: false,
            content: [
              { type: "text", text: "毛色：黒" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
              { type: "text", text: "（image/tiff の画像は渡せないため省きました）" },
            ],
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "黒です" }] },
      { role: "user", content: [{ type: "text", text: "ありがとう" }] },
    ]);
  });

  it("途中で切り替わった応答は、切り替えより前の考えた過程を返さない", async () => {
    const history: Message[] = [
      question("質問"),
      {
        role: "assistant",
        content: [
          { type: "passthrough", data: { type: "thinking", thinking: "", signature: "before" } },
          { type: "text", text: "途中まで" },
          {
            type: "passthrough",
            data: {
              type: "fallback",
              from: { model: "claude-opus-5-5" },
              to: { model: "claude-opus-5" },
            },
          },
          { type: "passthrough", data: { type: "thinking", thinking: "", signature: "after" } },
          { type: "text", text: "続き" },
        ],
      },
      question("次の質問"),
    ];
    const { calls } = await collect(
      [messageStart(), ...textBlock(0, "はい"), ...messageEnd("end_turn")],
      ask(history),
    );
    const messages = calls[0]?.body.messages as {
      content: { type: string; signature?: string }[];
    }[];
    expect(messages[1]?.content.map((b) => b.signature ?? b.type)).toEqual([
      "text",
      "fallback",
      "after",
      "text",
    ]);
  });
});

describe("応答の変換", () => {
  it("道具なしの答え：考えた過程はそのまま包み、文章の断片を順に流して end_turn で終える", async () => {
    const { out } = await collect([
      messageStart(),
      ...thinkingBlock(0, "sig-abc"),
      ...textBlock(1, "黒", "です。"),
      ...messageEnd("end_turn"),
    ]);
    expect(out).toEqual([
      {
        type: "passthrough",
        block: {
          type: "passthrough",
          data: { type: "thinking", thinking: "", signature: "sig-abc" },
        },
      },
      { type: "text.delta", text: "黒" },
      { type: "text.delta", text: "です。" },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("道具の呼び出し：入力の断片をつないで読み、応答の順のまま流して tool_use で終える", async () => {
    const { out } = await collect([
      messageStart(),
      ...textBlock(0, "探します。"),
      ...toolUseBlock(1, "toolu_a", "fuminosuke__get_document", '{"id"', ': "10', '21"}'),
      ...thinkingBlock(2, "sig-between"),
      ...toolUseBlock(3, "toolu_b", "fuminosuke__list_templates"),
      ...messageEnd("tool_use"),
    ]);
    expect(out).toEqual([
      { type: "text.delta", text: "探します。" },
      {
        type: "tool_use",
        call: {
          type: "tool_use",
          id: "toolu_a",
          name: "fuminosuke__get_document",
          input: { id: "1021" },
        },
      },
      {
        type: "passthrough",
        block: {
          type: "passthrough",
          data: { type: "thinking", thinking: "", signature: "sig-between" },
        },
      },
      {
        type: "tool_use",
        call: { type: "tool_use", id: "toolu_b", name: "fuminosuke__list_templates", input: {} },
      },
      { type: "stop", reason: "tool_use" },
    ]);
  });

  it("出力の上限で切れたときは、途中の道具の呼び出しを流さず max_tokens で終える", async () => {
    const { out } = await collect([
      messageStart(),
      ...textBlock(0, "探し"),
      ...toolUseBlock(1, "toolu_a", "fuminosuke__get_document", '{"id": "10'),
      ...messageEnd("max_tokens"),
    ]);
    expect(out).toEqual([
      { type: "text.delta", text: "探し" },
      { type: "stop", reason: "max_tokens" },
    ]);
  });

  it("断られた（refusal）ときは、そのまま refusal で終える", async () => {
    const { out } = await collect([messageStart(), ...messageEnd("refusal")]);
    expect(out).toEqual([{ type: "stop", reason: "refusal" }]);
  });

  it("停止の文字列で止まったときは end_turn にそろえる", async () => {
    const { out } = await collect([
      messageStart(),
      ...textBlock(0, "はい"),
      ...messageEnd("stop_sequence"),
    ]);
    expect(out.at(-1)).toEqual({ type: "stop", reason: "end_turn" });
  });

  it("途中で別のモデルに切り替わったときは、切り替え前の道具の呼び出しを捨て、切り替えの印を包む", async () => {
    const fallback = {
      type: "fallback",
      from: { model: "claude-opus-5-5" },
      to: { model: "claude-opus-5" },
    };
    const { out } = await collect([
      messageStart(),
      ...textBlock(0, "途中"),
      ...toolUseBlock(1, "toolu_before", "fuminosuke__get_document", '{"id": "1"}'),
      blockStart(2, fallback),
      blockStop(2),
      ...textBlock(3, "続き"),
      ...toolUseBlock(4, "toolu_after", "fuminosuke__get_document", '{"id": "2"}'),
      ...messageEnd("tool_use"),
    ]);
    expect(out.map((e) => (e.type === "tool_use" ? e.call.id : e.type))).toEqual([
      "text.delta",
      "passthrough",
      "text.delta",
      "toolu_after",
      "stop",
    ]);
    expect(out[1]).toEqual({ type: "passthrough", block: { type: "passthrough", data: fallback } });
  });

  it("道具の入力が JSON として読めないまま tool_use で終わったときは、例外で知らせる", async () => {
    await expect(
      collect([
        messageStart(),
        ...toolUseBlock(0, "toolu_a", "fuminosuke__get_document", '{"id": "1'),
        ...messageEnd("tool_use"),
      ]),
    ).rejects.toThrow(ModelResponseError);
  });

  it("想定していない終わり方（pause_turn）は、例外で知らせる", async () => {
    await expect(
      collect([messageStart(), ...textBlock(0, "x"), ...messageEnd("pause_turn")]),
    ).rejects.toThrow(/想定していない終わり方です（pause_turn）/);
  });
});

describe("中断", () => {
  it("中断すると、要求が止まり、反復は例外で終わる", async () => {
    const { client, calls } = fakeApi([messageStart(), ...textBlock(0, "長い答え")].slice(0, 3), {
      hang: true,
    });
    const model = createModelClientWith(settings, () => client);
    const controller = new AbortController();
    const received: ModelStreamEvent[] = [];
    const run = (async () => {
      for await (const event of model.stream(ask([question("q")]), controller.signal)) {
        received.push(event);
        controller.abort();
      }
    })();
    await expect(run).rejects.toThrow();
    expect(received).toEqual([{ type: "text.delta", text: "長い答え" }]);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it("中断済みの signal では、API を呼ばない", async () => {
    const { client, calls } = fakeApi([]);
    const model = createModelClientWith(settings, () => client);
    const controller = new AbortController();
    controller.abort();
    const iterator = model.stream(ask([question("q")]), controller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("受け取る側が途中でやめたときも、要求を止める", async () => {
    const { client, calls } = fakeApi([messageStart(), ...textBlock(0, "a", "b")].slice(0, 3), {
      hang: true,
    });
    const model = createModelClientWith(settings, () => client);
    for await (const event of model.stream(ask([question("q")]), new AbortController().signal)) {
      expect(event).toEqual({ type: "text.delta", text: "a" });
      break;
    }
    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});

describe("API キー", () => {
  it("キーがないときは、呼ぶときにどこに書けばよいかが分かる文で失敗する", async () => {
    const model = createAnthropicModelClient({ ...settings, apiKey: null });
    const iterator = model
      .stream(ask([question("q")]), new AbortController().signal)
      [Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(ConfigError);
  });
});
