import { describe, expect, it } from "vitest";
import { SPLIT_DEFAULT, clampSplit, readSplit, writeSplit } from "./split";

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

describe("チャットと右の欄の幅の分け方", () => {
  it("チャットの割合は 25〜75% に収める", () => {
    expect(clampSplit(0.1)).toBe(0.25);
    expect(clampSplit(0.9)).toBe(0.75);
    expect(clampSplit(0.6)).toBe(0.6);
    expect(clampSplit(Number.NaN)).toBe(SPLIT_DEFAULT);
  });

  it("最初は 50%、覚えた割合は読み直しても残る", () => {
    const storage = memory();
    expect(readSplit(storage)).toBe(0.5);
    writeSplit(storage, 0.62);
    expect(readSplit(storage)).toBe(0.62);
  });

  it.each([
    ["数でない", "wide"],
    ["範囲の外", "0.9"],
    ["空", ""],
  ])("覚えた値が%sときは最初の値にする", (_name, stored) => {
    expect(readSplit(memory({ "agorack.evidenceSplit": stored }))).toBe(SPLIT_DEFAULT);
  });

  it("保存の領域が使えなくても壊れない", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readSplit(broken)).toBe(SPLIT_DEFAULT);
    expect(() => writeSplit(broken, 0.4)).not.toThrow();
    expect(readSplit(undefined)).toBe(SPLIT_DEFAULT);
  });
});
