import {
  type Evidence,
  HIGHLIGHT_FIELD_IDS_MAX,
  HIGHLIGHT_FIELD_ID_MAX_LENGTH,
} from "@agorack/contracts";
import { MOCK_EMBED_ORIGIN } from "./embed-origin";
import { koyomiFields, koyomiPrices } from "./evidence";

/**
 * 偽の埋め込み用の画面（文之助の /embed?job=…&field=… の代わり）。偽のサーバーと別の住所で配る。
 * 文之助の埋め込み用の画面と同じく、ページ画像に欄の枠を描き、postMessage に答える。
 * - 親 → 画面：agorack:highlight（読み直さずに枠を移す。fieldIds があれば、その欄をまとめて薄く囲む。
 *   fieldIds が契約に合わない（500 個を超える・1〜200 文字の文字列でない）ときは、メッセージごと捨てる）
 * - 画面 → 親：embed:ready（画像を出した）・embed:error（DOCUMENT_NOT_FOUND・FIELD_NOT_FOUND）・
 *   embed:close（右上の × を押した）
 * - mock=silent を付けると何も送らない（部品が止まっているときの、時間切れを試す）
 * 中身は見本で、文之助の画面の仕様ではない。
 */

/** 埋め込みを許す住所（開発の画面と、スクショを撮るときの画面） */
const ALLOWED_PARENTS = ["http://127.0.0.1:5174", "http://127.0.0.1:5199"];

type PageField = { label: string; value: unknown; box: unknown };
type PageRecord = { title: string; imageUrl: string; fields: Record<string, PageField> };

/** 偽のサーバーの根拠から、記録（書類）ごとの欄と枠の一覧を作る */
function recordsOf(evidence: Evidence[]): Map<string, PageRecord> {
  const records = new Map<string, PageRecord>();
  for (const item of evidence) {
    const location = item.location;
    const fieldId = location.field_id;
    if (typeof fieldId !== "string" || typeof location.image_url !== "string") continue;
    const record = records.get(item.recordId) ?? {
      title: `${String(location.template_name)}「${String(location.document_name)}」`,
      imageUrl: location.image_url,
      fields: {},
    };
    record.fields[fieldId] = { label: item.label, value: item.value, box: location.box };
    records.set(item.recordId, record);
  }
  return records;
}

const records = recordsOf([...koyomiPrices, ...koyomiFields]);

export type EmbedResponse = { status: number; headers: Record<string, string>; body: string };

export function renderEmbedPage(requestUrl: string): EmbedResponse {
  const url = new URL(requestUrl, MOCK_EMBED_ORIGIN);
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `frame-ancestors ${ALLOWED_PARENTS.join(" ")}`,
    "Cache-Control": "no-store",
  };
  if (url.pathname !== "/embed") return { status: 404, headers, body: "見つかりません" };
  const job = url.searchParams.get("job") ?? "";
  const data = {
    record: records.get(job) ?? null,
    field: url.searchParams.get("field"),
    silent: url.searchParams.get("mock") === "silent",
    allowed: ALLOWED_PARENTS,
    limits: { ids: HIGHLIGHT_FIELD_IDS_MAX, length: HIGHLIGHT_FIELD_ID_MAX_LENGTH },
  };
  // </script> で閉じられないよう < を逃がす
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return { status: 200, headers, body: page(json) };
}

