import type Anthropic from "@anthropic-ai/sdk";
import type {
  AssistantBlock,
  Message,
  ModelRequest,
  ToolResultContent,
  UserBlock,
} from "../../agent/ports.js";
import type { AnthropicSettings } from "./settings.js";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;

/**
 * 安全上の理由で断られたときに、別のモデルで続けるサーバー側の切り替え（設計 §5）。
 * `"default"` は、断られた理由ごとに推奨のモデルを API が選ぶ形。
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Claude が画像として受け取れる形式 */
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
type ImageMediaType = Anthropic.Beta.Messages.BetaBase64ImageSource["media_type"];

/** Agorack の要求を、Messages API の要求（ストリーム）に変える */
export function toStreamParams(request: ModelRequest, settings: AnthropicSettings): StreamParams {
  return {
    model: settings.model,
    max_tokens: settings.maxTokens,
    // 考える量は effort で決める（最近のモデルでは考えることを止められない）
    thinking: { type: "adaptive" },
    output_config: { effort: settings.effort },
    ...(request.system === "" ? {} : { system: request.system }),
    messages: request.messages.map(toMessageParam),
    ...(request.tools.length === 0
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
            // 入力を作りながら流す。受け取った入力は、読めることを確かめてから渡す（response.ts）
            eager_input_streaming: true,
          })),
          tool_choice: { type: "auto" },
        }),
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    stream: true,
  };
}

function toMessageParam(message: Message): MessageParam {
  if (message.role === "user") {
    return { role: "user", content: message.content.flatMap(toUserBlockParam) };
  }
  return { role: "assistant", content: toAssistantContent(message.content) };
}

function toUserBlockParam(block: UserBlock): ContentBlockParam[] {
  if (block.type === "text") return block.text.trim() === "" ? [] : [block];
  return [
    {
      type: "tool_result",
      tool_use_id: block.toolUseId,
      is_error: block.isError,
      content: block.content.map(toToolResultContent),
    },
  ];
}

function toToolResultContent(
  content: ToolResultContent,
): Anthropic.Beta.Messages.BetaTextBlockParam | Anthropic.Beta.Messages.BetaImageBlockParam {
  if (content.type === "text") return content;
  if (!IMAGE_MEDIA_TYPES.has(content.mimeType)) {
    return { type: "text", text: `（${content.mimeType} の画像は渡せないため省きました）` };
  }
  return {
    type: "image",
    source: { type: "base64", media_type: content.mimeType as ImageMediaType, data: content.data },
  };
}

/**
 * 応答の中身を、次の要求で返す形にする。
 * 途中で別のモデルに切り替わった応答（fallback のブロックがある）は、最後の切り替えより前の
 * 考えた過程のブロックを返さない（切り替わる前のモデルのものなので）。
 */
function toAssistantContent(blocks: readonly AssistantBlock[]): ContentBlockParam[] {
  const lastFallback = blocks.findLastIndex(
    (block) => block.type === "passthrough" && passthroughType(block.data) === "fallback",
  );
  return blocks.flatMap((block, index): ContentBlockParam[] => {
    switch (block.type) {
      case "text":
        return block.text.trim() === "" ? [] : [block];
      case "tool_use":
        return [{ type: "tool_use", id: block.id, name: block.name, input: block.input }];
      case "passthrough": {
        const type = passthroughType(block.data);
        const beforeSwitch = index < lastFallback;
        if (beforeSwitch && (type === "thinking" || type === "redacted_thinking")) return [];
        return [block.data as ContentBlockParam];
      }
    }
  });
}

function passthroughType(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("type" in data)) return undefined;
  return typeof data.type === "string" ? data.type : undefined;
}
