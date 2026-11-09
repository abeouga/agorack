import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { ENV_WHERE, parseEnv, type EnvConfig } from "./env.js";
import { ConfigError, configErrorFrom, type ConfigProblem } from "./errors.js";
import { parseSourcesFile, type SourceConfig } from "./sources.js";

export { ConfigError } from "./errors.js";
export type { Effort } from "./env.js";
export type { SourceConfig, SourceTransport } from "./sources.js";

/**
 * 画面の開発時の住所（Vite）。この住所からの要求だけを受け付ける（設計 §9）。
 * 画面は 5174 に固定する（設計 §7.4）。部品の画面と同じく 127.0.0.1 と localhost の両方を許す。
 */
export const WEB_DEV_ORIGINS = ["http://127.0.0.1:5174", "http://localhost:5174"] as const;

/** 部品の設定ファイルの既定の場所（リポジトリの根からの相対） */
export const DEFAULT_SOURCES_CONFIG_PATH = "config/sources.json";

export type AppConfig = {
  server: EnvConfig["server"] & {
    /** 要求を受け付ける画面の住所（origin） */
    allowedOrigins: readonly string[];
  };
  anthropic: EnvConfig["anthropic"];
  agent: EnvConfig["agent"];
  sources: {
    /** 読んだ設定ファイルの絶対パス */
    path: string;
    list: SourceConfig[];
  };
};

export type LoadConfigOptions = {
  env: Readonly<Record<string, string | undefined>>;
  /** リポジトリの根。相対で書いた設定ファイルの場所は、ここから数える */
  repoRoot: string;
};

/**
 * 環境変数と部品の設定ファイルを読み、検証する。
 * 足りない・形が違う項目があれば、全部をまとめて ConfigError で止める。
 */
export function loadConfig({ env, repoRoot }: LoadConfigOptions): AppConfig {
  const problems: ConfigProblem[] = [];

  const envResult = parseEnv(env);
  if (!envResult.ok) problems.push(...envResult.problems);

  const configured = envResult.ok ? envResult.value.sourcesConfigPath : null;
  const sourcesPath = resolve(repoRoot, configured ?? DEFAULT_SOURCES_CONFIG_PATH);
  const shownPath = displayPath(repoRoot, sourcesPath);

  let sources: SourceConfig[] = [];
  const text = readSourcesText(sourcesPath, shownPath, problems);
  if (text !== null) {
    const sourcesResult = parseSourcesFile(text, shownPath);
    if (sourcesResult.ok) sources = sourcesResult.value;
    else problems.push(...sourcesResult.problems);
  }

  if (!envResult.ok || problems.length > 0) throw configErrorFrom(problems);

  const { server, anthropic, agent } = envResult.value;
  return {
    server: { ...server, allowedOrigins: WEB_DEV_ORIGINS },
    anthropic,
    agent,
    sources: { path: sourcesPath, list: sources },
  };
}

function readSourcesText(path: string, shownPath: string, problems: ConfigProblem[]) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    problems.push({
      where: shownPath,
      path: "",
      message:
        code === "ENOENT"
          ? "ファイルがありません。config/sources.example.json を写して作り、手元の部品の場所に合わせてください（場所を替えるときは SOURCES_CONFIG_PATH）"
          : `ファイルを読めません（${code ?? String(error)}）`,
    });
    return null;
  }
}

/** リポジトリの中のファイルは相対で見せる */
function displayPath(repoRoot: string, path: string): string {
  const rel = relative(repoRoot, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : path;
}

/**
 * Claude を呼ぶ前に API キーを確かめる。キーがなくてもサーバーは起動でき（health・部品の接続・
 * 画面の開発は Claude を使わないため）、Claude を使うときにこの文章で失敗する。キーの値は文章に入れない。
 */
export function requireAnthropicApiKey(anthropic: AppConfig["anthropic"]): string {
  if (anthropic.apiKey === null) {
    throw new ConfigError(
      `${ENV_WHERE} に ANTHROPIC_API_KEY がないため、Claude を呼べません。apps/server/.env に書いて、サーバーを起動し直してください。`,
    );
  }
  return anthropic.apiKey;
}