function page(json: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>偽の埋め込み用の画面</title>
<style>
  :root { font-family: "Yu Gothic UI", "Meiryo", system-ui, sans-serif; color: #172431; }
  body { margin: 0; display: flex; flex-direction: column; height: 100vh; background: #f5f7f9; }
  header { display: flex; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #cbd5de; background: #fff; font-size: 13px; }
  header b { font-size: 14px; }
  header button { min-width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: #5f6f7d; font-size: 18px; cursor: pointer; }
  header button:hover { background: #e6edf4; }
  .mark { position: absolute; border: 2px solid #d9480fcc; background: #ffb02e2e; pointer-events: none; }
  header small { color: #5f6f7d; }
  .stage-wrap { flex: 1; min-height: 0; overflow: auto; padding: 10px; background: #dfe5ea; }
  .stage { position: relative; width: 200%; background: #fff; box-shadow: 0 2px 10px #1d354533; }
  .stage img { display: block; width: 100%; height: auto; }
  #box { position: absolute; display: none; border: 3px solid #2f9e44; background: #40c05733; box-shadow: 0 0 0 3px #fff9, 0 0 0 6px #2f9e4455; transition: all .2s; }
  footer { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; padding: 8px 12px; border-top: 1px solid #cbd5de; background: #fff; font-size: 13px; }
  footer strong { font-size: 17px; }
  footer small { margin-left: auto; color: #5f6f7d; }
  .missing { margin: 24px; color: #9f352d; }
</style>
</head>
<body>
<header><span><b>偽の埋め込み用の画面</b> <span id="title"></span></span><span><small id="opened"></small> <button type="button" id="close" aria-label="閉じる" title="閉じる">×</button></span></header>
<div class="stage-wrap" id="wrap"><div class="stage" id="stage"><img id="page" alt="ページ画像"><div id="marks"></div><div id="box"></div></div></div>
<footer><span id="label"></span><strong id="value"></strong><small id="count"></small></footer>
<script>
const DATA = ${json};
const opened = new Date();
document.getElementById("opened").textContent = "開いた時刻 " + opened.toLocaleTimeString("ja-JP");
let highlights = 0;
let size = null;
const ancestor = location.ancestorOrigins && location.ancestorOrigins[0];
const referrer = document.referrer ? new URL(document.referrer).origin : null;
const parentOrigin = [ancestor, referrer].find((origin) => origin && DATA.allowed.includes(origin)) || null;
const send = (message) => {
  if (DATA.silent || !parentOrigin) return;
  window.parent.postMessage(message, parentOrigin);
};
document.getElementById("close").addEventListener("click", () => send({ type: "embed:close" }));
// 根拠の欄の全部（fieldIds）。届くまでは選んだ欄だけ
let marked = [];
const place = (element, b) => {
  element.style.left = (b.x / size.width) * 100 + "%";
  element.style.top = (b.y / size.height) * 100 + "%";
  element.style.width = (b.width / size.width) * 100 + "%";
  element.style.height = (b.height / size.height) * 100 + "%";
};
const showMarks = () => {
  const marks = document.getElementById("marks");
  marks.replaceChildren();
  if (!size) return;
  for (const id of marked) {
    const field = DATA.record.fields[id];
    if (!field) continue;
    const mark = document.createElement("div");
    mark.className = "mark";
    place(mark, field.box);
    marks.append(mark);
  }
};
const validIds = (ids) =>
  Array.isArray(ids) &&
  ids.length <= DATA.limits.ids &&
  ids.every((id) => typeof id === "string" && id.length >= 1 && id.length <= DATA.limits.length);
const showCount = () => {
  document.getElementById("count").textContent = "強調を替えた回数 " + highlights + "（画面は読み直していません）";
};
const show = (fieldId) => {
  const field = fieldId ? DATA.record.fields[fieldId] : null;
  const box = document.getElementById("box");
  if (!field) {
    box.style.display = "none";
    if (fieldId) send({ type: "embed:error", code: "FIELD_NOT_FOUND" });
    return;
  }
  document.getElementById("label").textContent = field.label;
  document.getElementById("value").textContent = field.value ?? "（空欄）";
  if (!size) return;
  box.style.display = "block";
  place(box, field.box);
  setTimeout(() => box.scrollIntoView({ block: "center", inline: "center" }), 220);
};
let current = DATA.field;
if (!DATA.record) {
  document.getElementById("wrap").innerHTML = '<p class="missing">この書類は見つかりません。</p>';
  send({ type: "embed:error", code: "DOCUMENT_NOT_FOUND" });
} else {
  document.getElementById("title").textContent = DATA.record.title;
  const image = document.getElementById("page");
  image.onload = () => {
    size = { width: image.naturalWidth, height: image.naturalHeight };
    show(current);
    showCount();
    send({ type: "embed:ready" });
  };
  image.onerror = () => send({ type: "embed:error", code: "LOAD_FAILED" });
  image.src = DATA.record.imageUrl;
}
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  const data = event.data;
  if (!data || data.type !== "agorack:highlight" || typeof data.fieldId !== "string") return;
  // 決まりに合わない fieldIds は、メッセージごと捨てる（一部だけを使わない）
  if (data.fieldIds !== undefined && !validIds(data.fieldIds)) return;
  highlights += 1;
  current = data.fieldId;
  marked = data.fieldIds ?? [];
  showMarks();
  show(current);
  showCount();
});
</script>
</body>
</html>
`;
}
