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
 * 1. 行のどれかの欄が根拠の値と同じで、ほかの欄のどれかが根拠のラベルか記録の ID に含まれるものを選ぶ
 *    （例：行「繁殖台帳1021 | はじめ | 黒」と、根拠「繁殖台帳1021「はじめ」の毛色」＝黒）
 * 2. 1で選べず、値が同じ根拠が答えの中に1つしかなく、行のほかの欄が別の根拠を指していなければ、それを選ぶ
 *    （例：行「2 | 540,000」と、価格が 540,000 の根拠。Claude は行の番号だけを書くことがある）
 * 値が同じ根拠が2つ以上あってラベルでも決まらないとき（「合計 | 黒」など）は選ばない。
 */
export function evidenceForRow(cells: string[], evidence: Evidence[]): Evidence[] {
  const texts = cells.map(normalize);
  const sameValue = evidence.flatMap((item) => {
    const value = valueText(item.value);
    const valueAt = value === null ? -1 : texts.indexOf(normalize(value));
    return valueAt < 0 ? [] : [{ item, valueAt }];
  });
  const labelled = sameValue.filter(({ item, valueAt }) => {
    const label = normalize(item.label);
    const recordId = normalize(item.recordId);
    return texts.some(
      (text, index) =>
        index !== valueAt &&
        (recordId === text || (text.length >= MIN_LABEL_MATCH && label.includes(text))),
    );
  });
  if (labelled.length > 0) return labelled.map(({ item }) => item);
  const only = sameValue.length === 1 ? sameValue[0] : undefined;
  if (!only) return [];
  // 行のほかの欄が、答えの中の別の根拠のラベルに含まれるなら、その行は別のものを指している
  const namesOther = texts.some(
    (text, index) =>
      index !== only.valueAt &&
      text.length >= MIN_LABEL_MATCH &&
      evidence.some((item) => item !== only.item && normalize(item.label).includes(text)),
  );
  return namesOther ? [] : [only.item];
}

/**
 * 右の欄に出す根拠：ホバーしているもの → 選んだもの → 答えの文章に値が出てくるもの → 最初のもの の順。
 * キーが答えの根拠にないとき（別の答えのキーが残っているなど）は次へ進む。
 * （例：「いちばん高い価格は 826,100」なら、7件の価格の根拠のうち 826,100 の欄を最初に出す）
 */
export function focusedEvidence(
  evidence: readonly Evidence[],
  hovered: readonly string[],
  selected: readonly string[],
  answer = "",
): Evidence | null {
  for (const key of [...hovered, ...selected]) {
    const found = evidence.find((item) => evidenceKey(item) === key);
    if (found) return found;
  }
  const text = normalize(answer);
  const mentioned = text
    ? evidence.find((item) => {
        const value = valueText(item.value);
        return value !== null && text.includes(normalize(value));
      })
    : undefined;
  return mentioned ?? evidence[0] ?? null;
}
