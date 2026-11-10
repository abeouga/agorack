import { type Evidence, HIGHLIGHT_FIELD_IDS_MAX } from "@agorack/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evidenceKey } from "../selection";
import {
  DocumentEvidence,
  IMAGE_FAILED_NOTICE,
  NO_LOCATION_NOTICE,
} from "./document/DocumentEvidence";
import { boxStyle, documentLocation } from "./document/location";
import { FallbackEvidence } from "./fallback/FallbackEvidence";
import { EMBED_SANDBOX } from "./embed/EmbedEvidence";
import {
  embedFailureKey,
  embedFailureOf,
  embedTarget,
  highlightMessage,
} from "./embed/embedTarget";
import { EvidenceView, rendererFor } from "./index";
import type { EvidenceViewProps } from "./types";

/** 文之助の MCP が返す書類の根拠の形（apps/server の試験の見本から写したもの） */
const price = (row: number, value: string, y: number): Evidence => ({
  kind: "document",
  sourceId: "fuminosuke",
  recordId: "1d0c139e-5175-43d5-bba6-1d2b76d69977",
  label: `繁殖台帳1021「こよみ」の売却子牛一覧 ${row}行目の価格`,
  location: {
    template_id: "937a209a-22e3-477e-8199-1d3d1e9a48ca",
    template_name: "繁殖台帳1021",
    document_name: "こよみ",
    field_id: `field-${row}`,
    field_label: "価格",
    section: "売却子牛一覧",
    table_id: "c_56ca44d4ff904e6bac56",
    table_title: "売却子牛一覧",
    row_number: row,
    column_id: "c_c99950d4320a4d64b172",
    page_id: null,
    box: { x: 809, y, width: 126, height: 30 },
    crop_url: "http://127.0.0.1:8010/api/v1/jobs/1d0c139e/artifacts/fieldCrop.x.alignedColor",
    image_url: "http://127.0.0.1:8010/api/v1/jobs/1d0c139e/artifacts/alignedSource",
  },
  value,
  embedUrl: null,
});

const row2 = price(2, "540,000", 311);
const row3 = price(3, "770,000", 340);

const ride: Evidence = {
  kind: "ride",
  sourceId: "kabulogger",
  recordId: "ride-1",
  label: "朝の走行の距離",
  location: { segment: { from: "07:12", to: "07:31" } },
  value: "12.4 km",
  embedUrl: null,
};

const props = (evidence: Evidence, siblings: Evidence[] = [evidence]): EvidenceViewProps => ({
  evidence,
  siblings,
  highlighted: new Set(),
  sourceName: "文之助",
  embedOrigin: null,
  onPick: () => undefined,
  onClose: () => undefined,
});

/** 右の欄を閉じる × の数 */
const closeButtons = (html: string) => html.split('aria-label="根拠を閉じる"').length - 1;

describe("書類の location", () => {
  it("文之助の location からページ画像・枠・書類の名前を読む", () => {
    expect(documentLocation(row2)).toEqual({
      imageUrl: "http://127.0.0.1:8010/api/v1/jobs/1d0c139e/artifacts/alignedSource",
      box: { x: 809, y: 311, width: 126, height: 30 },
      documentName: "こよみ",
      documentTitle: "繁殖台帳1021「こよみ」",
      fieldLabel: "価格",
    });
  });

  it.each([
    ["image_url がない", { ...row2.location, image_url: null }],
    ["box がない", { ...row2.location, box: null }],
    ["box の幅が 0", { ...row2.location, box: { x: 1, y: 1, width: 0, height: 3 } }],
    ["image_url が http でない", { ...row2.location, image_url: "javascript:alert(1)" }],
  ])("%sときは描けない（null）", (_name, location) => {
    expect(documentLocation({ ...row2, location })).toBeNull();
  });

  it("枠を画像の大きさに対する割合にする（box は画像の画素）", () => {
    expect(
      boxStyle({ x: 124, y: 175.4, width: 248, height: 87.7 }, { width: 1240, height: 1754 }),
    ).toEqual({
      left: "10%",
      top: "10%",
      width: "20%",
      height: "5%",
    });
  });
});

describe("表示の選び方", () => {
  it("document は書類の表示、知らない kind はラベルと値の表示", () => {
    expect(rendererFor(row2)).toBe(DocumentEvidence);
    expect(rendererFor(ride)).toBe(FallbackEvidence);
    // Object の持ち物の名前でも取り違えない
    expect(rendererFor({ ...ride, kind: "constructor" })).toBe(FallbackEvidence);
    expect(rendererFor({ ...ride, kind: "toString" })).toBe(FallbackEvidence);
  });

  it("知らない kind の根拠は、ラベルと値を出して壊れない", () => {
    const html = renderToStaticMarkup(<EvidenceView {...props(ride)} sourceName="カブロガー" />);
    expect(html).toContain("朝の走行の距離");
    expect(html).toContain("12.4 km");
    expect(html).toContain("カブロガー");
    // 上の行に名前と、右の欄を閉じる ×
    expect(html).toContain('class="pane-head"');
    expect(closeButtons(html)).toBe(1);
  });

  it("値が文字でない・空欄の根拠も出せる", () => {
    expect(
      renderToStaticMarkup(<EvidenceView {...props({ ...ride, value: { km: 12.4 } })} />),
    ).toContain("{&quot;km&quot;:12.4}");
    expect(renderToStaticMarkup(<EvidenceView {...props({ ...ride, value: null })} />)).toContain(
      "（空欄）",
    );
  });
});

