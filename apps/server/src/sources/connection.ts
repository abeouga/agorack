import type { ToolCallResult } from "../agent/ports.js";
import type { SourceConfig } from "../config/index.js";

/**
 * 部品1つとの接続。MCP の SDK の型は出さず、Agorack の型だけで表す。
 * 実装は mcp/（MCP のクライアント）。試験では偽物に替える。
 */
export interface SourceConnection {
  /** 部品の MCP サーバーが公開する説明（instructions）。ないときは null */
  readonly instructions: string | null;
  /** 部品の道具の一覧（接続した時に取ったもの） */
  readonly tools: readonly RemoteTool[];
  /**
   * 部品の道具を呼ぶ。tool は部品の中の名前（接頭辞なし）。
   * 部品のエラー・接続の切断・時間切れは、例外ではなく isError: true の結果で返す。
   * 中断（signal）されたときだけ例外で終える。
   */
  call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolCallResult>;
  /** 接続を閉じる（手元で起動した部品は、子のプロセスを止める） */
  close(): Promise<void>;
  /** 自分で閉じたのではなく、接続が切れたときに呼ばれる */
  onLost(listener: (reason: string) => void): void;
}

/** 部品の道具1つ（部品の中の名前のまま） */
export type RemoteTool = {
  name: string;
  description: string;
  /** 入力の JSON Schema（部品が公開しているもの） */
  inputSchema: Record<string, unknown>;
};

/** 設定に書いた部品1つにつなぐ。つなげなければ、理由を持つ例外で終える */
export type Connector = (source: SourceConfig) => Promise<SourceConnection>;
