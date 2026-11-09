import type { SourceInstructions } from "./ports.js";

/** Agorack の共通の指示（設計 §3 の守る約束）。部品ごとの使い方は、部品の説明に任せる。 */
export const AGORACK_INSTRUCTIONS = `あなたは Agorack です。業務の部品（つながっている MCP サーバー）の道具を使い、利用者の質問に根拠付きで答えます。

守ること：
1. 値を作らない。答えに使う値は、部品の道具が返したものだけにする。推測で埋めたり、言い換えたりしない。数の計算は自分でせず、部品の道具に任せる。
2. 根拠を必ず示す。答えには、どの部品の、どの記録のどこから取った値かを添える。
3. 値を直さない。値が違いそうなときは、部品の画面で確かめるよう利用者に勧める。
4. 道具で分からないことは、分からないと答える。名前が1つに決まらないなど、利用者に確かめるべきことは聞き返す。
5. 答えは日本語で、短く書く。`;

/** つながっていない部品があるときに足す指示の頭 */
export const UNAVAILABLE_SOURCES_HEADING = "## いまつながっていない部品";

const UNAVAILABLE_SOURCES_GUIDE =
  "次の部品にはつながっていないため、その部品の道具は使えません。この部品が持つ記録についての質問には、どの部品につながっていないかと理由を伝え、推測で答えないでください。部品が動いているか確かめてから、もう一度質問するよう勧めてください。";

/**
 * 共通の指示に、部品ごとの指示を足す（設計 §5）。
 * - つながっている部品：部品の説明を、部品の名前を付けて足す。説明のない部品は足さない
 * - つながっていない部品：名前と理由をまとめて足す
 */
export function buildSystemPrompt(common: string, sources: readonly SourceInstructions[]): string {
  const parts: string[] = [];
  for (const source of sources) {
    if (source.status !== "connected") continue;
    const instructions = source.instructions?.trim();
    if (!instructions) continue;
    parts.push(`## 部品「${source.name}」（${source.sourceId}）の説明\n\n${instructions}`);
  }

  const unavailable = sources.flatMap((source) =>
    source.status === "unavailable"
      ? [`- ${source.name}（${source.sourceId}）：${oneLine(source.reason)}`]
      : [],
  );
  if (unavailable.length > 0) {
    parts.push(
      [UNAVAILABLE_SOURCES_HEADING, UNAVAILABLE_SOURCES_GUIDE, unavailable.join("\n")].join("\n\n"),
    );
  }

  return [common.trim(), ...parts].join("\n\n");
}

/** 理由の改行をつぶして1行にする（箇条書きが崩れないように） */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim() || "理由は分かりません";
}