describe("書類の表示", () => {
  it("ページ画像を部品のサーバーから直に読み、書類の名前と欄・値を出す", () => {
    const html = renderToStaticMarkup(<EvidenceView {...props(row2, [row2, row3])} />);
    expect(html).toContain(
      'src="http://127.0.0.1:8010/api/v1/jobs/1d0c139e/artifacts/alignedSource"',
    );
    // 道具の行に書類の名前（様式の名前は添え書きに）、欄と値は読み上げ用に
    expect(html).toMatch(/class="document-title" title="繁殖台帳1021「こよみ」">.*こよみ/);
    expect(html).toContain("価格：540,000");
    expect(html).not.toContain(IMAGE_FAILED_NOTICE);
  });

  it("道具の行の右の端（拡大・縮小の右）に、右の欄を閉じる × を置く", () => {
    const html = renderToStaticMarkup(<DocumentEvidence {...props(row2)} />);
    expect(closeButtons(html)).toBe(1);
    const tools = html.slice(html.indexOf('class="document-tools"'), html.indexOf("</div></div>"));
    expect(tools.indexOf('aria-label="拡大"')).toBeLessThan(tools.indexOf("根拠を閉じる"));
    // 画像を読み込む間は、道具の行の下に案内の文を出す
    expect(html).toMatch(
      /class="document-loading"><p class="pane-lead"[^>]*>.*ページ画像を読み込んでいます/,
    );
  });

  it("埋め込めなかった知らせは、道具の行の下・ページ画像の上に出す", () => {
    const notice = "文之助の画面を埋め込めませんでした（欄が見つかりません）。";
    const html = renderToStaticMarkup(<DocumentEvidence {...props(row2)} notice={notice} />);
    const at = (text: string) => html.indexOf(text);
    expect(at(notice)).toBeGreaterThan(at('class="document-tools"'));
    expect(at(notice)).toBeLessThan(at('class="document-scroll"'));
    // 知らせがなければ出さない
    expect(renderToStaticMarkup(<DocumentEvidence {...props(row2)} />)).not.toContain(
      "document-notice",
    );
  });

  it("ページ画像の場所がない書類の根拠は、ラベルと値の表示に戻す", () => {
    const html = renderToStaticMarkup(
      <EvidenceView {...props({ ...row2, location: { field_label: "価格" } })} />,
    );
    expect(html).toContain(NO_LOCATION_NOTICE);
    expect(html).toContain("540,000");
    expect(html).not.toContain("<img");
    // ラベルと値の表示に戻しても、書類の名前と × の行を出す
    expect(html).toMatch(/class="pane-title"[^>]*>.*文之助/);
    expect(closeButtons(html)).toBe(1);
  });

  it("ラベルと値の表示に戻すときも、埋め込めなかった知らせを残す", () => {
    const notice = "文之助の画面を埋め込めませんでした（応答がありません）。";
    const html = renderToStaticMarkup(
      <DocumentEvidence {...props({ ...row2, location: {} })} notice={notice} />,
    );
    expect(html).toContain(notice);
    expect(html).toContain(NO_LOCATION_NOTICE);
  });

  it("根拠のキーは書類の枠の選択に使える", () => {
    expect(evidenceKey(row2)).not.toBe(evidenceKey(row3));
  });
});

