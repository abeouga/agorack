import { EvidenceSchema } from "@agorack/contracts";
import { describe, expect, it } from "vitest";
import { extractEvidence, mergeEvidence } from "./index.js";

import aggregateMax from "./__fixtures__/fuminosuke/aggregate_max.json" with { type: "json" };
import aggregateSum from "./__fixtures__/fuminosuke/aggregate_sum.json" with { type: "json" };
import errorNotFound from "./__fixtures__/fuminosuke/error_not_found.json" with { type: "json" };
import getDocument from "./__fixtures__/fuminosuke/get_document.json" with { type: "json" };
import listTemplates from "./__fixtures__/fuminosuke/list_templates.json" with { type: "json" };
import searchDocuments from "./__fixtures__/fuminosuke/search_documents.json" with { type: "json" };
import extractSource from "./extract.ts?raw";
import indexSource from "./index.ts?raw";

/** 文之助の MCP が実際に返した道具の結果（CallToolResult）。呼んだ道具と入力は calls.json にある。 */
const fuminosuke = {
  aggregate_max: aggregateMax,
  aggregate_sum: aggregateSum,
  error_not_found: errorNotFound,
  get_document: getDocument,
  list_templates: listTemplates,
  search_documents: searchDocuments,
} satisfies Record<string, { structuredContent: unknown }>;

/** 道具の結果の structuredContent を取り出す。 */
function structuredContentOf(name: keyof typeof fuminosuke): unknown {
  return fuminosuke[name].structuredContent;
}

const SOURCE = "fuminosuke";
const RECORD = "1d0c139e-5175-43d5-bba6-1d2b76d69977";

describe("実際の道具の結果から根拠を取り出す", () => {
  it("get_document：上の段と、入れ子の奥にある根拠をすべて取り出す", () => {
    const content = structuredContentOf("get_document");
    const { evidence, discarded } = extractEvidence(SOURCE, content);

    expect(discarded).toBe(0);
    // 上の段の26と、入れ子の奥の 7×7・9×4・0×4
    expect(evidence).toHaveLength(26 + 7 * 7 + 9 * 4);
    for (const item of evidence) {
      expect(EvidenceSchema.parse(item)).toEqual(item);
      expect(item).toMatchObject({ kind: "document", sourceId: SOURCE, recordId: RECORD });
    }
  });

  it("部品の source_id を recordId に名前を変え、location と value をそのまま運ぶ", () => {
    const { evidence } = extractEvidence(SOURCE, structuredContentOf("get_document"));
    const item = evidence.find((e) => e.label === "繁殖台帳1021「こよみ」の毛色");

    expect(item).toMatchObject({
      kind: "document",
      sourceId: SOURCE,
      recordId: RECORD,
      value: "褐",
      location: { box: { x: 411, y: 311, width: 256, height: 44 } },
    });
    expect(item).not.toHaveProperty("source_id");
  });

  it("値が null の根拠も、null のまま取り出す", () => {
    const { evidence } = extractEvidence(SOURCE, structuredContentOf("get_document"));

    expect(evidence.filter((e) => e.value === null)).toHaveLength(20);
  });

  it("aggregate（sum）：計算に使った値の根拠を取り出す", () => {
    const { evidence, discarded } = extractEvidence(SOURCE, structuredContentOf("aggregate_sum"));

    expect(discarded).toBe(0);
    expect(evidence).toHaveLength(7);
    expect(evidence.every((e) => e.recordId === RECORD)).toBe(true);
  });

  it("aggregate（max）：結果の中で2回出る同じ根拠は1つにまとめる", () => {
    const content = structuredContentOf("aggregate_max") as { used: unknown[]; at: unknown[] };
    const { evidence, discarded } = extractEvidence(SOURCE, content);

    expect(content.used).toHaveLength(7);
    expect(content.at).toHaveLength(1);
    expect(discarded).toBe(0);
    expect(evidence).toHaveLength(7);
  });

  it.each(["list_templates", "search_documents"] as const)(
    "根拠を持たない結果（%s）では空になる",
    (name) => {
      expect(extractEvidence(SOURCE, structuredContentOf(name))).toEqual({
        evidence: [],
        discarded: 0,
      });
    },
  );

  it("道具が失敗した結果（isError、structuredContent が null）でも投げずに空を返す", () => {
    expect(extractEvidence(SOURCE, structuredContentOf("error_not_found"))).toEqual({
      evidence: [],
      discarded: 0,
    });
    expect(extractEvidence(SOURCE, errorNotFound)).toEqual({ evidence: [], discarded: 0 });
  });
});

