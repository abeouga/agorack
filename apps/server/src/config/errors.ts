import { z } from "zod";

/**
 * 設定が足りない・形が違うときのエラー。
 * 文章には、どの設定のどの項目が悪いかを日本語で並べる。値（API キーなど）は文章に入れない。
 */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** 設定の問題1件 */
export type ConfigProblem = {
  /** どの設定か（例：環境変数、config/sources.json） */
  where: string;
  /** どの項目か（例：SERVER_PORT、sources[0].transport.command）。設定全体のときは空 */
  path: string;
  message: string;
};

/** zod の検証で、項目に自前の文章がないときに使う日本語の文章 */
export const japaneseErrorMap = z.locales.ja().localeError;

/** zod のパスを `sources[0].transport.command` の形にする */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") {
      out += `[${key}]`;
    } else {
      const name = String(key);
      out += out === "" ? name : `.${name}`;
    }
  }
  return out;
}

export function problemsFromZod(where: string, error: z.ZodError): ConfigProblem[] {
  return error.issues.map((issue) => ({
    where,
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/** 問題の一覧を、利用者が直す場所の分かる文章にまとめる */
export function configErrorFrom(problems: readonly ConfigProblem[]): ConfigError {
  const groups = new Map<string, ConfigProblem[]>();
  for (const problem of problems) {
    const list = groups.get(problem.where) ?? [];
    list.push(problem);
    groups.set(problem.where, list);
  }
  const lines = ["設定に誤りがあるため、サーバーを起動できません。"];
  for (const [where, list] of groups) {
    lines.push(`${where}：`);
    for (const problem of list) {
      lines.push(
        problem.path === "" ? `  - ${problem.message}` : `  - ${problem.path}：${problem.message}`,
      );
    }
  }
  return new ConfigError(lines.join("\n"));
}
