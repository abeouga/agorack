import { describe, expect, it, vi } from "vitest";
import type { ToolCallResult } from "../agent/ports.js";
import type { SourceConfig } from "../config/index.js";
import { SourceCatalog, type Logger } from "./catalog.js";
import type { Connector, RemoteTool, SourceConnection } from "./connection.js";

// ---- 偽の接続 ----

type Handler = (input: Record<string, unknown>, signal: AbortSignal) => Promise<ToolCallResult>;

class FakeConnection implements SourceConnection {
  readonly calls: { tool: string; input: Record<string, unknown> }[] = [];
  closed = false;
  private lostListeners: ((reason: string) => void)[] = [];

  constructor(
    readonly tools: RemoteTool[],
    private readonly handlers: Record<string, Handler> = {},
    readonly instructions: string | null = null,
  ) {}

  async call(tool: string, input: Record<string, unknown>, signal: AbortSignal) {
    this.calls.push({ tool, input });
    const handler = this.handlers[tool];
    return handler ? handler(input, signal) : ok(`${tool} の結果`);
  }

  async close() {
    this.closed = true;
  }

  onLost(listener: (reason: string) => void) {
    this.lostListeners.push(listener);
  }

  lose(reason: string) {
    for (const listener of this.lostListeners) listener(reason);
  }
}

const ok = (text: string): ToolCallResult => ({
  content: [{ type: "text", text }],
  structuredContent: null,
  isError: false,
});

const tool = (name: string, inputSchema: Record<string, unknown> = { type: "object" }) => ({
  name,
  description: `${name} の説明`,
  inputSchema,
});

const stdio = (id: string, overrides: Partial<SourceConfig> = {}): SourceConfig => ({
  id,
  name: `部品${id}`,
  description: `${id} の説明`,
  transport: { type: "stdio", command: `${id}.exe`, args: [], env: {} },
  enabled: true,
  ...overrides,
});

const quiet: Logger = { info: vi.fn(), warn: vi.fn() };
const signal = () => new AbortController().signal;

/** 部品の id ごとに、返す接続（又は投げる例外）を決めた Connector */
function connector(
  table: Record<string, () => SourceConnection>,
): Connector & { count: Map<string, number> } {
  const count = new Map<string, number>();
  const connect = (async (source: SourceConfig) => {
    count.set(source.id, (count.get(source.id) ?? 0) + 1);
    const make = table[source.id];
    if (!make) throw new Error(`起動できません（spawn ${source.id}.exe ENOENT）`);
    return make();
  }) as Connector & { count: Map<string, number> };
  connect.count = count;
  return connect;
}

async function started(sources: SourceConfig[], connect: Connector) {
  const catalog = new SourceCatalog(sources, connect, quiet);
  await catalog.start();
  return catalog;
}

// ---- 試験 ----

describe("部品の接続と道具の一覧", () => {
  it("道具の名前に部品の id の接頭辞を付け、部品の説明を名前付きで返す", async () => {
    const connection = new FakeConnection(
      [tool("get_document"), tool("aggregate")],
      {},
      "部品の使い方",
    );
    const catalog = await started(
      [stdio("fuminosuke")],
      connector({ fuminosuke: () => connection }),
    );

    const listing = await catalog.list(signal());

    expect(listing.tools).toEqual([
      {
        name: "fuminosuke__get_document",
        description: "get_document の説明",
        inputSchema: { type: "object" },
        sourceId: "fuminosuke",
        tool: "get_document",
      },
      {
        name: "fuminosuke__aggregate",
        description: "aggregate の説明",
        inputSchema: { type: "object" },
        sourceId: "fuminosuke",
        tool: "aggregate",
      },
    ]);
    expect(listing.sources).toEqual([
      {
        sourceId: "fuminosuke",
        name: "部品fuminosuke",
        status: "connected",
        instructions: "部品の使い方",
      },
    ]);
  });

  it("つなげない部品は理由とともに失敗として残し、残りの部品で動く", async () => {
    const catalog = await started(
      [stdio("good"), stdio("broken"), stdio("off", { enabled: false })],
      connector({ good: () => new FakeConnection([tool("find")]) }),
    );

    expect(catalog.status()).toEqual([
      {
        id: "good",
        name: "部品good",
        description: "good の説明",
        status: "connected",
        error: null,
        toolCount: 1,
      },
      {
        id: "broken",
        name: "部品broken",
        description: "broken の説明",
        status: "failed",
        error: "起動できません（spawn broken.exe ENOENT）",
        toolCount: 0,
      },
      {
        id: "off",
        name: "部品off",
        description: "off の説明",
        status: "disabled",
        error: null,
        toolCount: 0,
      },
    ]);
    const listing = await catalog.list(signal());
    expect(listing.tools.map((t) => t.name)).toEqual(["good__find"]);
    // つながらない部品は、道具は外し、理由つきで部品の一覧に残す。設定で止めた部品は入れない
    expect(listing.sources).toEqual([
      { sourceId: "good", name: "部品good", status: "connected", instructions: null },
      {
        sourceId: "broken",
        name: "部品broken",
        status: "unavailable",
        reason: "起動できません（spawn broken.exe ENOENT）",
      },
    ]);
    expect(await catalog.call("good__find", {}, signal())).toEqual(ok("find の結果"));
  });

  it("Claude に渡せない名前の道具と、名前が重なる道具は外す", async () => {
    const catalog = await started(
      [stdio("a"), stdio("a__b")],
      connector({
        a: () =>
          new FakeConnection([tool("ok"), tool("has.dot"), tool("b__c"), tool("x".repeat(70))]),
        a__b: () => new FakeConnection([tool("c")]),
      }),
    );

    const listing = await catalog.list(signal());

    expect(listing.tools.map((t) => t.name)).toEqual(["a__ok", "a__b__c"]);
    expect(listing.tools.map((t) => t.sourceId)).toEqual(["a", "a"]);
  });
});

