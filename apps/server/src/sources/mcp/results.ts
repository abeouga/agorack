import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolCallResult, ToolResultContent } from "../../agent/ports.js";

/** MCP の道具の結果（SDK の型）。この型は sources/ の外に出さない */
type McpCallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type McpContentBlock = CallToolResult["content"][number];

const isStandardResult = (result: McpCallToolResult): result is CallToolResult =>
  Array.isArray((result as CallToolResult).content);

/** MCP の道具の結果を、Agorack の道具の結果にそろえる */
export function toToolCallResult(result: McpCallToolResult): ToolCallResult {
  if (!isStandardResult(result)) {
    // 古い形（toolResult）の応答。中身は文章にして渡す
    return {
      content: [{ type: "text", text: JSON.stringify(result.toolResult) }],
      structuredContent: null,
      isError: false,
    };
  }
  return {
    content: result.content.map(toContent),
    structuredContent: result.structuredContent ?? null,
    isError: result.isError === true,
  };
}

/** 文章と画像はそのまま、それ以外の種類（音声・資源）は文章にする */
function toContent(block: McpContentBlock): ToolResultContent {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return { type: "image", mimeType: block.mimeType, data: block.data };
    case "audio":
      return { type: "text", text: `（音声：${block.mimeType}。音声は扱えません）` };
    case "resource_link":
      return { type: "text", text: `（資源へのリンク：${block.name} ${block.uri}）` };
    case "resource":
      return "text" in block.resource
        ? { type: "text", text: block.resource.text }
        : { type: "text", text: `（資源：${block.resource.uri}。中身は文章でないため扱えません）` };
  }
}

/** 失敗の結果 */
export function errorResult(text: string): ToolCallResult {
  return { content: [{ type: "text", text }], structuredContent: null, isError: true };
}
