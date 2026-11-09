import type { SourceInfo } from "@agorack/contracts";
import type { CatalogTool, ToolCallResult, ToolCatalog, ToolListing } from "../agent/ports.js";
import type { SourceConfig } from "../config/index.js";
import { restrictEmbedUrls } from "../evidence/index.js";
import type { Connector, SourceConnection } from "./connection.js";
import { compileInputValidator, type InputValidator } from "./mcp/inputValidation.js";
import { errorResult } from "./mcp/results.js";

/** Claude に渡す道具の名前の形（Messages API の決まり） */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** 接頭辞と道具の名前のつなぎ（設計 §6.2） */
const SEPARATOR = "__";

export type Logger = Pick<Console, "info" | "warn">;

type PreparedTool = { definition: CatalogTool; validate: InputValidator | null };

type SourceState =
  | { kind: "disabled" }
  | { kind: "connecting" }
  | {
      kind: "connected";
      connection: SourceConnection;
      tools: PreparedTool[];
    }
  | {
      kind: "failed";
      error: string;
      /** 一度つながってから切れた（次のターンの前につなぎ直す） */
      lost: boolean;
    };

/**
 * 設定に書いた部品につなぎ、部品の道具を Agorack のループから呼べるようにする（設計 §6）。
 *
 * - 起動時（start）に全部の部品へつなぐ。つなげない部品は理由とともに失敗として残し、残りで動く。
 * - Claude に渡す道具の名前は `<部品のid>__<道具の名前>`。呼ばれた名前から部品と道具を引き戻す。
 * - 道具の入力は、部品が公開するスキーマで検証してから呼ぶ。合わなければ呼ばずにエラーの結果を返す。
 * - 呼び出しの途中で接続が切れたら、その結果をエラーにし、次のターンの前（list）につなぎ直す。
 */
export class SourceCatalog implements ToolCatalog {
  private readonly states = new Map<string, SourceState>();
  private readonly reconnecting = new Map<string, Promise<void>>();
  private closed = false;

  constructor(
    private readonly sources: readonly SourceConfig[],
    private readonly connect: Connector,
    private readonly logger: Logger = console,
  ) {
    for (const source of sources) {
      this.states.set(source.id, source.enabled ? { kind: "connecting" } : { kind: "disabled" });
    }
  }

  /** 設定で止めていない部品の全部へ、並行してつなぐ */
  async start(): Promise<void> {
    await Promise.all(
      this.sources.filter((source) => source.enabled).map((source) => this.connectSource(source)),
    );
  }

  /** 部品の一覧と状態（GET /api/sources） */
  status(): SourceInfo[] {
    return this.sources.map((source) => {
      const state = this.stateOf(source.id);
      const base = {
        id: source.id,
        name: source.name,
        description: source.description,
        embedOrigin: source.embed?.origin ?? null,
      };
      switch (state.kind) {
        case "connected":
          return { ...base, status: "connected", error: null, toolCount: state.tools.length };
        case "failed":
          return { ...base, status: "failed", error: state.error, toolCount: 0 };
        case "connecting":
          return { ...base, status: "failed", error: "つないでいるところです", toolCount: 0 };
        case "disabled":
          return { ...base, status: "disabled", error: null, toolCount: 0 };
      }
    });
  }

  async list(signal: AbortSignal): Promise<ToolListing> {
    await this.reconnectLost();
    signal.throwIfAborted();
    const tools: CatalogTool[] = [];
    const sources = [];
    for (const source of this.sources) {
      const state = this.stateOf(source.id);
      if (state.kind !== "connected") continue;
      tools.push(...state.tools.map((tool) => tool.definition));
      sources.push({
        sourceId: source.id,
        name: source.name,
        instructions: state.connection.instructions,
      });
    }
    return { tools, sources };
  }

