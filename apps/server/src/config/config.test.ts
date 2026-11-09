import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";
import { ConfigError, loadConfig, requireAnthropicApiKey, WEB_DEV_ORIGINS } from "./index.js";
import { parseSourcesFile } from "./sources.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const exampleText = readFileSync(resolve(repoRoot, "config/sources.example.json"), "utf8");

/** 見本を元に、一部だけ変えた設定ファイルの中身を作る */
function sourcesWith(change: (file: { sources: Record<string, unknown>[] }) => void): string {
  const file = JSON.parse(exampleText) as { sources: Record<string, unknown>[] };
  change(file);
  return JSON.stringify(file);
}

function sourceAt(file: { sources: Record<string, unknown>[] }, index: number) {
  const source = file.sources[index];
  if (source === undefined) throw new Error(`sources[${index}] がない`);
  return source;
}

describe("環境変数", () => {
  it("何も書かなければ既定の値になる", () => {
    const result = parseEnv({});
    expect(result).toEqual({
      ok: true,
      value: {
        server: { host: "127.0.0.1", port: 8787 },
        anthropic: { apiKey: null, model: "claude-opus-5-5", effort: "low", maxTokens: 64000 },
        agent: { maxToolCalls: 20 },
        sourcesConfigPath: null,
      },
    });
  });

  it("空の値は書いていないものとして扱う", () => {
    const result = parseEnv({ SERVER_PORT: "", ANTHROPIC_API_KEY: "  " });
    expect(result.ok && result.value.server.port).toBe(8787);
    expect(result.ok && result.value.anthropic.apiKey).toBeNull();
  });

  it("書いた値を読む", () => {
    const result = parseEnv({
      SERVER_HOST: "localhost",
      SERVER_PORT: "9000",
      ANTHROPIC_EFFORT: "medium",
      AGENT_MAX_TOOL_CALLS: "5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.server).toEqual({ host: "localhost", port: 9000 });
    expect(result.value.anthropic.effort).toBe("medium");
    expect(result.value.agent.maxToolCalls).toBe(5);
  });

  it.each([
    ["SERVER_PORT", "abc"],
    ["SERVER_PORT", "70000"],
    ["SERVER_PORT", "80.5"],
    ["SERVER_HOST", "0.0.0.0"],
    ["ANTHROPIC_EFFORT", "fast"],
    ["ANTHROPIC_MAX_TOKENS", "0"],
    ["AGENT_MAX_TOOL_CALLS", "-1"],
  ])("%s=%s は、その項目の名前を付けて断る", (key, value) => {
    const result = parseEnv({ [key]: value });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.path)).toEqual([key]);
    expect(result.problems[0]?.message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });
});

describe("部品の設定（config/sources.json）", () => {
  it("見本の設定ファイルは正しい形である", () => {
    const result = parseSourcesFile(exampleText, "config/sources.example.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [fuminosuke, cub] = result.value;
    expect(fuminosuke).toMatchObject({
      id: "fuminosuke",
      enabled: true,
      transport: {
        type: "stdio",
        env: {
          FUMINOSUKE_API_URL: "http://127.0.0.1:8010",
          FUMINOSUKE_WEB_URL: "http://127.0.0.1:5180",
        },
      },
      embed: { origin: "http://127.0.0.1:5180" },
    });
    expect(cub).toMatchObject({ id: "cub", enabled: false, transport: { type: "http" } });
    expect(cub?.embed).toBeUndefined();
  });

  it("省略できる項目には既定の値が入る", () => {
    const text = JSON.stringify({
      sources: [{ id: "a", name: "A", transport: { type: "stdio", command: "run" } }],
    });
    const result = parseSourcesFile(text, "x.json");
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "a",
          name: "A",
          description: "",
          enabled: true,
          transport: { type: "stdio", command: "run", args: [], env: {} },
        },
      ],
    });
  });

  const cases: [string, string, string, RegExp][] = [
    [
      "command がない",
      sourcesWith((f) => {
        delete (sourceAt(f, 0).transport as Record<string, unknown>).command;
      }),
      "sources[0].transport.command",
      /command/,
    ],
    [
      "id に使えない文字がある",
      sourcesWith((f) => {
        sourceAt(f, 1).id = "cub-logger";
      }),
      "sources[1].id",
      /英数字と _/,
    ],
    [
      "id が重なる",
      sourcesWith((f) => {
        sourceAt(f, 1).id = "fuminosuke";
      }),
      "sources[1].id",
      /重なっています/,
    ],
    [
      "transport.type が違う",
      sourcesWith((f) => {
        sourceAt(f, 1).transport = { type: "websocket", url: "ws://127.0.0.1" };
      }),
      "sources[1].transport.type",
      /"stdio" か "http"/,
    ],
    [
      "http の住所が http・https でない",
      sourcesWith((f) => {
        sourceAt(f, 1).transport = { type: "http", url: "ftp://example.invalid/mcp" };
      }),
      "sources[1].transport.url",
      /http か https/,
    ],
    [
      "embed.origin にパスが付いている",
      sourcesWith((f) => {
        sourceAt(f, 0).embed = { origin: "http://127.0.0.1:5180/embed" };
      }),
      "sources[0].embed.origin",
      /origin/,
    ],
    [
      "知らない項目がある（綴りの誤り）",
      sourcesWith((f) => {
        sourceAt(f, 1).enable = false;
      }),
      "sources[1]",
      /enable/,
    ],
    [
      "enabled が真偽値でない",
      sourcesWith((f) => {
        sourceAt(f, 1).enabled = "no";
      }),
      "sources[1].enabled",
      /true か false/,
    ],
  ];

  it.each(cases)("%s ときは、その項目を示して断る", (_, text, path, message) => {
    const result = parseSourcesFile(text, "config/sources.json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toContainEqual({
      where: "config/sources.json",
      path,
      message: expect.stringMatching(message),
    });
  });

  it("JSON として読めないときは断る", () => {
    const result = parseSourcesFile("{ sources: [", "config/sources.json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.message).toMatch(/JSON として読めません/);
  });
});

