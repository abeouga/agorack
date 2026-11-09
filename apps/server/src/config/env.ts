import { z } from "zod";
import { japaneseErrorMap, problemsFromZod, type ConfigProblem } from "./errors.js";

/**
 * 環境変数（apps/server/.env）の検証（設計 §9）。
 * 空の値（`KEY=`）は「書いていない」と同じに扱い、既定の値を使う。
 */

/** 推論の深さ（Messages API の `output_config.effort`） */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/** 最初の版は手元の PC だけで動かすので、待ち受けるのはループバックの住所だけ（設計 §9） */
export const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"] as const;

export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 8787;
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
/** 会話の応答は速さを優先して effort を低めにする（設計 §5） */
export const DEFAULT_ANTHROPIC_EFFORT: Effort = "low";
/** ストリームで受けるので、答えが途中で切れないよう余裕を持たせる */
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 64000;
export const DEFAULT_AGENT_MAX_TOOL_CALLS = 20;

/** 環境変数の整数（10進の数字だけ）。範囲の外は止める */
function integerVar(min: number, max: number, fallback: number) {
  const message = `${min}〜${max} の整数にしてください`;
  return z
    .string()
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().int().min(min, message).max(max, message))
    .default(fallback);
}

const EnvSchema = z.object({
  SERVER_HOST: z
    .enum(LOOPBACK_HOSTS, {
      error: `手元だけで待ち受けるため、${LOOPBACK_HOSTS.join("・")} のどれかにしてください`,
    })
    .default(DEFAULT_SERVER_HOST),
  SERVER_PORT: integerVar(1, 65535, DEFAULT_SERVER_PORT),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default(DEFAULT_ANTHROPIC_MODEL),
  ANTHROPIC_EFFORT: z
    .enum(EFFORT_LEVELS, { error: `${EFFORT_LEVELS.join("・")} のどれかにしてください` })
    .default(DEFAULT_ANTHROPIC_EFFORT),
  ANTHROPIC_MAX_TOKENS: integerVar(1, 128000, DEFAULT_ANTHROPIC_MAX_TOKENS),
  AGENT_MAX_TOOL_CALLS: integerVar(1, 100, DEFAULT_AGENT_MAX_TOOL_CALLS),
  SOURCES_CONFIG_PATH: z.string().optional(),
});

export type EnvConfig = {
  server: { host: (typeof LOOPBACK_HOSTS)[number]; port: number };
  anthropic: {
    /** なくても起動はできる。Claude を呼ぶときに確かめる（requireAnthropicApiKey） */
    apiKey: string | null;
    model: string;
    effort: Effort;
    maxTokens: number;
  };
  agent: {
    /** 1ターンあたりの道具の呼び出しの回数の上限 */
    maxToolCalls: number;
  };
  /** 部品の設定ファイルの場所（書いていなければ null。既定の場所は loadConfig が決める） */
  sourcesConfigPath: string | null;
};

export type EnvParseResult =
  { ok: true; value: EnvConfig } | { ok: false; problems: ConfigProblem[] };

export const ENV_WHERE = "環境変数（apps/server/.env）";

/** 前後の空白を除き、空の値は書いていないものとして扱う */
function normalize(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const value = env[key]?.trim();
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

export function parseEnv(env: Readonly<Record<string, string | undefined>>): EnvParseResult {
  const parsed = EnvSchema.safeParse(normalize(env), { error: japaneseErrorMap });
  if (!parsed.success) {
    return { ok: false, problems: problemsFromZod(ENV_WHERE, parsed.error) };
  }
  const e = parsed.data;
  return {
    ok: true,
    value: {
      server: { host: e.SERVER_HOST, port: e.SERVER_PORT },
      anthropic: {
        apiKey: e.ANTHROPIC_API_KEY ?? null,
        model: e.ANTHROPIC_MODEL,
        effort: e.ANTHROPIC_EFFORT,
        maxTokens: e.ANTHROPIC_MAX_TOKENS,
      },
      agent: { maxToolCalls: e.AGENT_MAX_TOOL_CALLS },
      sourcesConfigPath: e.SOURCES_CONFIG_PATH ?? null,
    },
  };
}
