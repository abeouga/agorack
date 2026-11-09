// 試験で使う、偽の ModelClient と ToolCatalog
import type {
  CatalogTool,
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
  StopReason,
  ToolCallResult,
  ToolCatalog,
  ToolListing,
} from "../agent/ports.js";

/** 1回の応答。中断の signal を受け取り、イベントを流す */
export type FakeResponse = (
  request: ModelRequest,
  signal: AbortSignal,
) => AsyncIterable<ModelStreamEvent>;

/** 決めた順に応答を返す偽のモデル。受け取った要求を記録する */
export class FakeModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly responses: FakeResponse[]) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    this.requests.push(structuredClone(request));
    const response = this.responses[this.requests.length - 1];
    if (!response) throw new Error(`応答が用意されていない（${this.requests.length}回目）`);
    yield* response(request, signal);
  }
}

/** 決めたイベントを順に流す応答 */
export const respond = (...events: ModelStreamEvent[]): FakeResponse =>
  async function* (_request, signal) {
    for (const event of events) {
      await Promise.resolve();
      signal.throwIfAborted();
      yield event;
    }
  };

/** 文章を流したあと、中断されるまで待つ応答（進行中のターンを作るのに使う） */
export const respondUntilAborted = (text: string, started?: () => void): FakeResponse =>
  async function* (_request, signal) {
    yield { type: "text.delta", text };
    started?.();
    await new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };

export const textDelta = (text: string): ModelStreamEvent => ({ type: "text.delta", text });
export const toolUse = (
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ModelStreamEvent => ({ type: "tool_use", call: { type: "tool_use", id, name, input } });
export const stop = (reason: StopReason): ModelStreamEvent => ({ type: "stop", reason });

/** 道具ごとに決めた結果を返す偽の道具の一覧 */
export class FakeCatalog implements ToolCatalog {
  readonly calls: { name: string; input: Record<string, unknown> }[] = [];
  constructor(private readonly results: Record<string, ToolCallResult> = {}) {}

  async list(): Promise<ToolListing> {
    const tools: CatalogTool[] = Object.keys(this.results).map((name) => {
      const [sourceId = "", tool = ""] = name.split("__");
      return { name, sourceId, tool, description: tool, inputSchema: { type: "object" } };
    });
    return { tools, sources: [] };
  }

  async call(name: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    this.calls.push({ name, input });
    const result = this.results[name];
    if (!result) throw new Error(`道具がない：${name}`);
    return result;
  }
}

/** 文書の根拠を1つ持つ、道具の成功の結果 */
export const documentResult = (recordId: string, value: unknown): ToolCallResult => ({
  content: [{ type: "text", text: `書類 ${recordId}` }],
  structuredContent: {
    evidence: [
      {
        kind: "document",
        source_id: recordId,
        label: `書類 ${recordId}`,
        location: { page: 1 },
        value,
      },
    ],
  },
  isError: false,
});