describe("loadConfig", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agorack-config-"));
    mkdirSync(join(root, "config"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("環境変数と config/sources.json を読み、画面の開発時の住所だけを許す", () => {
    writeFileSync(join(root, "config/sources.json"), exampleText);
    const config = loadConfig({ env: { SERVER_PORT: "8788" }, repoRoot: root });
    expect(config.server).toEqual({
      host: "127.0.0.1",
      port: 8788,
      allowedOrigins: ["http://127.0.0.1:5174", "http://localhost:5174"],
    });
    expect(config.server.allowedOrigins).toEqual(WEB_DEV_ORIGINS);
    expect(config.sources.path).toBe(join(root, "config/sources.json"));
    expect(config.sources.list.map((s) => s.id)).toEqual(["fuminosuke", "cub"]);
  });

  it("SOURCES_CONFIG_PATH は、リポジトリの根から数える", () => {
    writeFileSync(join(root, "other.json"), exampleText);
    const config = loadConfig({ env: { SOURCES_CONFIG_PATH: "other.json" }, repoRoot: root });
    expect(config.sources.path).toBe(join(root, "other.json"));
  });

  it("設定ファイルがないときは、見本から作るよう案内して止める", () => {
    expect(() => loadConfig({ env: {}, repoRoot: root })).toThrow(ConfigError);
    expect(() => loadConfig({ env: {}, repoRoot: root })).toThrow(
      /config\/sources\.json：\n {2}- ファイルがありません。config\/sources\.example\.json を写して/,
    );
  });

  it("環境変数と設定ファイルの誤りを、まとめて1つの文で知らせる", () => {
    writeFileSync(
      join(root, "config/sources.json"),
      JSON.stringify({ sources: [{ id: "a", name: "", transport: { type: "stdio" } }] }),
    );
    let message = "";
    try {
      loadConfig({ env: { SERVER_PORT: "x", ANTHROPIC_API_KEY: "secret-value" }, repoRoot: root });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }
    expect(message).toMatch(/^設定に誤りがあるため、サーバーを起動できません。/);
    expect(message).toMatch(
      /環境変数（apps\/server\/\.env）：\n {2}- SERVER_PORT：1〜65535 の整数/,
    );
    expect(message).toMatch(/config\/sources\.json：\n {2}- sources\[0\]\.name：name が空です/);
    expect(message).toMatch(/sources\[0\]\.transport\.command：command を文字列で/);
    expect(message).not.toContain("secret-value");
  });
});

describe("requireAnthropicApiKey", () => {
  const anthropic = { apiKey: null, model: "m", effort: "low", maxTokens: 1 } as const;

  it("キーがないときは、どこに書けばよいかが分かる文で失敗する", () => {
    expect(() => requireAnthropicApiKey(anthropic)).toThrow(ConfigError);
    expect(() => requireAnthropicApiKey(anthropic)).toThrow(
      /ANTHROPIC_API_KEY がないため、Claude を呼べません。apps\/server\/\.env に書いて/,
    );
  });

  it("キーがあればそのまま返す", () => {
    expect(requireAnthropicApiKey({ ...anthropic, apiKey: "k" })).toBe("k");
  });
});
