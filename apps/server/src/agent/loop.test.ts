import type { TurnEvent } from "@agorack/contracts";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./instructions.js";
import { runTurn, type TurnOptions } from "./loop.js";
import type {
  CatalogTool,
  Message,
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
  SourceInstructions,
  StopReason,
  ToolCallResult,
  ToolCatalog,
  ToolResultBlock,
} from "./ports.js";

// ---- 偽のポート ----

type Script = (request: ModelRequest) => ModelStreamEvent[];

/** 決めた順に応答を返す偽のモデル。受け取った要求を記録する */
class FakeModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly scripts: Script[]) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    this.requests.push(structuredClone(request));
    const script = this.scripts[this.requests.length - 1];
    if (!script) throw new Error(`応答が用意されていない（${this.requests.length}回目）`);
    for (const event of script(request)) {
      await Promise.resolve();
      if (signal.aborted) throw new Error("中断された");
      yield event;
    }
  }
}

type Handler = (input: Record<string, unknown>, signal: AbortSignal) => Promise<ToolCallResult>;

/** 道具ごとに決めた処理で答える偽の道具の一覧。呼ばれた順を記録する */
class FakeCatalog implements ToolCatalog {
  readonly calls: { name: string; input: Record<string, unknown> }[] = [];
  constructor(
    private readonly handlers: Record<string, Handler>,
    private readonly sources: SourceInstructions[] = [],
  ) {}

  async list(): Promise<{ tools: CatalogTool[]; sources: SourceInstructions[] }> {
    const tools = Object.keys(this.handlers).map((name) => {
      const [sourceId = "", tool = ""] = name.split("__");
      return {
        name,
        sourceId,
        tool,
        description: `${tool} の説明`,
        inputSchema: { type: "object" },
      };
    });
    return { tools, sources: this.sources };
  }