describe("部品ごとの決まりを知らない", () => {
  it.each([
    ["extract.ts", extractSource],
    ["index.ts", indexSource],
  ])("%s に、部品に固有の名前（欄・表・書類など）を使っていない", (_, source) => {
    expect(source).toContain("extractEvidence");
    expect(source).not.toMatch(/欄|表|書類|帳票|テンプレート|field|table|template|document/i);
  });
});

const envelope = {
  kind: "ride",
  source_id: "ride-7",
  label: "7月1日の走行",
  location: { from: 10, to: 20 },
  value: 12.5,
};

describe("取り出し方の決まり", () => {
  it("形の分からない入力でも投げずに空を返す", () => {
    for (const input of [undefined, null, 0, "text", true, [], {}]) {
      expect(extractEvidence(SOURCE, input)).toEqual({ evidence: [], discarded: 0 });
    }
  });

  it("入れ子・配列の奥にある根拠も探す", () => {
    const { evidence } = extractEvidence("kaburoger", {
      days: [{ rides: [[{ detail: envelope }]] }],
    });

    expect(evidence).toEqual([
      {
        kind: "ride",
        sourceId: "kaburoger",
        recordId: "ride-7",
        label: "7月1日の走行",
        location: { from: 10, to: 20 },
        value: 12.5,
      },
    ]);
  });

  it("根拠の外にある余分な項目は運ばない", () => {
    const { evidence } = extractEvidence(SOURCE, [{ ...envelope, status: "readable", note: "x" }]);

    expect(Object.keys(evidence[0] ?? {}).sort()).toEqual(
      ["kind", "label", "location", "recordId", "sourceId", "value"].sort(),
    );
  });

  it("value がなければ null にそろえる", () => {
    const withoutValue: Record<string, unknown> = { ...envelope };
    delete withoutValue.value;
    const { evidence } = extractEvidence(SOURCE, [withoutValue]);

    expect(evidence[0]?.value).toBeNull();
  });

  it("location のキーの順が違っても、同じ根拠は1つにまとめる", () => {
    const { evidence } = extractEvidence(SOURCE, [
      envelope,
      { ...envelope, location: { to: 20, from: 10 }, label: "別の説明" },
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.label).toBe("7月1日の走行");
  });

  it("記録・種類・位置のどれかが違えば別の根拠とみなす", () => {
    const { evidence } = extractEvidence(SOURCE, [
      envelope,
      { ...envelope, source_id: "ride-8" },
      { ...envelope, kind: "document" },
      { ...envelope, location: { from: 10, to: 21 } },
    ]);

    expect(evidence).toHaveLength(4);
  });

  it("部品が違えば、同じ記録でも別の根拠とみなす", () => {
    const first = extractEvidence("part_a", [envelope]).evidence;
    const second = extractEvidence("part_b", [envelope]).evidence;

    expect(first[0]).not.toEqual(second[0]);
  });

  it.each([
    ["kind が空", { ...envelope, kind: "" }],
    ["source_id が文字列でない", { ...envelope, source_id: 7 }],
    ["label が空", { ...envelope, label: "" }],
    ["location がオブジェクトでない", { ...envelope, location: "p1" }],
    ["location が null", { ...envelope, location: null }],
  ])("外枠を持つのに形が合わないもの（%s）は捨てて数える", (_, broken) => {
    expect(extractEvidence(SOURCE, [envelope, broken])).toMatchObject({
      evidence: [{ recordId: "ride-7" }],
      discarded: 1,
    });
  });

  it("部品の id が設定の id の形でなければ、すべて捨てて数える", () => {
    expect(extractEvidence("bad id", [envelope])).toEqual({ evidence: [], discarded: 1 });
  });

  it("外枠の一部しか持たない要素は根拠とみなさず、数えもしない", () => {
    const partial: Record<string, unknown> = { ...envelope };
    delete partial.kind;

    expect(extractEvidence(SOURCE, { items: [partial] })).toEqual({ evidence: [], discarded: 0 });
  });
});

describe("何回かの結果の根拠をまとめる", () => {
  it("同じ根拠は最初に出たもの1つにし、順は保つ", () => {
    const first = extractEvidence("part_a", [envelope, { ...envelope, source_id: "ride-8" }]);
    const second = extractEvidence("part_a", [{ ...envelope, label: "あとの説明" }]);
    const other = extractEvidence("part_b", [envelope]);

    const merged = mergeEvidence([first.evidence, second.evidence, other.evidence]);

    expect(merged.map((e) => [e.sourceId, e.recordId, e.label])).toEqual([
      ["part_a", "ride-7", "7月1日の走行"],
      ["part_a", "ride-8", "7月1日の走行"],
      ["part_b", "ride-7", "7月1日の走行"],
    ]);
  });
});
