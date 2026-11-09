import type Anthropic from "@anthropic-ai/sdk";
import type { ModelStreamEvent, StopReason, ToolUseBlock } from "../../agent/ports.js";

type RawEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type ApiStopReason = Anthropic.Beta.Messages.BetaStopReason;

/** SDK のストリームのうち、ここで使うところ */
export type MessageStreamLike = AsyncIterable<RawEvent> & {
  /** 届いたところまでの応答（ブロックは content_block_stop の時点でそろっている） */
  readonly currentMessage: Anthropic.Beta.Messages.BetaMessage | undefined;
  readonly ended: boolean;
  abort(): void;
};

/** 応答の形が想定と違う（道具の入力が JSON として読めない・知らない終わり方など） */
export class ModelResponseError extends Error {
  override readonly name = "ModelResponseError";
}

/** Messages API の終わった理由を、Agorack の終わった理由にする */
export function toStopReason(reason: ApiStopReason | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      // pause_turn・compaction は、サーバー側の道具や圧縮を使わないので来ない
      throw new ModelResponseError(`想定していない終わり方です（${reason ?? "なし"}）`);
  }
}

/**
 * SDK のストリームを、Agorack のストリームのイベントに変える。
 *
 * - 文章の断片は届いたらすぐ流す。
 * - 考えた過程・切り替え（fallback）などのブロックは、そのまま passthrough で包む。
 * - 道具の呼び出しは、ブロックがそろったら入力を厳密に JSON として読む（入力を作りながら流す設定では、
 *   SDK は途中で切れた入力も読めた形にしてしまうため）。
 * - 最初の道具の呼び出しから後は、終わった理由が分かるまで手元に置く。途中で別のモデルに切り替わった
 *   ときは、切り替わる前の道具の呼び出しを捨てる（次の要求で返してはいけないため）。
 * - 終わった理由が tool_use でなければ、道具の呼び出しは流さない（ループは呼ばないので）。
 */
export async function* readMessageStream(
  stream: MessageStreamLike,
): AsyncGenerator<ModelStreamEvent> {
  const held: ModelStreamEvent[] = [];
  let holding = false;
  const toolJson = new Map<number, string>();
  /** 読めなかった道具の入力（道具の名前）。切り替えで捨てたものは除く */
  const unreadable = new Map<string, string>();
  let apiStopReason: ApiStopReason | null = null;

  try {
    for await (const event of stream) {
      const ready: ModelStreamEvent[] = [];
      const emit = (e: ModelStreamEvent) => (holding ? held.push(e) : ready.push(e));

      switch (event.type) {
        case "content_block_start":
          if (event.content_block.type === "tool_use") toolJson.set(event.index, "");
          break;
        case "content_block_delta":
          if (event.delta.type === "text_delta" && event.delta.text !== "") {
            emit({ type: "text.delta", text: event.delta.text });
          } else if (event.delta.type === "input_json_delta") {
            toolJson.set(event.index, (toolJson.get(event.index) ?? "") + event.delta.partial_json);
          }
          break;
        case "content_block_stop": {
          const block = stream.currentMessage?.content[event.index];
          if (block === undefined || block.type === "text") break;
          if (block.type === "tool_use") {
            const input = parseToolInput(toolJson.get(event.index) ?? "");
            const call: ToolUseBlock = {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: input ?? {},
            };
            if (input === null) unreadable.set(block.id, block.name);
            holding = true;
            emit({ type: "tool_use", call });
            break;
          }
          if (block.type === "fallback") {
            // 切り替わる前の道具の呼び出しは、結果を返さずに捨てる
            for (let i = held.length - 1; i >= 0; i--) {
              const e = held[i];
              if (e?.type === "tool_use") {
                held.splice(i, 1);
                unreadable.delete(e.call.id);
              }
            }
          }
          emit({
            type: "passthrough",
            block: { type: "passthrough", data: structuredClone(block) },
          });
          break;
        }
        case "message_delta":
          if (event.delta.stop_reason) apiStopReason = event.delta.stop_reason;
          break;
      }
      yield* ready;
    }

    const reason = toStopReason(apiStopReason);
    if (reason === "tool_use" && unreadable.size > 0) {
      const names = [...unreadable.values()].join("、");
      throw new ModelResponseError(`道具（${names}）の入力が JSON として読めません`);
    }
    for (const e of held) {
      if (e.type !== "tool_use" || reason === "tool_use") yield e;
    }
    yield { type: "stop", reason };
  } finally {
    // 受け取る側が途中でやめたときも、要求を止める
    if (!stream.ended) stream.abort();
  }
}

/** 道具の入力を厳密に読む。オブジェクトでなければ null。何も届いていなければ空の入力 */
function parseToolInput(json: string): Record<string, unknown> | null {
  if (json.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
