import {
  ApiErrorResponseSchema,
  HealthResponseSchema,
  SourcesResponseSchema,
  apiPaths,
  type SourceInfo,
} from "@agorack/contracts";
import { describe, expect, it, vi } from "vitest";
import { InMemoryConversations } from "../conversations/index.js";
import { FakeCatalog, FakeModel } from "../testing/fakePorts.js";
import { createHttpApp } from "./app.js";

const allowedOrigins = ["http://127.0.0.1:5174", "http://localhost:5174"];
const conversations = new InMemoryConversations({
  ports: { model: new FakeModel([]), catalog: new FakeCatalog() },
  options: { maxToolCalls: 5 },
});
const app = createHttpApp({ allowedOrigins, listSources: () => [], conversations });
const healthUrl = `http://127.0.0.1:8787${apiPaths.health()}`;

describe("GET /api/health", () => {
  it("200 と契約の形の本文を返す", async () => {
    const res = await app.request(healthUrl);
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({ status: "ok" });
  });

  it.each(allowedOrigins)("画面の住所 %s からの要求には CORS の許可を付ける", async (origin) => {
    const res = await app.request(healthUrl, { headers: { Origin: origin } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  });
});

describe("許していない相手の拒否", () => {
  it.each([
    "http://evil.example",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174.evil.example",
    "null",
  ])("Origin: %s の要求を 403 で断る", async (origin) => {
    const res = await app.request(healthUrl, { headers: { Origin: origin } });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("許していない Origin からの事前確認（OPTIONS）も断る", async () => {
    const res = await app.request(healthUrl, {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(403);
  });

  it("画面の住所からの事前確認（OPTIONS）には許可を返す", async () => {
    const res = await app.request(healthUrl, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5174", "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5174");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("宛先の名前が手元の住所でない要求（DNS rebinding）を断る", async () => {
    const res = await app.request("http://evil.example:8787/api/health");
    expect(res.status).toBe(403);
  });

  it.each(["http://localhost:8787", "http://[::1]:8787"])(
    "宛先の名前が %s なら受け付ける",
    async (base) => {
      const res = await app.request(`${base}${apiPaths.health()}`);
      expect(res.status).toBe(200);
    },
  );
});

describe("想定外の失敗", () => {
  it("500 と契約のエラーの形を返し、中身は記録だけする", async () => {
    const logError = vi.fn();
    const failing = createHttpApp({
      allowedOrigins,
      listSources: () => [],
      conversations,
      logError,
    });
    failing.get("/api/boom", () => {
      throw new Error("内部の詳細");
    });
    const res = await failing.request("http://127.0.0.1:8787/api/boom");
    expect(res.status).toBe(500);
    const body = ApiErrorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("内部の詳細");
    expect(logError).toHaveBeenCalledOnce();
  });
});

describe("GET /api/sources", () => {
  it("部品の一覧と状態を、契約の形で返す", async () => {
    const sources: SourceInfo[] = [
      {
        id: "fuminosuke",
        name: "文之助",
        description: "帳票",
        status: "connected",
        error: null,
        toolCount: 6,
      },
      {
        id: "broken",
        name: "壊れた部品",
        description: "",
        status: "failed",
        error: "起動できません",
        toolCount: 0,
      },
      {
        id: "off",
        name: "止めた部品",
        description: "",
        status: "disabled",
        error: null,
        toolCount: 0,
      },
    ];
    const withSources = createHttpApp({
      allowedOrigins,
      listSources: () => sources,
      conversations,
    });

    const res = await withSources.request(`http://127.0.0.1:8787${apiPaths.sources()}`);

    expect(res.status).toBe(200);
    expect(SourcesResponseSchema.parse(await res.json())).toEqual({ sources });
  });
});
