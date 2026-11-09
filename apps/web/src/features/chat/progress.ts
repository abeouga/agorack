import type { ToolCall } from "./state/conversation";

/**
 * 道具の呼び出しの進み具合の文章（例：文之助で書類を探しています）。
 * 道具の名前から「何をしているか」を引く表示用の辞書。載っていない道具も「〇〇を使っています」で出す。
 */
const ACTIVITY: Record<string, string> = {
  search_documents: "書類を探しています",
  get_document: "書類を読んでいます",
  aggregate: "値を集計しています",
  list_templates: "書類の種類を確かめています",
  get_template_fields: "欄の名前を確かめています",
  get_field_image: "欄の画像を取り出しています",
};

export function activityOf(tool: string): string {
  return ACTIVITY[tool] ?? `「${tool}」を使っています`;
}

/** 呼び出し1回の文章。終わったら道具の要約を出す */
export function progressText(call: ToolCall, sourceName: string): string {
  switch (call.status) {
    case "running":
      return `${sourceName}で${activityOf(call.tool)}`;
    case "succeeded":
      return `${sourceName}：${call.summary || "終わりました"}`;
    case "failed":
      return `${sourceName}：${call.summary || "失敗しました"}`;
    case "cancelled":
      return `${sourceName}：途中で止めました`;
  }
}