  async call(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolCallResult> {
    this.calls.push({ name, input });
    const handler = this.handlers[name];
    if (!handler) throw new Error(`道具がない：${name}`);
    return handler(input, signal);
  }
}

// ---- 応答と結果の部品 ----

const text = (value: string): ModelStreamEvent => ({ type: "text.delta", text: value });
const toolUse = (
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ModelStreamEvent => ({
  type: "tool_use",
  call: { type: "tool_use", id, name, input },
});
const stop = (reason: StopReason): ModelStreamEvent => ({ type: "stop", reason });

const envelope = (recordId: string) => ({
  kind: "document",
  source_id: recordId,
  label: `記録 ${recordId}`,
  location: { at: 1 },
  value: "値",
});

const ok = (summary: string, structuredContent: unknown = null): ToolCallResult => ({
  content: [{ type: "text", text: summary }],
  structuredContent,
  isError: false,
});

/** 外から解決できる約束（並行して呼ばれたかを確かめるのに使う） */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const OPTIONS: TurnOptions = { maxToolCalls: 10, instructions: "共通の指示" };

async function run(
  model: ModelClient,
  catalog: ToolCatalog,
  {
    options = OPTIONS,
    history = [],
    controller = new AbortController(),
    onEvent,
  }: {
    options?: TurnOptions;
    history?: Message[];
    controller?: AbortController;
    onEvent?: (event: TurnEvent, controller: AbortController) => void;
  } = {},
) {
  const events: TurnEvent[] = [];
  const result = await runTurn(
    { model, catalog },
    options,
    { history, question: "質問", signal: controller.signal },
    (event) => {
      events.push(event);
      onEvent?.(event, controller);
    },
  );
  return { result, events };
}

const lastUserResults = (request: ModelRequest | undefined): ToolResultBlock[] => {
  const last = request?.messages.at(-1);
  if (last?.role !== "user") throw new Error("最後が user のメッセージでない");
  return last.content.filter((block) => block.type === "tool_result");
};

// ---- 試験 ----

describe("道具を使うループ", () => {
  it("道具を呼ばずに答え終わる", async () => {
    const model = new FakeModel([() => [text("こん"), text("にちは"), stop("end_turn")]]);
    const { result, events } = await run(model, new FakeCatalog({}));

    expect(events).toEqual([
      { type: "text.delta", text: "こん" },
      { type: "text.delta", text: "にちは" },
      { type: "turn.completed", text: "こんにちは", evidence: [], reason: "end_turn" },
    ]);
    expect(result.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "質問" }] },
      { role: "assistant", content: [{ type: "text", text: "こんにちは" }] },
    ]);
  });

  it("道具を2つ同時に呼ぶ応答で、並行して呼び、結果を1つのメッセージにまとめて返す", async () => {
    const first = deferred<ToolCallResult>();
    const second = deferred<ToolCallResult>();
    let started = 0;
    const catalog = new FakeCatalog({
      part_a__find: () => {
        started += 1;
        return first.promise;
      },
      part_b__read: () => {
        started += 1;
        // 1つ目が返る前に2つ目が呼ばれている（並行）。2つ目を先に返し、1つ目はあとで返す
        expect(started).toBe(2);
        second.resolve(ok("B を読みました", { items: [envelope("b-1"), envelope("shared")] }));
        setTimeout(() => first.resolve(ok("A を見つけました", { items: [envelope("shared")] })), 0);
        return second.promise;
      },
    });
    const model = new FakeModel([
      () => [
        text("調べます。"),
        toolUse("call-1", "part_a__find", { q: "x" }),
        toolUse("call-2", "part_b__read"),
        stop("tool_use"),
      ],
      () => [text("答えです。"), stop("end_turn")],
    ]);

    const { result, events } = await run(model, catalog);

    expect(started).toBe(2);
    expect(model.requests).toHaveLength(2);
    // 2回目の要求の最後は、結果を2つ持つ1つの user メッセージ（呼び出しの順）
    const results = lastUserResults(model.requests[1]);
    expect(results.map((r) => [r.toolUseId, r.isError])).toEqual([
      ["call-1", false],
      ["call-2", false],
    ]);
    expect(model.requests[1]?.messages).toHaveLength(3);

    expect(events.filter((e) => e.type === "tool.called")).toEqual([
      {
        type: "tool.called",
        callId: "call-1",
        sourceId: "part_a",
        tool: "find",
        input: { q: "x" },
      },
      { type: "tool.called", callId: "call-2", sourceId: "part_b", tool: "read", input: {} },
    ]);
    const completed = events.filter((e) => e.type === "tool.completed");
    expect(completed.map((e) => [e.callId, e.ok, e.summary, e.evidence.length])).toEqual([
      ["call-2", true, "B を読みました", 2],
      ["call-1", true, "A を見つけました", 1],
    ]);

    // ターンの根拠は、部品ごとに同じものを1つにまとめる
    expect(result.outcome).toMatchObject({
      type: "turn.completed",
      text: "調べます。答えです。",
      reason: "end_turn",
    });
    expect(
      result.outcome.type === "turn.completed" &&
        result.outcome.evidence.map((e) => [e.sourceId, e.recordId]),
    ).toEqual([
      ["part_a", "shared"],
      ["part_b", "b-1"],
      ["part_b", "shared"],
    ]);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("失敗した道具は is_error の結果として返し、ループを続ける", async () => {
    const catalog = new FakeCatalog({
      part__throws: async () => {
        throw new Error("接続が切れた");
      },
      part__fails: async () => ({
        content: [{ type: "text", text: "入力が合いません" }],
        structuredContent: { items: [envelope("ignored")] },
        isError: true,
      }),
    });
    const model = new FakeModel([
      () => [
        toolUse("call-1", "part__throws"),
        toolUse("call-2", "part__fails"),
        toolUse("call-3", "part__missing"),
        stop("tool_use"),
      ],
      () => [text("道具が失敗しました。"), stop("end_turn")],
    ]);

    const { result, events } = await run(model, catalog);

    const results = lastUserResults(model.requests[1]);
    expect(results.map((r) => [r.toolUseId, r.isError, r.content])).toEqual([
      ["call-1", true, [{ type: "text", text: "道具の呼び出しに失敗しました：接続が切れた" }]],
      ["call-2", true, [{ type: "text", text: "入力が合いません" }]],
      ["call-3", true, [{ type: "text", text: "道具「part__missing」はありません。" }]],
    ]);
    // 一覧にない道具は呼ばない
    expect(catalog.calls.map((c) => c.name)).toEqual(["part__throws", "part__fails"]);
    expect(events.filter((e) => e.type === "tool.called").map((e) => e.callId)).toEqual([
      "call-1",
      "call-2",
    ]);
    // 失敗した結果からは根拠を取り出さない
    expect(
      events.filter((e) => e.type === "tool.completed").map((e) => [e.ok, e.evidence]),
    ).toEqual([
      [false, []],
      [false, []],
    ]);
    expect(result.outcome).toMatchObject({ type: "turn.completed", reason: "end_turn" });
  });

  it("道具の呼び出しの回数の上限で止め、利用者に知らせる", async () => {
    const catalog = new FakeCatalog({ part__step: async () => ok("1歩進みました") });
    const again = () => [text("続けます。"), toolUse("call", "part__step"), stop("tool_use")];
    const model = new FakeModel([again, again, again, again]);

    const { result, events } = await run(model, catalog, {
      options: { ...OPTIONS, maxToolCalls: 2 },
    });

    expect(catalog.calls).toHaveLength(2);
    expect(model.requests).toHaveLength(3);
    expect(result.outcome).toMatchObject({ type: "turn.completed", reason: "tool_limit" });
    const notice = events.filter((e) => e.type === "text.delta").at(-1);
    expect(notice?.type === "text.delta" && notice.text).toContain("上限（2回）");
    // 結果を返していない道具の呼び出しは、履歴に残さない
    const last = result.messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content.some((block) => block.type === "tool_use")).toBe(false);
  });

  it("1回の応答の呼び出しで上限を超えるときは、1つも呼ばずに止める", async () => {
    const catalog = new FakeCatalog({ part__step: async () => ok("呼ばれた") });
    const model = new FakeModel([
      () => [toolUse("call-1", "part__step"), toolUse("call-2", "part__step"), stop("tool_use")],
    ]);

    const { result } = await run(model, catalog, { options: { ...OPTIONS, maxToolCalls: 1 } });

    expect(catalog.calls).toHaveLength(0);
    expect(result.outcome).toMatchObject({ type: "turn.completed", reason: "tool_limit" });
  });

  it("停止すると、その後の道具の呼び出しも Claude への要求も行わない", async () => {
    const catalog = new FakeCatalog({ part__step: async () => ok("呼ばれた") });
    const model = new FakeModel([
      () => [text("調べます。"), toolUse("call-1", "part__step"), stop("tool_use")],
      () => [text("呼ばれてはいけない"), stop("end_turn")],
    ]);

    const { result, events } = await run(model, catalog, {
      onEvent: (event, controller) => {
        if (event.type === "text.delta") controller.abort();
      },
    });

    expect(catalog.calls).toHaveLength(0);
    expect(model.requests).toHaveLength(1);
    expect(result.outcome).toEqual({
      type: "turn.failed",
      code: "stopped",
      message: "止めました。",
    });
    expect(result.messages).toEqual([]);
    expect(events.at(-1)).toEqual(result.outcome);
  });

  it("道具の呼び出しの途中で停止すると、道具に中断を伝え、Claude へ次の要求をしない", async () => {
    let sawAbort = false;
    const controller = new AbortController();
    const catalog = new FakeCatalog({
      part__slow: (_, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(new Error("中断された"));
          });
          controller.abort();
        }),
      part__fast: async () => ok("すぐ返った"),
    });
    const model = new FakeModel([
      () => [toolUse("call-1", "part__slow"), toolUse("call-2", "part__fast"), stop("tool_use")],
      () => [text("呼ばれてはいけない"), stop("end_turn")],
    ]);

    const { result } = await run(model, catalog, { controller });

    expect(sawAbort).toBe(true);
    expect(model.requests).toHaveLength(1);
    expect(result.outcome).toMatchObject({ type: "turn.failed", code: "stopped" });
  });

  it("始める前に停止されていれば、何も呼ばない", async () => {
    const controller = new AbortController();
    controller.abort();
    const catalog = new FakeCatalog({ part__step: async () => ok("呼ばれた") });
    const model = new FakeModel([() => [stop("end_turn")]]);

    const { result } = await run(model, catalog, { controller });

    expect(model.requests).toHaveLength(0);
    expect(catalog.calls).toHaveLength(0);
    expect(result.outcome).toMatchObject({ type: "turn.failed", code: "stopped" });
  });

  it.each([
    ["refusal", "答えられませんでした"],
    ["max_tokens", "途中で切れました"],
  ] as const)("%s のときは道具を呼ばずに終え、その旨を知らせる", async (reason, notice) => {
    const catalog = new FakeCatalog({ part__step: async () => ok("呼ばれた") });
    const model = new FakeModel([
      () => [text("途中まで"), toolUse("call-1", "part__step"), stop(reason)],
    ]);

    const { result } = await run(model, catalog);

    expect(catalog.calls).toHaveLength(0);
    expect(model.requests).toHaveLength(1);
    expect(result.outcome).toMatchObject({ type: "turn.completed", reason });
    expect(result.outcome.type === "turn.completed" && result.outcome.text).toContain(notice);
    expect(result.messages.at(-1)?.content.some((block) => block.type === "tool_use")).toBe(false);
  });

  it("Claude の呼び出しの失敗は model_error として知らせ、履歴に残さない", async () => {
    const failing: ModelClient = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("503");
      },
    };
    const { result } = await run(failing, new FakeCatalog({}));

    expect(result.outcome).toMatchObject({ type: "turn.failed", code: "model_error" });
    expect(result.messages).toEqual([]);
    expect(result.error).toBeInstanceOf(Error);
  });

  it("応答が終わりの知らせなしに切れたら model_error にする", async () => {
    const model = new FakeModel([() => [text("途中")]]);
    const { result } = await run(model, new FakeCatalog({}));

    expect(result.outcome).toMatchObject({ type: "turn.failed", code: "model_error" });
  });

  it("履歴・指示・道具の定義をモデルに渡し、受け渡し用のブロックは順のまま履歴に残す", async () => {
    const history: Message[] = [
      { role: "user", content: [{ type: "text", text: "前の質問" }] },
      { role: "assistant", content: [{ type: "text", text: "前の答え" }] },
    ];
    const catalog = new FakeCatalog({ part__step: async () => ok("結果") }, [
      { sourceId: "part", name: "部品", instructions: "部品の使い方" },
    ]);
    const model = new FakeModel([
      () => [
        { type: "passthrough", block: { type: "passthrough", data: { sig: "x" } } },
        toolUse("call-1", "part__step"),
        stop("tool_use"),
      ],
      () => [text("答え"), stop("end_turn")],
    ]);

    const { result } = await run(model, catalog, { history });

    const request = model.requests[0];
    expect(request?.system).toBe("共通の指示\n\n## 部品「部品」（part）の説明\n\n部品の使い方");
    expect(request?.tools).toEqual([
      { name: "part__step", description: "step の説明", inputSchema: { type: "object" } },
    ]);
    expect(request?.messages).toEqual([
      ...history,
      { role: "user", content: [{ type: "text", text: "質問" }] },
    ]);
    expect(model.requests[1]?.messages[3]).toEqual({
      role: "assistant",
      content: [
        { type: "passthrough", data: { sig: "x" } },
        { type: "tool_use", id: "call-1", name: "part__step", input: {} },
      ],
    });
    expect(result.messages).toHaveLength(4);
  });
});

describe("指示", () => {
  it("共通の指示に、説明のある部品だけを名前付きで足す", () => {
    expect(
      buildSystemPrompt(" 共通 ", [
        { sourceId: "a", name: "部品A", instructions: " A の使い方 " },
        { sourceId: "b", name: "部品B", instructions: null },
        { sourceId: "c", name: "部品C", instructions: "  " },
      ]),
    ).toBe("共通\n\n## 部品「部品A」（a）の説明\n\nA の使い方");
  });
});
