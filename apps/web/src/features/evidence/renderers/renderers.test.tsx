import type { Evidence } from "@agorack/contracts";
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
  onPick: () => undefined,
});

describe("書類の location", () => {
  it("文之助の location からページ画像・枠・書類の名前を読む", () => {
    expect(documentLocation(row2)).toEqual({
      imageUrl: "http://127.0.0.1:8010/api/v1/jobs/1d0c139e/artifacts/alignedSource",
      box: { x: 809, y: 311, width: 126, height: 30 },
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
    expect(html).toContain("繁殖台帳1021「こよみ」");
    expect(html).toContain("540,000");
    expect(html).not.toContain(IMAGE_FAILED_NOTICE);
  });

  it("ページ画像の場所がない書類の根拠は、ラベルと値の表示に戻す", () => {
    const html = renderToStaticMarkup(
      <EvidenceView {...props({ ...row2, location: { field_label: "価格" } })} />,
    );
    expect(html).toContain(NO_LOCATION_NOTICE);
    expect(html).toContain("540,000");
    expect(html).not.toContain("<img");
  });

  it("根拠のキーは書類の枠の選択に使える", () => {
    expect(evidenceKey(row2)).not.toBe(evidenceKey(row3));
  });
});
