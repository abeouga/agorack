import type { Evidence } from "@agorack/contracts";

/**
 * 根拠を、どの記録（書類・走行など）のものかでまとめる。答えの下の一覧で、記録を切り替えるのに使う。
 * 記録は「部品と記録の ID」で見分ける。`location` は部品ごとに違うので読まず、名前はラベルから作る。
 */

export type EvidenceRecord = {
  /** 記録を見分けるキー */
  key: string;
  /** 人が読める記録の名前（例：繁殖台帳1021「こよみ」） */
  title: string;
  /** その記録の根拠（答えの根拠の順のまま） */
  items: Evidence[];
};

/** 根拠の記録のキー。同じ部品の同じ記録の ID なら同じ記録 */
export function recordKey(evidence: Evidence): string {
  return [evidence.sourceId, evidence.recordId].join("\u0000");
}

/** 根拠を記録ごとにまとめる。記録の順は、その記録の根拠が最初に出てくる順 */
export function groupByRecord(evidence: readonly Evidence[]): EvidenceRecord[] {
  const records = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const key = recordKey(item);
    const items = records.get(key);
    if (items) items.push(item);
    else records.set(key, [item]);
  }
  return [...records].map(([key, items]) => ({ key, title: recordTitle(items), items }));
}

/**
 * 記録の名前：根拠のラベルに共通する頭から作る。
 * 「」で記録の名前を囲んだラベル（例：繁殖台帳1021「こよみ」の毛色）は、最後の 」 までにする。
 * 囲みがなければ、最後の「の」の前までにする。どちらも取れなければ記録の ID にする。
 */
function recordTitle(items: readonly Evidence[]): string {
  const first = items[0];
  if (!first) return "";
  const labels = items.map((item) => item.label);
  const head = labels.length > 1 ? commonPrefix(labels) : first.label;
  const closed = head.lastIndexOf("」");
  if (closed >= 0) return head.slice(0, closed + 1);
  const cut = labels.length > 1 ? head : head.slice(0, Math.max(head.lastIndexOf("の"), 0));
  const title = cut.replace(/[\sの]+$/u, "");
  return title || first.recordId;
}

function commonPrefix(texts: readonly string[]): string {
  const [first = "", ...rest] = texts;
  let length = first.length;
  for (const text of rest) {
    let i = 0;
    while (i < length && i < text.length && text[i] === first[i]) i += 1;
    length = i;
  }
  return first.slice(0, length);
}

/**
 * 記録の名前を除いたラベル（例：「繁殖台帳1021「こよみ」の毛色」→「毛色」）。記録の中の一覧で、欄の名前として出す。
 * 名前で始まらないとき・除くと空になるときは、ラベルをそのまま返す。
 */
export function labelInRecord(evidence: Evidence, title: string): string {
  if (!title || !evidence.label.startsWith(title)) return evidence.label;
  const rest = evidence.label.slice(title.length).replace(/^[\sの]+/u, "");
  return rest || evidence.label;
}
