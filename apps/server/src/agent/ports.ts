/**
 * 道具を使うループが依存する2つのポート（設計 §4.1・§5、決定 0002）。
 *
 * - ModelClient：モデルを呼ぶ（実装は model/anthropic/）
 * - ToolCatalog：部品の道具の一覧と呼び出し（実装は sources/）
 *
 * Claude の SDK・MCP の SDK の型はここに出さない。実装の側で Agorack の型との変換をする。
 */

// ---- 会話のメッセージ ----

/** 文章 */
export type TextBlock = { type: "text"; text: string };

/** 画像（base64）。道具の結果に入ることがある */
export type ImageBlock = { type: "image"; mimeType: string; data: string };

/** モデルが道具を呼ぶ要求 */
export type ToolUseBlock = {
  type: "tool_use";
  /** 呼び出しの ID。結果（ToolResultBlock の toolUseId）と対にする */
  id: string;
  /** Claude に渡した道具の名前（`<部品のid>__<道具の名前>`） */
  name: string;
  input: Record<string, unknown>;
};

/**
 * ModelClient の実装が、次の要求でそのまま返してほしいブロック（考えた過程の署名など）。
 * ループは中を見ずに履歴に残す。
 */
export type PassthroughBlock = { type: "passthrough"; data: unknown };

/** 道具の結果。失敗も落とさず isError: true で返す */
export type ToolResultBlock = {
  type: "tool_result";
  toolUseId: string;
  content: ToolResultContent[];
  isError: boolean;
};

/** 道具の結果の中身 */
export type ToolResultContent = TextBlock | ImageBlock;

export type AssistantBlock = TextBlock | ToolUseBlock | PassthroughBlock;
export type UserBlock = TextBlock | ToolResultBlock;

export type UserMessage = { role: "user"; content: UserBlock[] };
export type AssistantMessage = { role: "assistant"; content: AssistantBlock[] };
export type Message = UserMessage | AssistantMessage;

// ---- ModelClient ----

/** モデルに渡す道具の定義 */
export type ModelToolDefinition = {
  /** Claude に渡す名前（`<部品のid>__<道具の名前>`） */
  name: string;
  description: string;
  /** 入力の JSON Schema（部品の MCP サーバーが公開しているもの） */
  inputSchema: Record<string, unknown>;
};

export type ModelRequest = {
  /** 指示（system prompt） */
  system: string;
  messages: readonly Message[];
  /** 使える道具。選び方は auto（特定の道具を強制しない） */
  tools: readonly ModelToolDefinition[];
};

/**
 * 1回の応答が終わった理由。
 * - `end_turn`：答え終わった（停止の文字列で止まったときも含む）
 * - `tool_use`：道具を呼んでほしい
 * - `max_tokens`：出力の長さの上限で切れた
 * - `refusal`：安全上の理由で断った（切り替え先のモデルでも断られた）
 */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal";

/**
 * 1回の応答のストリームのイベント。届いた順に並べると、応答の中身（AssistantBlock の並び）になる。
 * 最後に必ず `stop` が1つ来る。
 */
export type ModelStreamEvent =
  /** 文章の断片 */
  | { type: "text.delta"; text: string }
  /** 道具の呼び出し。入力がそろい、検証したあとに出す */
  | { type: "tool_use"; call: ToolUseBlock }
  /** 次の要求でそのまま返してほしいブロック */
  | { type: "passthrough"; block: PassthroughBlock }
  /** 応答の終わり */
  | { type: "stop"; reason: StopReason };

export interface ModelClient {
  /**
   * モデルを呼び、応答をストリームで返す。
   * 中断（signal）されたら要求を止め、反復を例外で終える。呼び出しの失敗も例外で知らせる。
   * モデル・effort・出力の上限は、実装が設定から持つ。
   */
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

// ---- ToolCatalog ----

/** 部品の道具1つ */
export type CatalogTool = ModelToolDefinition & {
  /** どの部品の道具か（設定の id） */
  sourceId: string;
  /** 部品の中の道具の名前（接頭辞なし。例：get_document） */
  tool: string;
};

/**
 * 部品の説明と状態。指示に、部品の名前を付けて足す。
 * - `connected`：つながっている。部品の説明（instructions）を足す
 * - `unavailable`：つながっていない（起動できない・切れてつなぎ直せない）。道具はなく、名前と理由を足す
 */
export type SourceInstructions =
  | {
      sourceId: string;
      /** 部品の名前（設定の name。例：文之助） */
      name: string;
      status: "connected";
      /** 部品の MCP サーバーが公開する説明（instructions）。ないときは null */
      instructions: string | null;
    }
  | {
      sourceId: string;
      name: string;
      status: "unavailable";
      /** つながらない理由（GET /api/sources の error と同じ） */
      reason: string;
    };

/** 1ターンで使える道具と、部品の説明・状態 */
export type ToolListing = {
  tools: readonly CatalogTool[];
  sources: readonly SourceInstructions[];
};

/** 道具を呼んだ結果 */
export type ToolCallResult = {
  /** Claude に返す中身。画像以外の種類（資源・音声など）は、実装が文章にする */
  content: ToolResultContent[];
  /** 構造化データ（MCP の structuredContent）。根拠はここから取り出す。ないときは null */
  structuredContent: unknown;
  /** 道具が失敗したか（入力がスキーマに合わない・接続が切れた・部品がエラーを返した） */
  isError: boolean;
};

export interface ToolCatalog {
  /**
   * いま使える道具と部品の説明を返す。ターンの始めに1回呼ぶ。
   * 切れた部品は、ここでつなぎ直してよい。つなげない部品の道具は一覧から外し、
   * 部品は `unavailable` として理由つきで返す（Claude が、どの部品が止まっているかを伝えられるように）。
   * 設定で止めた部品は返さない。
   */
  list(signal: AbortSignal): Promise<ToolListing>;

  /**
   * 道具を呼ぶ。name は Claude に渡した名前。
   * 入力の検証・接続の切断・部品のエラーは、例外ではなく isError: true の結果で返す。
   * 中断（signal）されたら呼び出しを止め、例外で終える。
   */
  call(name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<ToolCallResult>;
}
