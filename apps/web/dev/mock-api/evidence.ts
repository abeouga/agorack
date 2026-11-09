import type { Evidence } from "@agorack/contracts";

/**
 * 偽のサーバーが返す根拠。
 * 書類の根拠は、文之助の MCP が実際に返したもの（apps/server の試験の見本：get_document・aggregate）から、
 * サーバーが取り出したあとの形（recordId・sourceId）に直して写した。apps/server は import しない。
 * image_url は手元の文之助（127.0.0.1:8010）の本物のページ画像を指す。box はその画像の画素。
 */

const FUMINOSUKE = "http://127.0.0.1:8010";
const KOYOMI_JOB = "1d0c139e-5175-43d5-bba6-1d2b76d69977";

type Box = { x: number; y: number; width: number; height: number };

type Field = {
  field_id: string;
  field_label: string;
  section: string;
  box: Box;
  value: string | null;
  label: string;
  table?: { table_id: string; table_title: string; row_number: number; column_id: string };
};

/** 文之助の DocumentLocation の形で、書類の根拠を作る */
function documentEvidence(
  jobId: string,
  document: { template_id: string; template_name: string; document_name: string },
  field: Field,
): Evidence {
  const jobUrl = `${FUMINOSUKE}/api/v1/jobs/${jobId}/artifacts`;
  return {
    kind: "document",
    sourceId: "fuminosuke",
    recordId: jobId,
    label: field.label,
    location: {
      ...document,
      field_id: field.field_id,
      field_label: field.field_label,
      section: field.section,
      table_id: field.table?.table_id ?? null,
      table_title: field.table?.table_title ?? null,
      row_number: field.table?.row_number ?? null,
      column_id: field.table?.column_id ?? null,
      page_id: null,
      box: field.box,
      crop_url: `${jobUrl}/fieldCrop.${field.field_id}.alignedColor`,
      image_url: `${jobUrl}/alignedSource`,
    },
    value: field.value,
  };
}

const koyomi = {
  template_id: "937a209a-22e3-477e-8199-1d3d1e9a48ca",
  template_name: "繁殖台帳1021",
  document_name: "こよみ",
};

/** 売却子牛一覧の価格（aggregate の sum で使われた7件） */
const priceCells: [row: number, fieldId: string, value: string, box: Box][] = [
  [2, "layout_c_9f29d76c6ecc48d68747", "540,000", { x: 809, y: 311, width: 126, height: 30 }],
  [3, "layout_c_3f04ae295f18461e8fc8", "770,000", { x: 809, y: 340, width: 126, height: 30 }],
  [4, "layout_c_acb4a48856364c37acc0", "762,300", { x: 809, y: 370, width: 126, height: 30 }],
  [5, "layout_c_cc5d5e82cf4c4ad2add6", "826,100", { x: 809, y: 400, width: 126, height: 30 }],
  [6, "layout_c_1916e80fb53e4346816c", "456,500", { x: 808, y: 430, width: 127, height: 30 }],
  [7, "layout_c_659e4bee5088460fac2d", "435,600", { x: 808, y: 459, width: 127, height: 31 }],
  [8, "layout_c_c917545cc5f94bb7b8d5", "708,400", { x: 808, y: 488, width: 127, height: 32 }],
];

export const koyomiPrices: Evidence[] = priceCells.map(([row, fieldId, value, box]) =>
  documentEvidence(KOYOMI_JOB, koyomi, {
    field_id: fieldId,
    field_label: "価格",
    section: "売却子牛一覧",
    box,
    value,
    label: `繁殖台帳1021「こよみ」の売却子牛一覧 ${row}行目の価格`,
    table: {
      table_id: "c_56ca44d4ff904e6bac56",
      table_title: "売却子牛一覧",
      row_number: row,
      column_id: "c_c99950d4320a4d64b172",
    },
  }),
);

export const KOYOMI_PRICE_TOTAL = "4,498,900";

/** get_document で返った欄のうち、答えに使うもの */
const field = (
  field_id: string,
  field_label: string,
  section: string,
  value: string,
  box: Box,
): Evidence =>
  documentEvidence(KOYOMI_JOB, koyomi, {
    field_id,
    field_label,
    section,
    box,
    value,
    label: `繁殖台帳1021「こよみ」の${field_label}`,
  });

export const koyomiFields: Evidence[] = [
  field("layout_c_ffd40162d1a441859b36", "名号", "母牛", "こよみ", {
    x: 137,
    y: 214,
    width: 530,
    height: 97,
  }),
  field("layout_c_3da4d668b0a74c0b80f2_c_faf58b28d7c54857b2b3", "毛色", "基本項目", "褐", {
    x: 411,
    y: 311,
    width: 256,
    height: 44,
  }),
  field("layout_c_7ba5a7f511ef48dfb494", "父の名号", "基本項目", "幸泉", {
    x: 181,
    y: 685,
    width: 329,
    height: 56,
  }),
  field("layout_c_93e6d7a360764f7c8cc7", "母の名号", "母", "みつえい", {
    x: 183,
    y: 851,
    width: 328,
    height: 56,
  }),
];

/** ページ画像が読めない根拠（文之助にない書類 ID を指す）。ラベルと値の表示に戻ることを確かめる */
export const missingImage: Evidence = documentEvidence(
  "00000000-0000-4000-8000-000000000000",
  { ...koyomi, document_name: "はなこ" },
  {
    field_id: "layout_c_3da4d668b0a74c0b80f2_c_faf58b28d7c54857b2b3",
    field_label: "毛色",
    section: "基本項目",
    box: { x: 411, y: 311, width: 256, height: 44 },
    value: "黒",
    label: "繁殖台帳1021「はなこ」の毛色",
  },
);

/**
 * Agorack が表示を知らない kind の根拠（例：走行の記録）。ラベルと値だけが出ることを確かめる。
 * 中身は見本で、カブロガーの MCP の仕様ではない。
 */
export const unknownKind: Evidence[] = [
  {
    kind: "ride",
    sourceId: "kabulogger",
    recordId: "ride-20261103-1",
    label: "11月3日 朝の走行（自宅→牛舎）の距離",
    location: { segment: { from: "07:12", to: "07:31" } },
    value: "12.4 km",
  },
  {
    kind: "ride",
    sourceId: "kabulogger",
    recordId: "ride-20261103-1",
    label: "11月3日 朝の走行（自宅→牛舎）の平均速度",
    location: { segment: { from: "07:12", to: "07:31" } },
    value: "39 km/h",
  },
];