describe("道具の呼び出し", () => {
  const schema = {
    type: "object",
    properties: { document: { type: "string" }, limit: { type: "number", maximum: 50 } },
    required: ["document"],
  };

  it("呼ばれた名前から部品と道具を引き戻し、入力をそのまま渡す", async () => {
    const connection = new FakeConnection([tool("get_document", schema)]);
    const catalog = await started([stdio("part")], connector({ part: () => connection }));

    await catalog.call("part__get_document", { document: "はじめ" }, signal());

    expect(connection.calls).toEqual([{ tool: "get_document", input: { document: "はじめ" } }]);
  });

  it.each([
    ["必須の項目がない", {}],
    ["型が違う", { document: 1 }],
    ["上限を超える", { document: "x", limit: 51 }],
  ])("スキーマに合わない入力（%s）は部品を呼ばずにエラーの結果にする", async (_, input) => {
    const connection = new FakeConnection([tool("get_document", schema)]);
    const catalog = await started([stdio("part")], connector({ part: () => connection }));

    const result = await catalog.call("part__get_document", input, signal());

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(result.content)).toContain("形に合わない");
    expect(connection.calls).toEqual([]);
  });

  it("読めないスキーマの道具は、検証せずに呼ぶ", async () => {
    const connection = new FakeConnection([tool("odd", { type: "object", $ref: "#/nowhere" })]);
    const catalog = await started([stdio("part")], connector({ part: () => connection }));

    const result = await catalog.call("part__odd", { any: 1 }, signal());

    expect(result.isError).toBe(false);
    expect(connection.calls).toHaveLength(1);
  });

  it("一覧にない道具は、例外ではなくエラーの結果にする", async () => {
    const catalog = await started(
      [stdio("part")],
      connector({ part: () => new FakeConnection([]) }),
    );

    const result = await catalog.call("part__missing", {}, signal());

    expect(result).toMatchObject({ isError: true, structuredContent: null });
  });

  it("接続の失敗（例外）は、エラーの結果にする", async () => {
    const connection = new FakeConnection([tool("boom")], {
      boom: async () => {
        throw new Error("通信の失敗");
      },
    });
    const catalog = await started([stdio("part")], connector({ part: () => connection }));

    const result = await catalog.call("part__boom", {}, signal());

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("通信の失敗");
  });

  it("中断されたときだけ、例外で終える", async () => {
    const controller = new AbortController();
    const connection = new FakeConnection([tool("slow")], {
      slow: async (_, s) => {
        controller.abort();
        s.throwIfAborted();
        return ok("返らない");
      },
    });
    const catalog = await started([stdio("part")], connector({ part: () => connection }));

    await expect(catalog.call("part__slow", {}, controller.signal)).rejects.toThrow();
  });
});

describe("接続が切れたとき", () => {
  it("失敗として残し、呼び出しはエラーにし、次のターンの前（list）につなぎ直す", async () => {
    const first = new FakeConnection([tool("find")]);
    const second = new FakeConnection([tool("find")]);
    const made = [first, second];
    const connect = connector({ part: () => made.shift() ?? new FakeConnection([]) });
    const catalog = await started([stdio("part")], connect);

    first.lose("部品が終了しました");

    expect(catalog.status()[0]).toMatchObject({
      status: "failed",
      error: "接続が切れました：部品が終了しました",
    });
    expect((await catalog.call("part__find", {}, signal())).isError).toBe(true);

    const listing = await catalog.list(signal());

    expect(connect.count.get("part")).toBe(2);
    expect(listing.tools.map((t) => t.name)).toEqual(["part__find"]);
    expect(catalog.status()[0]).toMatchObject({ status: "connected" });
    await catalog.call("part__find", {}, signal());
    expect(second.calls).toHaveLength(1);
  });

  it("つなぎ直せなければ、次のターンでもまた試す", async () => {
    let attempts = 0;
    const first = new FakeConnection([tool("find")]);
    const connect: Connector = async () => {
      attempts += 1;
      if (attempts === 1) return first;
      throw new Error("まだ起動できない");
    };
    const catalog = await started([stdio("part")], connect);
    first.lose("終了");

    await catalog.list(signal());
    await catalog.list(signal());

    expect(attempts).toBe(3);
    expect(catalog.status()[0]).toMatchObject({ status: "failed", error: "まだ起動できない" });
  });

  it("起動時につなげなかった部品は、ターンごとにはつなぎ直さない", async () => {
    const connect = connector({});
    const catalog = await started([stdio("broken")], connect);

    await catalog.list(signal());

    expect(connect.count.get("broken")).toBe(1);
  });

  it("つなぎ直したあとは、古い接続の知らせを無視する", async () => {
    const first = new FakeConnection([tool("find")]);
    const second = new FakeConnection([tool("find")]);
    const made = [first, second];
    const catalog = await started(
      [stdio("part")],
      connector({ part: () => made.shift() ?? new FakeConnection([]) }),
    );
    first.lose("終了");
    await catalog.list(signal());

    first.lose("もう一度");

    expect(catalog.status()[0]).toMatchObject({ status: "connected" });
  });
});

describe("終了", () => {
  it("つながっている全部の接続を閉じる", async () => {
    const a = new FakeConnection([]);
    const b = new FakeConnection([]);
    const catalog = await started(
      [stdio("a"), stdio("b"), stdio("broken")],
      connector({ a: () => a, b: () => b }),
    );

    await catalog.close();

    expect([a.closed, b.closed]).toEqual([true, true]);
  });
});
