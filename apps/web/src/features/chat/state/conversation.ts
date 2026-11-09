import type { Evidence, TurnEndReason, TurnEvent, TurnFailureCode } from "@agorack/contracts";
import { evidenceKey } from "../../evidence/selection";

/**
 * 1つの会話の状態と、それを SSE のイベントで進める reducer。
 * 副作用（通信・保存）を持たないので、イベントの並びを渡して試せる。
 */

export type ToolCallStatus = "running" | "succeeded" | "failed" | "cancelled";

/** 道具の呼び出し1回（tool.called から tool.completed まで） */
export type ToolCall = {
  callId: string;
  sourceId: string;
  tool: string;
  input: Record<string, unknown>;
  status: ToolCallStatus;
  /** tool.completed の要約（例：書類を3件見つけました） */
  summary: string | null;
  evidence: Evidence[];
};

/**
 * ターンが答えを出さずに終わった理由。
 * サーバーの turn.failed のコードに、画面の側の失敗（つながらない・イベントの形が違う）を足す。
 */
export type TurnFailure = {
  code: TurnFailureCode | "client_error";
  message: string;
};

export type TurnStatus = "pending" | "completed" | "failed";

export type Turn = {
  /** 画面で付けた ID（送った時点で決める） */
  id: string;
  question: string;
  askedAt: number;
  /** サーバーが turn.started で付けた ID */
  serverTurnId: string | null;
  /** 答えの文章（Markdown）。text.delta をつなげ、turn.completed の全文で置き換える */
  text: string;
  tools: ToolCall[];
  /** このターンの根拠。tool.completed のたびに足し、turn.completed の一覧で置き換える */
  evidence: Evidence[];
  status: TurnStatus;
  endReason: TurnEndReason | null;
  failure: TurnFailure | null;
};

export type Conversation = {
  /** 画面で付けた ID（履歴のキー） */
  id: string;
  /** サーバーの会話の ID。最初の質問を送るときに作る */
  serverId: string | null;
  title: string;
  updatedAt: number;
  turns: Turn[];
};

export type ConversationAction =
  | { type: "turn.submitted"; turnId: string; question: string; at: number }
  | { type: "turn.event"; turnId: string; event: TurnEvent }
  /** 通信の失敗など、サーバーの turn.failed が届かずに終わった */
  | { type: "turn.errored"; turnId: string; message: string }
  /** 画面の側で受け取りを止めた（停止を押したがサーバーが応えない・画面を読み込み直した） */
  | { type: "turn.abandoned"; turnId: string; message: string }
  | { type: "server.assigned"; serverId: string };

export const STOPPED_MESSAGE = "回答を止めました。";
const TITLE_LENGTH = 40;

export function emptyConversation(id: string, at: number): Conversation {
  return { id, serverId: null, title: "新しい会話", updatedAt: at, turns: [] };
}

export function titleOf(question: string): string {
  const line = question.trim().split("\n")[0] ?? "";
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH)}…` : line;
}

export function isBusy(conversation: Conversation): boolean {
  return conversation.turns.some((turn) => turn.status === "pending");
}

export function conversationReducer(
  conversation: Conversation,
  action: ConversationAction,
): Conversation {
  switch (action.type) {
    case "turn.submitted": {
      const turn: Turn = {
        id: action.turnId,
        question: action.question,
        askedAt: action.at,
        serverTurnId: null,
        text: "",
        tools: [],
        evidence: [],
        status: "pending",
        endReason: null,
        failure: null,
      };
      return {
        ...conversation,
        title: conversation.turns.length === 0 ? titleOf(action.question) : conversation.title,
        updatedAt: action.at,
        turns: [...conversation.turns, turn],
      };
    }
    case "server.assigned":
      return { ...conversation, serverId: action.serverId };
    case "turn.event":
      return updatePendingTurn(conversation, action.turnId, (turn) =>
        applyEvent(turn, action.event),
      );
    case "turn.errored":
      return updatePendingTurn(conversation, action.turnId, (turn) =>
        fail(turn, { code: "client_error", message: action.message }),
      );
    case "turn.abandoned":
      return updatePendingTurn(conversation, action.turnId, (turn) =>
        fail(turn, { code: "stopped", message: action.message }),
      );
  }
}

/** 進行中のターンだけを変える。終わったターンに遅れて届いたイベントは捨てる */
function updatePendingTurn(
  conversation: Conversation,
  turnId: string,
  update: (turn: Turn) => Turn,
): Conversation {
  let changed = false;
  const turns = conversation.turns.map((turn) => {
    if (turn.id !== turnId || turn.status !== "pending") return turn;
    const next = update(turn);
    changed = next !== turn;
    return next;
  });
  return changed ? { ...conversation, turns } : conversation;
}

function applyEvent(turn: Turn, event: TurnEvent): Turn {
  switch (event.type) {
    case "turn.started":
      return { ...turn, serverTurnId: event.turnId };
    case "text.delta":
      return event.text ? { ...turn, text: turn.text + event.text } : turn;
    case "tool.called": {
      // 同じ呼び出しが2度届いても1つにする
      if (turn.tools.some((call) => call.callId === event.callId)) return turn;
      const call: ToolCall = {
        callId: event.callId,
        sourceId: event.sourceId,
        tool: event.tool,
        input: event.input,
        status: "running",
        summary: null,
        evidence: [],
      };
      return { ...turn, tools: [...turn.tools, call] };
    }
    case "tool.completed": {
      if (!turn.tools.some((call) => call.callId === event.callId)) return turn;
      return {
        ...turn,
        tools: turn.tools.map((call) =>
          call.callId === event.callId
            ? {
                ...call,
                status: event.ok ? "succeeded" : "failed",
                summary: event.summary,
                evidence: event.evidence,
              }
            : call,
        ),
        evidence: mergeEvidence(turn.evidence, event.evidence),
      };
    }
    case "turn.completed":
      return {
        ...turn,
        // 最後の全文を正とする。全文が空なら流れてきた文章を残す
        text: event.text || turn.text,
        evidence: event.evidence,
        tools: cancelRunning(turn.tools),
        status: "completed",
        endReason: event.reason,
      };
    case "turn.failed":
      return fail(turn, { code: event.code, message: event.message });
  }
}

function fail(turn: Turn, failure: TurnFailure): Turn {
  return { ...turn, tools: cancelRunning(turn.tools), status: "failed", failure };
}

function cancelRunning(tools: ToolCall[]): ToolCall[] {
  return tools.some((call) => call.status === "running")
    ? tools.map((call) => (call.status === "running" ? { ...call, status: "cancelled" } : call))
    : tools;
}

/** 同じ根拠は1つにまとめて足す */
export function mergeEvidence(current: Evidence[], added: Evidence[]): Evidence[] {
  const seen = new Set(current.map(evidenceKey));
  const merged = [...current];
  for (const item of added) {
    const key = evidenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}
