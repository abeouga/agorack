import { randomUUID } from "node:crypto";
import type { TurnEvent, TurnEventOf } from "@agorack/contracts";
import { runTurn, type AgentPorts, type TurnOptions, type TurnResult } from "../agent/loop.js";
import type { Message } from "../agent/ports.js";
import { createChannel } from "./channel.js";

/**
 * 会話の保持（履歴）と、1ターンの実行の窓口（設計 §4.1）。
 *
 * - 会話の履歴はサーバーのメモリに持つ（最初の版。設計 §1）。
 * - 同じ会話で同時に進められるターンは1つだけ。
 * - 停止・画面との接続の切断（イベントを読むのをやめる）で、ターンを中断する。
 * - 答えを出したターンだけを履歴に足す（失敗・停止したターンは足さない）。
 */

export type StartTurnResult =
  | { ok: true; turnId: string; events: AsyncIterable<TurnEvent> }
  | { ok: false; error: "not_found" | "turn_in_progress" };

/** 会話の窓口。HTTP はこれだけを使う */
export interface ConversationService {
  create(): string;
  /** 質問を送る。返ったイベントを最後まで読むか、読むのをやめる（＝中断）こと */
  startTurn(conversationId: string, question: string, signal?: AbortSignal): StartTurnResult;
  /** 進行中のターンを止める。ターンがなくても成功。会話がなければ false */
  stopTurn(conversationId: string): boolean;
  /** 会話を消す。進行中のターンは止める。会話がなければ false */
  delete(conversationId: string): boolean;
}

export type ConversationDeps = {
  ports: AgentPorts;
  options: TurnOptions;
  /** 失敗したターンの原因を記録する */
  logError?: (message: string, error: unknown) => void;
  /** 会話とターンの ID を作る（試験で決まった値にするため） */
  newId?: () => string;
};

type RunningTurn = { turnId: string; controller: AbortController };
type Conversation = { history: Message[]; current: RunningTurn | null };

export class InMemoryConversations implements ConversationService {
  readonly #conversations = new Map<string, Conversation>();
  readonly #deps: Required<ConversationDeps>;

  constructor(deps: ConversationDeps) {
    this.#deps = {
      logError: (message, error) => console.error(message, error),
      newId: randomUUID,
      ...deps,
    };
  }

  create(): string {
    const id = this.#deps.newId();
    this.#conversations.set(id, { history: [], current: null });
    return id;
  }

  startTurn(conversationId: string, question: string, signal?: AbortSignal): StartTurnResult {
    const conversation = this.#conversations.get(conversationId);
    if (!conversation) return { ok: false, error: "not_found" };
    if (conversation.current) return { ok: false, error: "turn_in_progress" };

    const turnId = this.#deps.newId();
    const controller = new AbortController();
    conversation.current = { turnId, controller };
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();

    // 読む側が途中でやめたら（接続の切断）、ターンを止める
    const channel = createChannel<TurnEvent>(stop);
    channel.push({ type: "turn.started", turnId });

    void this.#run(conversation, question, controller.signal, (event) => channel.push(event))
      .then((result) => {
        // 消された会話や、止めたあとに残ったターンの結果は足さない
        if (this.#conversations.get(conversationId) === conversation) {
          conversation.history.push(...result.messages);
        }
        const failed = result.outcome.type === "turn.failed" ? result.outcome : null;
        if (failed && failed.code !== "stopped") {
          this.#deps.logError(`ターン ${turnId} が失敗しました`, result.error);
        }
      })
      .finally(() => {
        signal?.removeEventListener("abort", stop);
        if (conversation.current?.turnId === turnId) conversation.current = null;
        channel.close();
      });

    return { ok: true, turnId, events: channel.iterable };
  }

  stopTurn(conversationId: string): boolean {
    const conversation = this.#conversations.get(conversationId);
    if (!conversation) return false;
    conversation.current?.controller.abort();
    return true;
  }

  delete(conversationId: string): boolean {
    const conversation = this.#conversations.get(conversationId);
    if (!conversation) return false;
    conversation.current?.controller.abort();
    this.#conversations.delete(conversationId);
    return true;
  }

  /** ループを回す。想定外の例外も turn.failed にして、必ず1つの結果で終える */
  async #run(
    conversation: Conversation,
    question: string,
    signal: AbortSignal,
    onEvent: (event: TurnEvent) => void,
  ): Promise<TurnResult> {
    try {
      return await runTurn(
        this.#deps.ports,
        this.#deps.options,
        { history: [...conversation.history], question, signal },
        onEvent,
      );
    } catch (error) {
      const outcome: TurnEventOf<"turn.failed"> = {
        type: "turn.failed",
        code: "internal_error",
        message: "サーバーの中で想定外の失敗がありました。",
      };
      onEvent(outcome);
      return { messages: [], outcome, error };
    }
  }
}
