import type { Evidence } from "@agorack/contracts";
import { describe, expect, it } from "vitest";
import { evidenceForRow, evidenceKey, focusedEvidence, valueText } from "./selection";

const evidence = (no: number, name: string, value: unknown): Evidence => ({
  kind: "document",
  sourceId: "fuminosuke",
  recordId: `job-${no}`,
  label: `繁殖台帳${no}「${name}」の毛色`,
  location: {},
  value,
  embedUrl: null,
});

const hajime = evidence(1021, "はじめ", "黒");
const koyomi = evidence(1034, "こよみ", "黒");
const sakura = evidence(1052, "さくら", "褐");
const all = [hajime, koyomi, sakura];

describe("表の行と根拠の対応", () => {
  it("値が同じで、ほかの欄がラベルに含まれる根拠を選ぶ", () => {
    expect(evidenceForRow(["繁殖台帳1021", "はじめ", "黒"], all)).toEqual([hajime]);
    expect(evidenceForRow(["こよみ", "黒"], all)).toEqual([koyomi]);
  });

  it("記録の ID が欄にあれば選ぶ", () => {
    expect(evidenceForRow(["job-1052", "褐"], all)).toEqual([sakura]);
  });

  it("値が違えば選ばない", () => {
    expect(evidenceForRow(["はじめ", "褐"], all)).toEqual([]);
  });

  it("値しか合わず、同じ値の根拠が2つ以上ある行（合計など）は選ばない", () => {
    expect(evidenceForRow(["合計", "黒"], all)).toEqual([]);
  });

  it("同じ値の根拠が1つしかなければ、値だけで選ぶ（行の番号だけを書いた表）", () => {
    const price = (row: number, value: string): Evidence => ({
      ...evidence(1034, "こよみ", value),
      label: `繁殖台帳1034「こよみ」の売却子牛一覧 ${row}行目の価格`,
    });
    const prices = [price(2, "540,000"), price(3, "770,000")];
    expect(evidenceForRow(["2", "540,000"], prices)).toEqual([prices[0]]);
    expect(evidenceForRow(["3", "770,000"], prices)).toEqual([prices[1]]);
    expect(evidenceForRow(["合計", "1,310,000"], prices)).toEqual([]);
  });

  it("行のほかの欄が別の根拠を指していれば、値だけでは選ばない", () => {
    // 褐はさくらだけだが、行は「はじめ」を指している
    expect(evidenceForRow(["はじめ", "褐"], all)).toEqual([]);
  });

  it("1文字の欄では照らさない（取り違えを防ぐ）", () => {
    expect(evidenceForRow(["1", "黒"], all)).toEqual([]);
  });

  it("空白と全角・半角の違いは無視する", () => {
    expect(evidenceForRow(["繁殖台帳 １０２１", "黒"], all)).toEqual([hajime]);
  });

  it("数の値も文字にして照らす。空欄の根拠は選ばない", () => {
    const weight = { ...evidence(1021, "はじめ", 512), label: "繁殖台帳1021「はじめ」の体重" };
    const empty = { ...evidence(1034, "こよみ", null), label: "繁殖台帳1034「こよみ」の体重" };
    expect(evidenceForRow(["はじめ", "512"], [weight, empty])).toEqual([weight]);
    expect(evidenceForRow(["こよみ", ""], [weight, empty])).toEqual([]);
  });
});

describe("根拠の見分けと値", () => {
  it("同じ部品・記録・種類・ラベルなら同じキー", () => {
    expect(evidenceKey(hajime)).toBe(evidenceKey({ ...hajime, value: "褐" }));
    expect(evidenceKey(hajime)).not.toBe(evidenceKey(koyomi));
  });

  it.each([
    [null, null],
    ["", null],
    ["黒", "黒"],
    [512, "512"],
    [true, "true"],
    [{ a: 1 }, '{"a":1}'],
  ])("%j を %j にする", (value, text) => {
    expect(valueText(value)).toBe(text);
  });
});

describe("右の欄に出す根拠", () => {
  it("ホバー → 選んだもの → 最初のもの の順に選ぶ", () => {
    expect(focusedEvidence(all, [], [])).toBe(hajime);
    expect(focusedEvidence(all, [], [evidenceKey(sakura)])).toBe(sakura);
    expect(focusedEvidence(all, [evidenceKey(koyomi)], [evidenceKey(sakura)])).toBe(koyomi);
  });

  it("答えにないキーは飛ばす。根拠がなければ null", () => {
    expect(focusedEvidence(all, ["ない"], [evidenceKey(sakura)])).toBe(sakura);
    expect(focusedEvidence([], [], [])).toBeNull();
  });
});

describe("答えの文章から最初に出す根拠", () => {
  const price = (row: number, value: string): Evidence => ({
    ...evidence(1034, "こよみ", value),
    label: `繁殖台帳1034「こよみ」の売却子牛一覧 ${row}行目の価格`,
  });
  const prices = [price(2, "540,000"), price(5, "826,100"), price(8, "708,400")];

  it("答えに値が出てくる根拠を、最初のものより先に出す", () => {
    expect(focusedEvidence(prices, [], [], "いちばん高い価格は826,100です。")).toBe(prices[1]);
  });

  it("ホバー・選んだものは、答えの文章より先", () => {
    const key = evidenceKey(prices[2] as Evidence);
    expect(focusedEvidence(prices, [], [key], "826,100")).toBe(prices[2]);
  });

  it("太字の中に値が出てくる根拠を、文章のほかの所に出てくるものより先に出す", () => {
    const name = { ...evidence(1034, "こよみ", "こよみ"), label: "繁殖台帳1034「こよみ」の名号" };
    const coat = { ...evidence(1034, "こよみ", "褐"), label: "繁殖台帳1034「こよみ」の毛色" };
    expect(focusedEvidence([name, coat], [], [], "こよみの毛色は **褐** です。")).toBe(coat);
    expect(focusedEvidence([name, coat], [], [], "こよみの毛色は褐です。")).toBe(name);
  });

  it("どれの値も出てこなければ最初のもの", () => {
    expect(focusedEvidence(prices, [], [], "合計は 3,074,500 です。")).toBe(prices[0]);
  });
});
