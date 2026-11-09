import { SourceIdSchema } from "@agorack/contracts";
import { z } from "zod";
import { japaneseErrorMap, problemsFromZod, type ConfigProblem } from "./errors.js";

/**
 * つなぐ部品（MCP サーバー）の設定 `config/sources.json` の検証（設計 §6.1）。
 * 綴りの誤りに気づけるよう、知らない項目は受け付けない。
 */

const requiredText = (label: string) =>
  z
    .string({ error: `${label} を文字列で書いてください` })
    .trim()
    .min(1, `${label} が空です`);

const httpUrl = (label: string) =>
  z.url({
    protocol: /^https?$/,
    error: `${label} は http か https の住所にしてください`,
  });

const StdioTransportSchema = z.strictObject({
  type: z.literal("stdio"),
  /** 起動するコマンド（手元の PC の場所） */
  command: requiredText("command"),
  args: z.array(z.string(), { error: "args は文字列の配列にしてください" }).default([]),
  cwd: requiredText("cwd").optional(),
  /** 部品の MCP サーバーに渡す環境変数 */
  env: z
    .record(z.string(), z.string(), { error: "env は文字列から文字列への対応にしてください" })
    .default({}),
});

const HttpTransportSchema = z.strictObject({
  type: z.literal("http"),
  /** Streamable HTTP の住所 */
  url: httpUrl("url"),
});

const TransportSchema = z.discriminatedUnion("type", [StdioTransportSchema, HttpTransportSchema], {
  error: 'transport.type は "stdio" か "http" にしてください',
});

/** 埋め込み用の画面の住所（設計 §7.4）。origin だけを書く */
const EmbedSchema = z.strictObject({
  origin: httpUrl("embed.origin").refine(
    (value) => URL.canParse(value) && new URL(value).origin === value,
    "embed.origin は住所の origin（例：http://127.0.0.1:5180）だけを書き、パスや末尾の / は付けないでください",
  ),
});

const SourceSchema = z.strictObject({
  id: SourceIdSchema,
  name: requiredText("name"),
  description: z.string({ error: "description は文字列で書いてください" }).default(""),
  transport: TransportSchema,
  /** 書かない部品は iframe で埋め込まない */
  embed: EmbedSchema.optional(),
  /** false のときはつながない */
  enabled: z.boolean({ error: "enabled は true か false にしてください" }).default(true),
});

export const SourcesFileSchema = z
  .strictObject({
    sources: z.array(SourceSchema, { error: "sources は部品の設定の配列にしてください" }),
  })
  .superRefine((file, ctx) => {
    const firstIndex = new Map<string, number>();
    file.sources.forEach((source, index) => {
      const earlier = firstIndex.get(source.id);
      if (earlier === undefined) {
        firstIndex.set(source.id, index);
        return;
      }
      ctx.addIssue({
        code: "custom",
        path: ["sources", index, "id"],
        message: `id「${source.id}」が sources[${earlier}] と重なっています。道具の名前の接頭辞になるので、部品ごとに違う id にしてください`,
      });
    });
  });

export type SourcesFile = z.infer<typeof SourcesFileSchema>;
export type SourceConfig = SourcesFile["sources"][number];
export type SourceTransport = SourceConfig["transport"];

export type SourcesParseResult =
  { ok: true; value: SourceConfig[] } | { ok: false; problems: ConfigProblem[] };

/**
 * 設定ファイルの中身（文字列）を読んで検証する。
 * @param where 利用者に見せるファイルの名前（例：config/sources.json）
 */
export function parseSourcesFile(text: string, where: string): SourcesParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      problems: [{ where, path: "", message: `JSON として読めません（${reason}）` }],
    };
  }
  const parsed = SourcesFileSchema.safeParse(json, { error: japaneseErrorMap });
  if (!parsed.success) {
    return { ok: false, problems: problemsFromZod(where, parsed.error) };
  }
  return { ok: true, value: parsed.data.sources };
}
