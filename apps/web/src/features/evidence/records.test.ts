import type { Evidence } from "@agorack/contracts";
import { describe, expect, it } from "vitest";
import { groupByRecord, labelInRecord } from "./records";

const evidence = (recordId: string, label: string, sourceId = "fuminosuke"): Evidence => ({
  kind: "document",
  sourceId,
  recordId,
  label,
  location: {},
  value: "黒",
  embedUrl: null,
});

describe("根拠を記録ごとにまとめる", () => {
  it("同じ部品の同じ記録の根拠を1つにまとめ、最初に出てきた順に並べる", () => {
    const a1 = evidence("job-a", "繁殖台帳1021「はじめ」の毛色");
    const b1 = evidence("job-b", "繁殖台帳1034「こよみ」の毛色");
    const a2 = evidence("job-a", "繁殖台帳1021「はじめ」の生年月日");
    const records = groupByRecord([a1, b1, a2]);
    expect(records.map((record) => record.items)).toEqual([[a1, a2], [b1]]);
    expect(records.map((record) => record.title)).toEqual([
      "繁殖台帳1021「はじめ」",
      "繁殖台帳1034「こよみ」",
    ]);
  });

  it("部品が違えば、記録の ID が同じでも別の記録にする", () => {
    const records = groupByRecord([
      evidence("1", "走行「朝」の距離", "kabulogger"),
      evidence("1", "繁殖台帳1021「はじめ」の毛色"),
    ]);
    expect(records).toHaveLength(2);
  });

  it("「」のないラベルは、共通する頭（1つなら最後の「の」の前）を名前にする", () => {
    expect(
      groupByRecord([evidence("r", "朝の走行 距離"), evidence("r", "朝の走行 時間")])[0]?.title,
    ).toBe("朝の走行");
    expect(groupByRecord([evidence("r", "朝の走行の距離")])[0]?.title).toBe("朝の走行");
  });

  it("名前を作れなければ記録の ID にする", () => {
    expect(groupByRecord([evidence("job-x", "距離")])[0]?.title).toBe("job-x");
  });
});

describe("記録の中のラベル", () => {
  it("記録の名前と、続く「の」を除く", () => {
    const item = evidence("job-a", "繁殖台帳1034「こよみ」の売却子牛一覧 2行目の価格");
    expect(labelInRecord(item, "繁殖台帳1034「こよみ」")).toBe("売却子牛一覧 2行目の価格");
  });

  it("名前で始まらない・除くと空になるときは、そのまま返す", () => {
    const item = evidence("job-a", "繁殖台帳1034「こよみ」");
    expect(labelInRecord(item, "繁殖台帳1034「こよみ」")).toBe("繁殖台帳1034「こよみ」");
    expect(labelInRecord(item, "走行")).toBe("繁殖台帳1034「こよみ」");
  });
});
