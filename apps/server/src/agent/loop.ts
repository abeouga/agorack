import type { Evidence, TurnEndReason, TurnEvent, TurnEventOf } from "@agorack/contracts";
import { extractEvidence, mergeEvidence } from "../evidence/index.js";
import { AGORACK_INSTRUCTIONS, buildSystemPrompt } from "./instructions.js";
import type {
  AssistantBlock,
  AssistantMessage,
  CatalogTool,
  Message,
  ModelClient,
  ModelStreamEvent,
  ModelToolDefinition,
  StopReason,
  ToolCallResult,
  ToolCatalog,
  ToolResultBlock,
  ToolUseBlock,
} from "./ports.js";

/** ループが使うポート */
export type AgentPorts = {
  model: ModelClient;
  catalog: ToolCatalog;
};

/** ループの設定。値は呼び出し側（設定の読み込み）が決める */
export type TurnOptions = {
  /** 1ターンあたりの道具の呼び出しの回数の上限（1以上） */
  maxToolCalls: number;
  /** 共通の指示。省略すると AGORACK_INSTRUCTIONS */
  instructions?: string;
};

export type TurnInput = {
  /** これまでの会話（前のターンの TurnResult.messages をつないだもの） */
  history: readonly Message[];
  question: string;
  /** 停止・画面との接続の切断で中断する */
  signal: AbortSignal;
};

export type TurnResult = {
  /**
   * 履歴に足すメッセージ（質問・応答・道具の結果）。答えを出せなかったターン（turn.failed）は空。
   * 最後は必ず assistant のメッセージで、結果の返っていない道具の呼び出しは含まない。
   */
  messages: Message[];
  /** 最後に知らせたイベント */
  outcome: TurnEventOf<"turn.completed"> | TurnEventOf<"turn.failed">;
  /** 失敗の原因（記録用）。turn.failed のときだけ */
  error?: unknown;
};

/** 進み具合を受け取る。text.delta・tool.called・tool.completed と、最後に turn.completed か turn.failed */
export type TurnEventListener = (event: TurnEvent) => void;

/** 答えの終わりに足す、利用者への知らせ */
const NOTICES = {
  tool_limit: (max: number) =>
    `（道具の呼び出しが1回の質問あたりの上限（${max}回）に達したので、ここで止めました。質問を分けて、もう一度お試しください。）`,
  max_tokens: () =>
    "（答えが長くなりすぎたので、途中で切れました。質問を絞って、もう一度お試しください。）",
  refusal: () => "（この質問には答えられませんでした。）",
  empty: () => "（答えがありませんでした。）",
} as const;

const FAILURE_MESSAGES = {
  stopped: "止めました。",
  model_error: "Claude の呼び出しに失敗しました。時間をおいて、もう一度お試しください。",
  internal_error: "サーバーの中で想定外の失敗がありました。",
} as const;

/** tool.completed の要約の長さの上限（文字数） */
const SUMMARY_MAX_LENGTH = 80;

class StoppedError extends Error {
  constructor() {
    super("ターンを止めた");
    this.name = "StoppedError";
  }
}

/**
 * 1ターン（1つの質問）を、道具を使いながら答え終わるまで進める（設計 §5）。
 *
 * - 応答が tool_use の間は道具を呼んで結果を返し、繰り返す。end_turn で終える。
 * - 1回の応答の道具の呼び出しは並行して呼び、結果は1つの user メッセージにまとめて返す。
 * - 失敗した道具は落とさず、isError の結果として返す。
 * - 道具の呼び出しの回数が上限を超えるときは、呼ばずに止めて知らせる。
 * - 中断されたら、その後は Claude にも道具にも要求しない。
 * - refusal・max_tokens のときは道具を呼ばずに終え、その旨を知らせる。
 */
export async function runTurn(
  ports: AgentPorts,
  options: TurnOptions,
  input: TurnInput,
  onEvent: TurnEventListener,
): Promise<TurnResult> {
  const { signal } = input;
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: input.question }] }];
  const evidence: Evidence[][] = [];
  let toolCallCount = 0;
  let phase: "prepare" | "model" | "tools" = "prepare";
  // 知らせた文章の断片をつないだもの。turn.completed の text になる
  let answer = "";
  const emit: TurnEventListener = (event) => {
    if (event.type === "text.delta") answer += event.text;
    onEvent(event);
  };

  const complete = (reason: TurnEndReason, last: AssistantMessage): TurnResult => {
    const notice = noticeFor(reason, answer, options.maxToolCalls);
    // 結果を返さない道具の呼び出しは履歴に残さない（次の要求の形が崩れないように）
    const content = last.content.filter((block) => block.type !== "tool_use");
    if (notice) {
      const text = answer ? `\n\n${notice}` : notice;
      emit({ type: "text.delta", text });
      content.push({ type: "text", text });
    }
    messages[messages.length - 1] = { role: "assistant", content };
    const outcome: TurnEventOf<"turn.completed"> = {
      type: "turn.completed",
      text: answer,
      evidence: mergeEvidence(evidence),
      reason,
    };
    emit(outcome);
    return { messages, outcome };
  };

  try {
    stopIfAborted(signal);
    const listing = await ports.catalog.list(signal);
    const toolsByName = new Map(listing.tools.map((tool) => [tool.name, tool]));
    const system = buildSystemPrompt(options.instructions ?? AGORACK_INSTRUCTIONS, listing.sources);
    const tools: ModelToolDefinition[] = listing.tools.map(
      ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
    );

    for (;;) {
      stopIfAborted(signal);
      phase = "model";
      const stream = ports.model.stream(
        { system, messages: [...input.history, ...messages], tools },
        signal,
      );
      const { message, reason } = await readResponse(stream, signal, emit);
      messages.push(message);

      const calls = message.content.filter((block) => block.type === "tool_use");
      if (reason !== "tool_use") return complete(reason, message);
      if (calls.length === 0) return complete("end_turn", message);
      if (toolCallCount + calls.length > options.maxToolCalls) {
        return complete("tool_limit", message);
      }
      toolCallCount += calls.length;

      phase = "tools";
      const results = await callTools(ports.catalog, toolsByName, calls, signal, emit);
      stopIfAborted(signal);
      evidence.push(...results.map((result) => result.evidence));
      messages.push({ role: "user", content: results.map((result) => result.block) });
    }
  } catch (error) {
    const code = signal.aborted ? "stopped" : phase === "model" ? "model_error" : "internal_error";
    const outcome: TurnEventOf<"turn.failed"> = {
      type: "turn.failed",
      code,
      message: FAILURE_MESSAGES[code],
    };
    onEvent(outcome);
    return { messages: [], outcome, error };
  }
}

