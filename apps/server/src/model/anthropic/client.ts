import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelRequest, ModelStreamEvent } from "../../agent/ports.js";
import { requireAnthropicApiKey } from "../../config/index.js";
import { toStreamParams } from "./request.js";
import { readMessageStream } from "./response.js";
import type { AnthropicSettings } from "./settings.js";

/**
 * ModelClient の Claude 実装（設計 §5）。`messages.stream` で呼び、SDK の型と Agorack の型を変換する。
 * SDK のクライアントは最初に呼ぶときに設定の API キーで作る。キーがなければ、そこで分かる文で失敗する
 * （キーがなくてもサーバーは起動できるように）。
 */
export function createAnthropicModelClient(settings: AnthropicSettings): ModelClient {
  let client: Anthropic | undefined;
  return createModelClientWith(settings, () => {
    client ??= new Anthropic({ apiKey: requireAnthropicApiKey(settings) });
    return client;
  });
}

/** SDK のクライアントを外から渡して作る。試験で、偽の fetch を持つクライアントを渡すために使う */
export function createModelClientWith(
  settings: AnthropicSettings,
  getClient: () => Anthropic,
): ModelClient {
  return {
    async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
      signal.throwIfAborted();
      const stream = getClient().beta.messages.stream(toStreamParams(request, settings), {
        signal,
      });
      yield* readMessageStream(stream);
    },
  };
}
