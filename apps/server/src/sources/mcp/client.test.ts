import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceConfig } from "../../config/index.js";
import type { SourceConnection } from "../connection.js";
import { StderrTail, createMcpConnector } from "./client.js";

const TEST_PART = fileURLToPath(new URL("./__fixtures__/test-part.mjs", import.meta.url));

const source = (command: string, args: string[]): SourceConfig => ({
  id: "test",
  name: "試験用の部品",
  description: "",
  transport: { type: "stdio", command, args, env: {} },
  enabled: true,
});

const connect = createMcpConnector({ connectTimeoutMs: 15_000, callTimeoutMs: 15_000 });
const signal = () => new AbortController().signal;

const opened: SourceConnection[] = [];
async function openTestPart(): Promise<SourceConnection> {
  const connection = await connect(source(process.execPath, [TEST_PART]));
  opened.push(connection);
  return connection;
}

afterEach(async () => {
  await Promise.allSettled(opened.splice(0).map((connection) => connection.close()));
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

describe("MCP（stdio）で部品につなぐ", { timeout: 30_000 }, () => {
  it("部品を起動し、道具の一覧と部品の説明を取る", async () => {
    const connection = await openTestPart();

    expect(connection.instructions).toBe("試験用の部品の説明");
    expect(connection.tools.map((tool) => tool.name)).toEqual([
      "echo",
      "fail",
      "picture",
      "pid",
      "exit",
    ]);
    expect(connection.tools[0]).toMatchObject({
      description: "入力の文章を、根拠付きで返す",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    });
  });

  it("道具の結果の文章と構造化データを、Agorack の形で返す", async () => {
    const connection = await openTestPart();

    expect(await connection.call("echo", { text: "こんにちは" }, signal())).toEqual({
      content: [{ type: "text", text: "こんにちは" }],
      structuredContent: {
        items: [
          {
            kind: "note",
            source_id: "n-1",
            label: "こんにちは",
            location: { line: 1 },
            value: "こんにちは",
          },
        ],
      },
      isError: false,
    });
  });

  it("画像はそのまま、資源は文章にして返す", async () => {
    const connection = await openTestPart();

    expect((await connection.call("picture", {}, signal())).content).toEqual([
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      { type: "text", text: "資源の文章" },
    ]);
  });

  it("部品が返したエラーは isError の結果にする", async () => {
    const connection = await openTestPart();

    expect(await connection.call("fail", {}, signal())).toEqual({
      content: [{ type: "text", text: "部品のエラー" }],
      structuredContent: null,
      isError: true,
    });
  });

  it("部品が終了したら、呼び出しをエラーの結果にし、切れたことを知らせる", async () => {
    const connection = await openTestPart();
    const lost: string[] = [];
    connection.onLost((reason) => lost.push(reason));

    const result = await connection.call("exit", {}, signal());

    expect(result.isError).toBe(true);
    expect(await waitUntil(() => lost.length > 0)).toBe(true);
    expect(lost[0]).toContain("試験用の部品を終了します");
  });

  it("閉じると、起動した子のプロセスを止める", async () => {
    const connection = await openTestPart();
    const result = await connection.call("pid", {}, signal());
    const pid = Number(result.content[0]?.type === "text" ? result.content[0].text : NaN);
    expect(isAlive(pid)).toBe(true);
    const lost: string[] = [];
    connection.onLost((reason) => lost.push(reason));

    await connection.close();

    expect(await waitUntil(() => !isAlive(pid))).toBe(true);
    // 自分で閉じたときは、切れたとは知らせない
    expect(lost).toEqual([]);
  });

  it("パスで書いたコマンドがなければ、起動せずに理由を持つ例外で終える", async () => {
    await expect(connect(source("C:/no/such/command.exe", []))).rejects.toThrow(
      "起動するコマンドが見つかりません：C:/no/such/command.exe",
    );
  });

  it("作業フォルダーがなければ、起動せずに理由を持つ例外で終える", async () => {
    const config = source(process.execPath, [TEST_PART]);
    if (config.transport.type === "stdio") config.transport.cwd = "C:/no/such/folder";
    await expect(connect(config)).rejects.toThrow("作業フォルダー（cwd）がありません");
  });

  it("名前だけのコマンドが見つからなければ、例外で終える（文字化けさせない）", async () => {
    const error = await connect(source("agorack-no-such-command", [])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("\uFFFD");
  });

  it("MCP を話さない部品は、つなげずに例外で終える", async () => {
    const quick = createMcpConnector({ connectTimeoutMs: 2_000 });
    await expect(
      quick(
        source(process.execPath, [
          "-e",
          "console.error('MCP ではない'); setTimeout(() => {}, 10000)",
        ]),
      ),
    ).rejects.toThrow(/MCP ではない/);
  });
});

describe("部品の標準エラーの最後の数行", () => {
  it("UTF-8 と Shift_JIS の行を読み、最後の5行だけを残す", () => {
    const tail = new StderrTail();
    // 「パス」の Shift_JIS は 83 70 83 58
    const shiftJisLine = Buffer.from([0x83, 0x70, 0x83, 0x58, 0x0d, 0x0a]);
    tail.push(Buffer.from("1\n2\n3\n4\n", "utf8"));
    tail.push(Buffer.from("日本", "utf8"));
    tail.push(Buffer.from("語\r\n", "utf8"));
    tail.push(shiftJisLine);
    tail.push(Buffer.from("途中の行", "utf8"));

    expect(tail.tail()).toEqual(["3", "4", "日本語", "パス", "途中の行"]);
  });
});