/** 1回の応答のストリームを読み、届いた順に応答の中身を組み立てる。文章の断片はそのまま知らせる */
async function readResponse(
  stream: AsyncIterable<ModelStreamEvent>,
  signal: AbortSignal,
  onEvent: TurnEventListener,
): Promise<{ message: AssistantMessage; reason: StopReason }> {
  const content: AssistantBlock[] = [];
  for await (const event of stream) {
    stopIfAborted(signal);
    switch (event.type) {
      case "text.delta": {
        const last = content.at(-1);
        if (last?.type === "text") last.text += event.text;
        else content.push({ type: "text", text: event.text });
        onEvent({ type: "text.delta", text: event.text });
        break;
      }
      case "tool_use":
        content.push(event.call);
        break;
      case "passthrough":
        content.push(event.block);
        break;
      case "stop":
        return { message: { role: "assistant", content }, reason: event.reason };
    }
  }
  stopIfAborted(signal);
  throw new Error("モデルの応答が、終わりの知らせ（stop）なしに切れた");
}

type CallOutcome = { block: ToolResultBlock; evidence: Evidence[] };

/** 道具を並行して呼ぶ。結果は呼び出しの順に並べて返す */
async function callTools(
  catalog: ToolCatalog,
  toolsByName: ReadonlyMap<string, CatalogTool>,
  calls: readonly ToolUseBlock[],
  signal: AbortSignal,
  onEvent: TurnEventListener,
): Promise<CallOutcome[]> {
  for (const call of calls) {
    const tool = toolsByName.get(call.name);
    if (tool) {
      onEvent({
        type: "tool.called",
        callId: call.id,
        sourceId: tool.sourceId,
        tool: tool.tool,
        input: call.input,
      });
    }
  }

  return Promise.all(
    calls.map(async (call): Promise<CallOutcome> => {
      const tool = toolsByName.get(call.name);
      if (!tool) {
        // 一覧にない道具は呼ばない。tool.called も出していないので、画面には知らせない
        return {
          block: errorResult(call.id, `道具「${call.name}」はありません。`),
          evidence: [],
        };
      }

      let result: ToolCallResult;
      try {
        result = await catalog.call(call.name, call.input, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        result = {
          content: [{ type: "text", text: `道具の呼び出しに失敗しました：${describe(error)}` }],
          structuredContent: null,
          isError: true,
        };
      }
      stopIfAborted(signal);

      const evidence = result.isError
        ? []
        : extractEvidence(tool.sourceId, result.structuredContent).evidence;
      onEvent({
        type: "tool.completed",
        callId: call.id,
        ok: !result.isError,
        evidence,
        summary: summarize(result),
      });
      return { block: toResultBlock(call.id, result), evidence };
    }),
  );
}

function toResultBlock(toolUseId: string, result: ToolCallResult): ToolResultBlock {
  if (result.content.length > 0) {
    return { type: "tool_result", toolUseId, content: result.content, isError: result.isError };
  }
  const text =
    result.structuredContent == null ? "（結果なし）" : JSON.stringify(result.structuredContent);
  return {
    type: "tool_result",
    toolUseId,
    content: [{ type: "text", text }],
    isError: result.isError,
  };
}

function errorResult(toolUseId: string, text: string): ToolResultBlock {
  return { type: "tool_result", toolUseId, content: [{ type: "text", text }], isError: true };
}

/** 画面の進み具合に出す短い要約。道具が返した文章の最初の行を使う */
function summarize(result: ToolCallResult): string {
  const firstLine = result.content
    .flatMap((block) => (block.type === "text" ? block.text.split("\n") : []))
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return result.isError ? "失敗しました" : "結果を受け取りました";
  return firstLine.length > SUMMARY_MAX_LENGTH
    ? `${firstLine.slice(0, SUMMARY_MAX_LENGTH - 1)}…`
    : firstLine;
}

function noticeFor(reason: TurnEndReason, answer: string, maxToolCalls: number): string | null {
  switch (reason) {
    case "tool_limit":
      return NOTICES.tool_limit(maxToolCalls);
    case "max_tokens":
      return NOTICES.max_tokens();
    case "refusal":
      return NOTICES.refusal();
    case "end_turn":
      return answer ? null : NOTICES.empty();
  }
}

function stopIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new StoppedError();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