  async call(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolCallResult> {
    const found = this.findTool(name);
    if (!found) {
      return errorResult(`道具「${name}」はありません。部品がつながっていない可能性があります。`);
    }
    const { source, tool } = found;
    const state = this.stateOf(source.id);
    if (state.kind !== "connected") {
      return errorResult(`部品「${source.name}」につながっていません。`);
    }

    const problem = tool.validate?.(input) ?? null;
    if (problem !== null) {
      return errorResult(`入力が道具「${name}」の形に合わないため、呼びませんでした：${problem}`);
    }

    try {
      const result = await state.connection.call(tool.definition.tool, input, signal);
      // 埋め込み用の画面の住所は、部品の設定で許した住所（embed.origin）のものだけを残す（設計 §7.4）
      const embedOrigin = source.embed?.origin ?? null;
      return {
        ...result,
        structuredContent: restrictEmbedUrls(result.structuredContent, embedOrigin),
      };
    } catch (error) {
      if (signal.aborted) throw error;
      return errorResult(`部品の道具を呼べませんでした：${describe(error)}`);
    }
  }

  /** 全部の接続を閉じる（手元で起動した部品の子のプロセスを止める） */
  async close(): Promise<void> {
    this.closed = true;
    const connections = [...this.states.values()].flatMap((state) =>
      state.kind === "connected" ? [state.connection] : [],
    );
    await Promise.allSettled(connections.map((connection) => connection.close()));
  }

  private stateOf(id: string): SourceState {
    return this.states.get(id) ?? { kind: "disabled" };
  }

  private findTool(name: string): { source: SourceConfig; tool: PreparedTool } | null {
    for (const source of this.sources) {
      const state = this.stateOf(source.id);
      if (state.kind !== "connected") continue;
      const tool = state.tools.find((candidate) => candidate.definition.name === name);
      if (tool) return { source, tool };
    }
    return null;
  }

  /** @param retryLater つなげなかったとき、次のターンの前にもう一度試すか（切れた部品のつなぎ直し） */
  private async connectSource(source: SourceConfig, retryLater = false): Promise<void> {
    this.states.set(source.id, { kind: "connecting" });
    let connection: SourceConnection;
    try {
      connection = await this.connect(source);
    } catch (error) {
      const reason = describe(error);
      this.states.set(source.id, { kind: "failed", error: reason, lost: retryLater });
      this.logger.warn(`部品「${source.name}」（${source.id}）につなげませんでした：${reason}`);
      return;
    }
    if (this.closed) {
      await connection.close().catch(() => undefined);
      return;
    }

    const tools = this.prepareTools(source, connection);
    const state: SourceState = { kind: "connected", connection, tools };
    this.states.set(source.id, state);
    connection.onLost((reason) => {
      // つなぎ直したあとの古い接続の知らせは無視する
      if (this.states.get(source.id) !== state) return;
      this.states.set(source.id, {
        kind: "failed",
        error: `接続が切れました：${reason}`,
        lost: true,
      });
      this.logger.warn(`部品「${source.name}」（${source.id}）との接続が切れました：${reason}`);
    });
    this.logger.info(
      `部品「${source.name}」（${source.id}）につなぎました（道具 ${tools.length} 個）`,
    );
  }

  /** 部品の道具に接頭辞を付け、Claude に渡せない名前・重なる名前は外し、入力の検証を用意する */
  private prepareTools(source: SourceConfig, connection: SourceConnection): PreparedTool[] {
    const prepared: PreparedTool[] = [];
    for (const tool of connection.tools) {
      const name = `${source.id}${SEPARATOR}${tool.name}`;
      if (!TOOL_NAME_PATTERN.test(name)) {
        this.logger.warn(
          `部品「${source.name}」の道具「${tool.name}」は、名前が Claude に渡せない形（英数字・_・- で64文字まで）なので使いません`,
        );
        continue;
      }
      if (this.findTool(name) || prepared.some((p) => p.definition.name === name)) {
        this.logger.warn(
          `道具の名前「${name}」がほかの道具と重なるので、部品「${source.name}」の側は使いません`,
        );
        continue;
      }
      let validate: InputValidator | null = null;
      try {
        validate = compileInputValidator(tool.inputSchema);
      } catch (error) {
        this.logger.warn(
          `部品「${source.name}」の道具「${tool.name}」の入力のスキーマを読めないので、検証せずに呼びます：${describe(error)}`,
        );
      }
      prepared.push({
        definition: {
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          sourceId: source.id,
          tool: tool.name,
        },
        validate,
      });
    }
    return prepared;
  }

  /** 切れた部品をつなぎ直す。同時に呼ばれても、部品ごとに1回だけ */
  private async reconnectLost(): Promise<void> {
    const lost = this.sources.filter((source) => {
      const state = this.stateOf(source.id);
      return state.kind === "failed" && state.lost;
    });
    await Promise.all(
      lost.map((source) => {
        let pending = this.reconnecting.get(source.id);
        if (!pending) {
          this.logger.info(`部品「${source.name}」（${source.id}）につなぎ直します`);
          pending = this.connectSource(source, true).finally(() =>
            this.reconnecting.delete(source.id),
          );
          this.reconnecting.set(source.id, pending);
        }
        return pending;
      }),
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