describe("部品の埋め込み用の画面", () => {
  const EMBED = "http://127.0.0.1:5180";
  const embedded: Evidence = {
    ...row2,
    embedUrl: `${EMBED}/embed?job=1d0c139e&field=field-2`,
  };

  it("embedUrl の住所が許した住所と同じときだけ使う", () => {
    expect(embedTarget(embedded, EMBED)).toEqual({
      url: `${EMBED}/embed?job=1d0c139e&field=field-2`,
      origin: EMBED,
      recordKey: "fuminosuke\u00001d0c139e-5175-43d5-bba6-1d2b76d69977",
      fieldId: "field-2",
    });
    expect(embedTarget(embedded, null)).toBeNull();
    expect(embedTarget(embedded, "http://127.0.0.1:5181")).toBeNull();
    expect(embedTarget(embedded, "http://localhost:5180")).toBeNull();
    expect(embedTarget({ ...embedded, embedUrl: null }, EMBED)).toBeNull();
  });

  it("同じ記録の根拠は同じ記録のキー、欄の ID は location.field_id", () => {
    const other = { ...row3, embedUrl: `${EMBED}/embed?job=1d0c139e&field=field-3` };
    expect(embedTarget(other, EMBED)?.recordKey).toBe(embedTarget(embedded, EMBED)?.recordKey);
    expect(embedTarget(other, EMBED)?.fieldId).toBe("field-3");
    expect(embedTarget({ ...embedded, location: {} }, EMBED)?.fieldId).toBeNull();
  });

  it("埋め込めるときは、決めた権限だけを付けた iframe を出す", () => {
    const html = renderToStaticMarkup(<EvidenceView {...props(embedded)} embedOrigin={EMBED} />);
    expect(html).toContain(`<iframe`);
    expect(html).toContain(`src="${EMBED}/embed?job=1d0c139e&amp;field=field-2"`);
    expect(html).toContain(`sandbox="${EMBED_SANDBOX}"`);
    expect(EMBED_SANDBOX).toBe(
      "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    // 準備ができるまでは、書類の名前と × の行、その下に案内の文を出す（文之助のチャットの書類の欄と同じ形）
    expect(html).toMatch(/class="pane-title" title="こよみ">.*こよみ/);
    expect(closeButtons(html)).toBe(1);
    expect(html).toMatch(/class="pane-lead"[^>]*>.*文之助の画面を開いています/);
    // 「〇〇の画面」の文字は出さない
    expect(html).not.toContain("embed-tools");
  });

  it("許していない住所の embedUrl は使わず、kind ごとの表示（ページ画像）を出す", () => {
    const html = renderToStaticMarkup(
      <EvidenceView {...props(embedded)} embedOrigin="http://127.0.0.1:9999" />,
    );
    expect(html).not.toContain("<iframe");
    expect(html).toContain("alignedSource");
  });
});

describe("埋め込み用の画面に送る強調（agorack:highlight）", () => {
  const EMBED = "http://127.0.0.1:5180";
  const withEmbed = (item: Evidence): Evidence => ({
    ...item,
    embedUrl: `${EMBED}/embed?job=1d0c139e&field=${String(item.location.field_id)}`,
  });
  const prices = [2, 3, 4, 5, 6, 7, 8].map((row) => withEmbed(price(row, "1", 300 + row)));
  const targetOf = (item: Evidence) => {
    const target = embedTarget(item, EMBED);
    if (!target) throw new Error("埋め込めない根拠");
    return target;
  };

  it("選んだ欄と、同じ記録の根拠の欄の全部を送る（選んだ欄を先に、重なりは除く）", () => {
    const chosen = prices[2] as Evidence;
    expect(highlightMessage(targetOf(chosen), [...prices, chosen])).toEqual({
      type: "agorack:highlight",
      fieldId: "field-4",
      fieldIds: ["field-4", "field-2", "field-3", "field-5", "field-6", "field-7", "field-8"],
    });
  });

  it("ほかの記録・ほかの部品の根拠の欄は入れない", () => {
    const otherRecord = { ...withEmbed(price(9, "1", 1)), recordId: "other-job" };
    const otherSource = { ...withEmbed(price(10, "1", 1)), sourceId: "kabulogger" };
    const message = highlightMessage(targetOf(prices[0] as Evidence), [
      ...prices.slice(0, 2),
      otherRecord,
      otherSource,
    ]);
    expect(message?.fieldIds).toEqual(["field-2", "field-3"]);
  });

  it("選んだ欄がない根拠では送らない", () => {
    const noField = withEmbed({ ...row2, location: { ...row2.location, field_id: null } });
    expect(highlightMessage(targetOf(noField), prices)).toBeNull();
  });

  it("契約の上限を超えない（個数は上限まで、長すぎる ID は入れない、選んだ欄は必ず残す）", () => {
    const many = Array.from({ length: HIGHLIGHT_FIELD_IDS_MAX + 20 }, (_, index) =>
      withEmbed({ ...row2, location: { ...row2.location, field_id: `f-${String(index)}` } }),
    );
    const long = withEmbed({ ...row2, location: { ...row2.location, field_id: "x".repeat(201) } });
    const chosen = many.at(-1) as Evidence;
    const message = highlightMessage(targetOf(chosen), [long, ...many]);
    expect(message?.fieldIds).toHaveLength(HIGHLIGHT_FIELD_IDS_MAX);
    expect(message?.fieldIds?.[0]).toBe(chosen.location.field_id);
    expect(message?.fieldIds).not.toContain("x".repeat(201));
    // 選んだ欄の ID が契約に合わないときは送らない
    expect(highlightMessage(targetOf(long), many)).toBeNull();
  });
});

describe("埋め込みの失敗を覚える単位", () => {
  it("欄がない（FIELD_NOT_FOUND）ときはその欄だけ、ほかの失敗は記録の全部", () => {
    const failures = new Map([
      [embedFailureKey("FIELD_NOT_FOUND", row2), { code: "FIELD_NOT_FOUND" }],
    ]);
    expect(embedFailureOf(failures, row2)).toEqual({ code: "FIELD_NOT_FOUND" });
    // 同じ記録のほかの欄は埋め込みを続ける
    expect(embedFailureOf(failures, row3)).toBeUndefined();

    const recordFailures = new Map([[embedFailureKey("timeout", row2), { code: "timeout" }]]);
    expect(embedFailureOf(recordFailures, row3)).toEqual({ code: "timeout" });
    expect(embedFailureOf(recordFailures, { ...ride })).toBeUndefined();
  });
});
