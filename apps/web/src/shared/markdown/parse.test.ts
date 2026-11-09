import { describe, expect, it } from "vitest";
import { parse, plainText, splitRow } from "./parse";

describe("Markdown の塊", () => {
  it("見出し・箇条書き・段落に分ける", () => {
    expect(parse("## 結果\n- はじめ\n- こよみ\n\n1. 一\n2. 二\n本文\n続き")).toEqual([
      { kind: "heading", level: 2, text: "結果" },
      { kind: "list", ordered: false, items: ["はじめ", "こよみ"] },
      { kind: "list", ordered: true, items: ["一", "二"] },
      { kind: "paragraph", lines: ["本文", "続き"] },
    ]);
  });

  it("表を読み、欄の数を見出しにそろえる", () => {
    const text = [
      "黒の牛：",
      "",
      "| 書類 | 名前 | 体重 |",
      "|:---|:---:|---:|",
      "| 繁殖台帳1021 | はじめ | 512 |",
      "| 繁殖台帳1034 | こよみ |",
      "",
      "以上です。",
    ].join("\n");
    expect(parse(text)).toEqual([
      { kind: "paragraph", lines: ["黒の牛："] },
      {
        kind: "table",
        header: ["書類", "名前", "体重"],
        align: ["left", "center", "right"],
        rows: [
          ["繁殖台帳1021", "はじめ", "512"],
          ["繁殖台帳1034", "こよみ", ""],
        ],
      },
      { kind: "paragraph", lines: ["以上です。"] },
    ]);
  });

  it("区切りの行がなければ表にしない（流れている途中の表も段落のまま）", () => {
    expect(parse("| 書類 | 名前 |")).toEqual([{ kind: "paragraph", lines: ["| 書類 | 名前 |"] }]);
  });

  it("前後の | を省いた表と、欄の中の \\| を読む", () => {
    expect(splitRow("a | b")).toEqual(["a", "b"]);
    expect(splitRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
    expect(parse("書類 | 値\n--- | ---\n台帳 | 黒")[0]).toMatchObject({
      kind: "table",
      rows: [["台帳", "黒"]],
    });
  });
});

it("印を除いた文字にする", () => {
  expect(plainText("**黒** と *褐* と `job-1` と \\*")).toBe("黒 と 褐 と job-1 と *");
});
