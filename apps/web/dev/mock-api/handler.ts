import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type ApiErrorCode,
  type ApiErrorResponse,
  type TurnEvent,
  StartTurnRequestSchema,
  apiErrorStatus,
} from "@agorack/contracts";
import { mockSources, pickScenario } from "./scenarios";

type Running = { stop: () => void };

/**
 * 偽のサーバーの HTTP の処理。本物のサーバー（apps/server）と同じ HTTP の契約（packages/contracts）で答える。
 * apps/server は import しない。
 */
export function createMockApi() {
  /** 会話の ID と、進行中のターン */
  const conversations = new Map<string, { running: Running | null }>();

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/api/health") return sendJson(res, 200, { status: "ok" });
    if (method === "GET" && path === "/api/sources")
      return sendJson(res, 200, { sources: mockSources });
    if (method === "POST" && path === "/api/conversations") {
      const conversationId = randomUUID();
      conversations.set(conversationId, { running: null });
      return sendJson(res, 201, { conversationId });
    }

    const match = /^\/api\/conversations\/([^/]+)(\/turns(\/current\/stop)?)?$/.exec(path);
    if (!match?.[1]) return sendError(res, "INVALID_REQUEST", "知らないパスです");
    const conversationId = decodeURIComponent(match[1]);
    const conversation = conversations.get(conversationId);
    if (!conversation) return sendError(res, "CONVERSATION_NOT_FOUND", "会話が見つかりません");

    if (method === "DELETE" && !match[2]) {
      conversation.running?.stop();
      conversations.delete(conversationId);
      return sendEmpty(res);
    }
    if (method === "POST" && match[3]) {
      conversation.running?.stop();
      return sendEmpty(res);
    }
    if (method === "POST" && match[2]) {
      if (conversation.running) {
        return sendError(res, "TURN_IN_PROGRESS", "前の質問に答えているところです");
      }
      const parsed = StartTurnRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) {
        return sendError(
          res,
          "INVALID_REQUEST",
          parsed.error.issues[0]?.message ?? "要求の形が違います",
        );
      }
      return streamTurn(res, conversation, parsed.data.text);
    }
    return sendError(res, "INVALID_REQUEST", "知らないメソッドです");
  };
}

/** 選んだ並びのイベントを SSE で流す。停止・接続の切断で turn.failed（stopped）を送って終える */
async function streamTurn(
  res: ServerResponse,
  conversation: { running: Running | null },
  question: string,
) {
  const controller = new AbortController();
  const running: Running = { stop: () => controller.abort() };
  conversation.running = running;
  // 画面との接続が切れたら止める（応答を書き終える前に閉じられたとき）
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: TurnEvent) =>
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

  try {
    for (const step of pickScenario(question).steps(`turn-${randomUUID()}`)) {
      await sleep(step.wait, controller.signal);
      if (controller.signal.aborted) break;
      send(step.event);
    }
    if (controller.signal.aborted) {
      send({ type: "turn.failed", code: "stopped", message: "回答を止めました。" });
    }
  } finally {
    if (conversation.running === running) conversation.running = null;
    res.end();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendEmpty(res: ServerResponse) {
  res.writeHead(204);
  res.end();
}

function sendError(res: ServerResponse, code: ApiErrorCode, message: string) {
  const body: ApiErrorResponse = { error: { code, message } };
  sendJson(res, apiErrorStatus[code], body);
}
