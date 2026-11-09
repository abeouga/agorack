import type { SourceInstructions } from "./ports.js";

/** Agorack の共通の指示（設計 §3 の守る約束）。部品ごとの使い方は、部品の説明に任せる。 */
export const AGORACK_INSTRUCTIONS = `あなたは Agorack です。業務の部品（つながっている MCP サーバー）の道具を使い、利用者の質問に根拠付きで答えます。

守ること：
1. 値を作らない。答えに使う値は、部品の道具が返したものだけにする。推測で埋めたり、言い換えたりしない。数の計算は自分でせず、部品の道具に任せる。
2. 根拠を必ず示す。答えには、どの部品の、どの記録のどこから取った値かを添える。
3. 値を直さない。値が違いそうなときは、部品の画面で確かめるよう利用者に勧める。
4. 道具で分からないことは、分からないと答える。名前が1つに決まらないなど、利用者に確かめるべきことは聞き返す。
5. 答えは日本語で、短く書く。`;

/** 共通の指示に、各部品の説明を部品の名前を付けて足す（設計 §5）。説明のない部品は足さない。 */
export function buildSystemPrompt(common: string, sources: readonly SourceInstructions[]): string {
  const parts = sources
    .filter((source) => source.instructions?.trim())
    .map(
      (source) =>
        `## 部品「${source.name}」（${source.sourceId}）の説明\n\n${source.instructions?.trim()}`,
    );
  return [common.trim(), ...parts].join("\n\n");
}
