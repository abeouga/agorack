import {
  ApiErrorResponseSchema,
  apiPaths,
  CreateConversationResponseSchema,
  TurnEventSchema,
  type TurnEvent,
} from "@agorack/contracts";
import { describe, expect, it, vi } from "vitest";
import { InMemoryConversations } from "../conversations/index.js";
import {
  documentResult,
  FakeCatalog,
  FakeModel,
  respond,
  respondUntilAborted,
  stop,
  textDelta,
  toolUse,
  type FakeResponse,
} from "../testing/fakePorts.js";
import { createHttpApp } from "./app.js";

const base = "http://127.0.0.1:8787";
const origin = "http://127.0.0.1:5174";

function setup(responses: FakeResponse[], catalog = new FakeCatalog()) {
  const model = new FakeModel(responses);
  const conversations = new InMemoryConversations({
    ports: { model, catalog },
    options: { maxToolCalls: 5 },
    logError: () => {},
  });
  const app = createHttpApp({ allowedOrigins: [origin], listSources: () => [], conversations });
  const post = (path: string, body?: unknown, init: RequestInit = {}) =>
    app.request(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      ...init,
    });
  const createConversation = async () => {
    const res = await post(apiPaths.conversations());
    expect(res.status).toBe(201);
    return CreateConversationResponseSchema.parse(await res.json()).conversationId;
  };
  return { app, model, post, createConversation };
}

/** SSE の本文を読み、event: と data: が契約どおりかを確かめてイベントの並びにする */
async function readSse(res: Response): Promise<TurnEvent[]> {
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => {
      const lines = chunk.split("\n");
      const name = lines.find((l) => l.startsWith("event: "))?.slice("event: ".length);
      const data = lines.find((l) => l.startsWith("data: "))?.slice("data: ".length);
      const event = TurnEventSchema.parse(JSON.parse(data ?? ""));
      expect(name).toBe(event.type);
      return event;
    });
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  const body = ApiErrorResponseSchema.parse(await res.json());
  expect(body.error.code).toBe(code);
  return body;
}

describe("会話の API", () => {
  it("会話を始め、質問を送ると、イベントが SSE で順に流れ、最後に答えと根拠が届く", async () => {
    const { post, createConversation } = setup(
      [
        respond(toolUse("call-1", "fuminosuke__get_document", { id: "7" }), stop("tool_use")),
        respond(textDelta("黒"), textDelta("です。"), stop("end_turn")),
      ],
      new FakeCatalog({ fuminosuke__get_document: documentResult("7", "黒") }),
    );
    const id = await createConversation();
    const res = await post(apiPaths.turns(id), { text: "毛色は？" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);

    const events = await readSse(res);
    expect(events.map((e) => e.type)).toEqual([
      "turn.started",
      "tool.called",
      "tool.completed",
      "text.delta",
      "text.delta",
      "turn.completed",
    ]);
    expect(events[1]).toMatchObject({ sourceId: "fuminosuke", tool: "get_document" });
    expect(events.at(-1)).toMatchObject({
      type: "turn.completed",
      text: "黒です。",
      evidence: [{ recordId: "7", value: "黒" }],
    });
  });

  it("要求の本文が JSON でなければ 400", async () => {
    const { post, createConversation } = setup([]);
    const id = await createConversation();
    await expectError(await post(apiPaths.turns(id), "{oops"), 400, "INVALID_REQUEST");
  });

  it.each([
    ["質問が空", { text: "   " }],
    ["text がない", { question: "毛色は？" }],
    ["質問が長すぎる", { text: "あ".repeat(4001) }],
  ])("%sときは 400 と、どの項目が悪いかを返す", async (_name, body) => {
    const { post, createConversation } = setup([]);
    const id = await createConversation();
    const error = await expectError(await post(apiPaths.turns(id), body), 400, "INVALID_REQUEST");
    expect(error.error.issues?.map((issue) => issue.path)).toEqual(["text"]);
  });

  it("ない会話には 404（質問・停止・削除）", async () => {
    const { app, post } = setup([]);
    await expectError(
      await post(apiPaths.turns("nope"), { text: "q" }),
      404,
      "CONVERSATION_NOT_FOUND",
    );
    await expectError(await post(apiPaths.stopTurn("nope")), 404, "CONVERSATION_NOT_FOUND");
    const res = await app.request(`${base}${apiPaths.conversation("nope")}`, { method: "DELETE" });
    await expectError(res, 404, "CONVERSATION_NOT_FOUND");
  });

  it("進行中のターンがあると 409。止めると 204 で、流れていた SSE は stopped で終わる", async () => {
    const { post, model, createConversation } = setup([
      respondUntilAborted("考え中"),
      respond(textDelta("はい"), stop("end_turn")),
    ]);
    const id = await createConversation();
    const first = await post(apiPaths.turns(id), { text: "長い質問" });
    await vi.waitFor(() => expect(model.requests).toHaveLength(1));

    await expectError(
      await post(apiPaths.turns(id), { text: "割り込み" }),
      409,
      "TURN_IN_PROGRESS",
    );

    expect((await post(apiPaths.stopTurn(id))).status).toBe(204);
    const events = await readSse(first);
    expect(events.map((e) => e.type)).toEqual(["turn.started", "text.delta", "turn.failed"]);
    expect(events.at(-1)).toMatchObject({ code: "stopped" });

    const next = await readSse(await post(apiPaths.turns(id), { text: "次の質問" }));
    expect(next.at(-1)).toMatchObject({ type: "turn.completed", text: "はい" });
  });

  it("画面との接続が切れたら、ターンを止める", async () => {
    let signal: AbortSignal | undefined;
    const { post, model, createConversation } = setup([
      async function* (request, s) {
        signal = s;
        yield* respondUntilAborted("考え中")(request, s);
      },
    ]);
    const id = await createConversation();
    const connection = new AbortController();
    await post(apiPaths.turns(id), { text: "q" }, { signal: connection.signal });
    await vi.waitFor(() => expect(model.requests).toHaveLength(1));
    connection.abort();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("会話を消すと 204。そのあとは 404", async () => {
    const { app, post, createConversation } = setup([]);
    const id = await createConversation();
    const del = () => app.request(`${base}${apiPaths.conversation(id)}`, { method: "DELETE" });
    expect((await del()).status).toBe(204);
    await expectError(await del(), 404, "CONVERSATION_NOT_FOUND");
    await expectError(await post(apiPaths.turns(id), { text: "q" }), 404, "CONVERSATION_NOT_FOUND");
  });

  it("許していない Origin からの質問は 403 で断り、ターンを始めない", async () => {
    const { app, model, createConversation } = setup([]);
    const id = await createConversation();
    const res = await app.request(`${base}${apiPaths.turns(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ text: "q" }),
    });
    expect(res.status).toBe(403);
    expect(model.requests).toHaveLength(0);
  });
});
