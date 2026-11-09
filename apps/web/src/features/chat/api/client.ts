import {
  type StartTurnRequest,
  CreateConversationResponseSchema,
  apiPaths,
} from "@agorack/contracts";
import { ApiError, request, requestJson } from "../../../shared/http";

/** 会話とターンの HTTP（設計 §8.1） */

export async function createConversation(): Promise<string> {
  const body = await requestJson(apiPaths.conversations(), { method: "POST" });
  const parsed = CreateConversationResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "会話を始められませんでした。");
  return parsed.data.conversationId;
}

/** 質問を送る。応答の本文は SSE（readTurnEvents で読む） */
export async function startTurn(
  conversationId: string,
  text: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const payload: StartTurnRequest = { text };
  const response = await request(apiPaths.turns(conversationId), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.body) throw new ApiError("BAD_RESPONSE", "回答を受け取れませんでした。");
  return response.body;
}

export async function stopTurn(conversationId: string): Promise<void> {
  await request(apiPaths.stopTurn(conversationId), { method: "POST" });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await request(apiPaths.conversation(conversationId), { method: "DELETE" });
}
