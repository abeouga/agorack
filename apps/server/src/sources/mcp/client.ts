import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { SourceTransport } from "../../config/index.js";
import type { Connector, RemoteTool, SourceConnection } from "../connection.js";
import { errorResult, toToolCallResult } from "./results.js";

/**
 * MCP のクライアントで部品につなぐ（設計 §6）。手元で起動する stdio と、Streamable HTTP の両方。
 * MCP の SDK の型はこのフォルダーの外に出さず、SourceConnection（Agorack の型）にして返す。
 */

export type McpOptions = {
  /** つなぐ（初期化と道具の一覧）までの待ち時間（ミリ秒） */
  connectTimeoutMs: number;
  /** 道具の呼び出し1回の待ち時間（ミリ秒） */
  callTimeoutMs: number;
};

export const DEFAULT_MCP_OPTIONS: McpOptions = { connectTimeoutMs: 30_000, callTimeoutMs: 60_000 };

const CLIENT_INFO = { name: "agorack", version: "0.0.0" };
/** 道具の一覧を何ページまで読むか（終わらない一覧で止まらないように） */
const MAX_TOOL_PAGES = 20;
/** 手元で起動した部品の標準エラーを、失敗の理由に添えるために何行残すか */
const STDERR_TAIL_LINES = 5;

/** 設定に書いた部品に MCP でつなぐ Connector を作る */
export function createMcpConnector(options: Partial<McpOptions> = {}): Connector {
  const settings = { ...DEFAULT_MCP_OPTIONS, ...options };
  return async (source) => {
    if (source.transport.type === "stdio") checkStdioPaths(source.transport);
    const stderr = new StderrTail();
    const transport = createTransport(source.transport, stderr);
    try {
      return await openMcpConnection(transport, settings, stderr);
    } catch (error) {
      throw new Error(withStderr(describe(error), stderr), { cause: error });
    }
  };
}

type StdioTransportConfig = Extract<SourceTransport, { type: "stdio" }>;

/**
 * 作業フォルダーと、パスで書いたコマンドがあるかを起動の前に確かめる。
 * Windows では、見つからないコマンドも cmd.exe 経由で起動されて「接続が閉じた」としか分からないため。
 * 名前だけのコマンド（python など）は PATH から探すので、ここでは確かめない。
 */
function checkStdioPaths(config: StdioTransportConfig): void {
  if (config.cwd !== undefined && !existsSync(config.cwd)) {
    throw new Error(`作業フォルダー（cwd）がありません：${config.cwd}`);
  }
  const looksLikePath = isAbsolute(config.command) || /[\\/]/.test(config.command);
  if (looksLikePath && !existsSync(resolve(config.cwd ?? process.cwd(), config.command))) {
    throw new Error(`起動するコマンドが見つかりません：${config.command}`);
  }
}

function createTransport(config: SourceTransport, stderr: StderrTail): Transport {
  if (config.type === "http") return new StreamableHTTPClientTransport(new URL(config.url));
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    // SDK が、OS の動作に要る最低限の環境変数（PATH など）に足して渡す
    env: config.env,
    // 部品のログで画面が埋まらないよう受け取り、失敗の理由に最後の数行を添える
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer | string) =>
    stderr.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
  );
  return transport;
}

/**
 * 用意した transport で MCP の部品につなぎ、道具の一覧と説明を取る。
 * つなげなければ、transport を閉じて（子のプロセスを止めて）例外で終える。
 */
export async function openMcpConnection(
  transport: Transport,
  options: McpOptions = DEFAULT_MCP_OPTIONS,
  stderr?: StderrTail,
): Promise<SourceConnection> {
  const client = new Client(CLIENT_INFO);
  const lostListeners: ((reason: string) => void)[] = [];
  let closing = false;
  let lastError: unknown = null;

  client.onerror = (error) => {
    lastError = error;
  };
  client.onclose = () => {
    if (closing) return;
    closing = true;
    const cause = lastError === null ? "部品が接続を閉じました" : describe(lastError);
    const reason = stderr ? withStderr(cause, stderr) : cause;
    for (const listener of lostListeners) listener(reason);
  };

  let tools: RemoteTool[];
  try {
    await client.connect(transport, { timeout: options.connectTimeoutMs });
    tools = await listAllTools(client, options.connectTimeoutMs);
  } catch (error) {
    closing = true;
    await client.close().catch(() => undefined);
    throw error;
  }

  return {
    instructions: client.getInstructions()?.trim() || null,
    tools,
    async call(tool, input, signal) {
      try {
        const result = await client.callTool({ name: tool, arguments: input }, undefined, {
          signal,
          timeout: options.callTimeoutMs,
        });
        return toToolCallResult(result);
      } catch (error) {
        if (signal.aborted) throw error;
        return errorResult(`部品の道具を呼べませんでした：${describe(error)}`);
      }
    },
    async close() {
      closing = true;
      await client.close();
    },
    onLost(listener) {
      lostListeners.push(listener);
    },
  };
}

async function listAllTools(client: Client, timeout: number): Promise<RemoteTool[]> {
  const tools: RemoteTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    const result = await client.listTools(cursor === undefined ? {} : { cursor }, { timeout });
    for (const tool of result.tools) {
      tools.push({
        name: tool.name,
        description: tool.description ?? tool.title ?? "",
        inputSchema: tool.inputSchema,
      });
    }
    cursor = result.nextCursor;
    if (cursor === undefined) break;
  }
  return tools;
}

/** 手元で起動した部品の標準エラーの、最後の数行 */
export class StderrTail {
  private lines: string[] = [];
  private partial: Buffer = Buffer.alloc(0);

  /** 行の区切り（\n）はバイトで探す。UTF-8 でも Shift_JIS でも、文字の途中には現れないため */
  push(chunk: Buffer): void {
    let rest = Buffer.concat([this.partial, chunk]);
    for (let end = rest.indexOf(0x0a); end !== -1; end = rest.indexOf(0x0a)) {
      this.addLine(rest.subarray(0, end));
      rest = rest.subarray(end + 1);
    }
    this.partial = Buffer.from(rest);
  }

  tail(): string[] {
    const rest = decodeLine(this.partial);
    return [...this.lines, ...(rest === "" ? [] : [rest])].slice(-STDERR_TAIL_LINES);
  }

  private addLine(bytes: Buffer): void {
    const line = decodeLine(bytes);
    if (line === "") return;
    this.lines.push(line);
    this.lines = this.lines.slice(-STDERR_TAIL_LINES);
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const shiftJis = new TextDecoder("shift_jis");

/**
 * 標準エラーの1行を文字にする。UTF-8 として読めなければ Shift_JIS として読む
 * （Windows のコマンドプロンプトや、日本語の Windows の Python は Shift_JIS で書くことがあるため）。
 */
function decodeLine(bytes: Buffer): string {
  try {
    return utf8.decode(bytes).trim();
  } catch {
    return shiftJis.decode(bytes).trim();
  }
}

function withStderr(reason: string, stderr: StderrTail): string {
  const tail = stderr.tail();
  return tail.length === 0 ? reason : `${reason}\n部品の標準エラーの最後：\n${tail.join("\n")}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
