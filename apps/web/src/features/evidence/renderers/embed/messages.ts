import { type EmbedToAgorackMessage, EmbedToAgorackMessageSchema } from "@agorack/contracts";

/**
 * 部品の埋め込み用の画面から届いたメッセージを確かめる（設計 §7.4）。
 * この iframe から（source）、許した住所から（origin）届き、形が契約に合うものだけを返す。どれかが違えば null。
 */
export function readEmbedMessage(
  event: { source: unknown; origin: string; data: unknown },
  expected: { source: unknown; origin: string },
): EmbedToAgorackMessage | null {
  if (expected.source === null || expected.source === undefined) return null;
  if (event.source !== expected.source || event.origin !== expected.origin) return null;
  const parsed = EmbedToAgorackMessageSchema.safeParse(event.data);
  return parsed.success ? parsed.data : null;
}
