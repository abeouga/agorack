// 試験用の部品（MCP サーバー、標準入出力）。client.test.ts が子のプロセスとして起動する。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "test-part", version: "0.0.0" },
  { instructions: "試験用の部品の説明" },
);

server.registerTool(
  "echo",
  { description: "入力の文章を、根拠付きで返す", inputSchema: { text: z.string() } },
  async ({ text }) => ({
    content: [{ type: "text", text }],
    structuredContent: {
      items: [{ kind: "note", source_id: "n-1", label: text, location: { line: 1 }, value: text }],
    },
  }),
);

server.registerTool("fail", { description: "部品のエラーを返す" }, async () => ({
  content: [{ type: "text", text: "部品のエラー" }],
  isError: true,
}));

server.registerTool("picture", { description: "画像と資源を返す" }, async () => ({
  content: [
    { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    { type: "resource", resource: { uri: "memo://1", text: "資源の文章" } },
  ],
}));

server.registerTool("pid", { description: "プロセスの番号を返す" }, async () => ({
  content: [{ type: "text", text: String(process.pid) }],
}));

server.registerTool("exit", { description: "部品を終了する" }, async () => {
  console.error("試験用の部品を終了します");
  process.exit(3);
});

await server.connect(new StdioServerTransport());
console.error("試験用の部品を起動しました");
