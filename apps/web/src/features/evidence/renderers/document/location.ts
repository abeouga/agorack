import type { Evidence } from "@agorack/contracts";
import { z } from "zod";

/**
 * 書類（kind: document）の根拠の location のうち、ページ画像に枠を描くのに使うところ。
 * 文之助の MCP の DocumentLocation に合わせる：
 * - image_url：その欄があるページの画像（位置合わせ済みのページ画像）の絶対 URL
 * - box：欄の矩形。image_url の画像の画素で表す（左上が原点）
 * 合わないところは無視し、描けないときは null にする。
 */

const BoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
export type Box = z.infer<typeof BoxSchema>;

const LocationSchema = z.object({
  image_url: z.url({ protocol: /^https?$/ }),
  box: BoxSchema,
  template_name: z.string().nullish(),
  document_name: z.string().nullish(),
  field_label: z.string().nullish(),
});

export type DocumentLocation = {
  imageUrl: string;
  box: Box;
  /** 書類の名前（例：個体A）。わからなければ null */
  documentName: string | null;
  /** 様式の名前を添えた書類の名前（例：繁殖台帳「個体A」）。わからなければ null */
  documentTitle: string | null;
  fieldLabel: string | null;
};

export function documentLocation(evidence: Evidence): DocumentLocation | null {
  const parsed = LocationSchema.safeParse(evidence.location);
  if (!parsed.success) return null;
  const { image_url, box, template_name, document_name, field_label } = parsed.data;
  const documentTitle =
    template_name && document_name
      ? `${template_name}「${document_name}」`
      : (document_name ?? template_name ?? null);
  return {
    imageUrl: image_url,
    box,
    documentName: document_name ?? null,
    documentTitle,
    fieldLabel: field_label ?? null,
  };
}

/** 画素の矩形を、画像の大きさに対する割合（CSS の %）にする */
export function boxStyle(box: Box, size: { width: number; height: number }) {
  return {
    left: `${(box.x / size.width) * 100}%`,
    top: `${(box.y / size.height) * 100}%`,
    width: `${(box.width / size.width) * 100}%`,
    height: `${(box.height / size.height) * 100}%`,
  };
}
