import type { Evidence } from "@agorack/contracts";
import { describe, expect, it } from "vitest";
import { evidenceForRow, evidenceKey, valueText } from "./selection";

const evidence = (no: number, name: string, value: unknown): Evidence => ({
  kind: "document",
  sourceId: "fuminosuke",
  recordId: `job-${no}`,
  label: `繁殖台帳${no}「${name}」の毛色`,
  location: {},
  value,
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

  it("値しか合わない行（合計など）は選ばない", () => {
    expect(evidenceForRow(["合計", "黒"], all)).toEqual([]);
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
