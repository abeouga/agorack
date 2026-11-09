import type { Evidence } from "@agorack/contracts";

/**
 * どの根拠を選んでいるか。答えの表の行と、右の欄の根拠をつなぐ。
 * 表は Claude が書いた Markdown なので、行の文字と根拠のラベル・値を照らして対応を決める。
 */

/** 根拠を見分けるキー。同じ部品・記録・種類・ラベルなら同じ根拠とみなす */
export function evidenceKey(evidence: Evidence): string {
  return [evidence.sourceId, evidence.recordId, evidence.kind, evidence.label].join("\u0000");
}

/** 根拠の値を、人が読める文字にする。空欄は null で返す */
export function valueText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** ラベルに含まれるかで照らす欄の最短の長さ。「1」のような短い欄で取り違えないため */
const MIN_LABEL_MATCH = 2;

const normalize = (text: string) => text.replace(/\s+/g, "").normalize("NFKC");

/**
 * 表の1行に対応する根拠。
 * 行のどれかの欄が根拠の値と同じで、ほかの欄のどれかが根拠のラベルか記録の ID に含まれるものを選ぶ。
 * （例：行「繁殖台帳1021 | はじめ | 黒」と、根拠「繁殖台帳1021「はじめ」の毛色」＝黒）
 */
export function evidenceForRow(cells: string[], evidence: Evidence[]): Evidence[] {
  const texts = cells.map(normalize);
  return evidence.filter((item) => {
    const value = valueText(item.value);
    if (value === null) return false;
    const valueAt = texts.indexOf(normalize(value));
    if (valueAt < 0) return false;
    const label = normalize(item.label);
    const recordId = normalize(item.recordId);
    return texts.some(
      (text, index) =>
        index !== valueAt &&
        (recordId === text || (text.length >= MIN_LABEL_MATCH && label.includes(text))),
    );
  });
}

/**
 * 右の欄に出す根拠：ホバーしているもの → 選んだもの → 最初のもの の順。
 * キーが答えの根拠にないとき（別の答えのキーが残っているなど）は次へ進む。
 */
export function focusedEvidence(
  evidence: readonly Evidence[],
  hovered: readonly string[],
  selected: readonly string[],
): Evidence | null {
  for (const key of [...hovered, ...selected]) {
    const found = evidence.find((item) => evidenceKey(item) === key);
    if (found) return found;
  }
  return evidence[0] ?? null;
}
