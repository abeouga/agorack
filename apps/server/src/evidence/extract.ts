import { EvidenceSchema, type Evidence } from "@agorack/contracts";

/** 道具の結果から取り出した根拠と、形が合わずに捨てた数。 */
export type ExtractedEvidence = {
  evidence: Evidence[];
  /** 根拠の外枠（kind・source_id・label・location）を持つのに、共通の形に合わなかった要素の数 */
  discarded: number;
};

/** 部品の MCP が返す根拠の外枠。この名前をすべて持つ要素を根拠とみなす（設計 §7.2）。 */
const ENVELOPE_KEYS = ["kind", "source_id", "label", "location"] as const;

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasEnvelope = (value: PlainObject): boolean => ENVELOPE_KEYS.every((key) => key in value);

/**
 * 道具の結果の構造化データ（`structuredContent`）から根拠を取り出し、共通の形にそろえる。
 *
 * - 入れ子のオブジェクト・配列の奥まで探し、外枠を持つ要素を根拠として取り出す。
 *   根拠の中（`location` など）はそれ以上探さない。
 * - 部品の `source_id`（記録の ID）は `recordId` に名前を変え、`sourceId` には呼んだ部品の id を付ける。
 * - `location` の中身は解釈しない。部品ごとの決まりは知らない。
 * - 同じ根拠（sourceId・recordId・kind・location が同じ）は、最初に出たもの1つにまとめる。
 * - 外枠を持つのに共通の形に合わないものは捨て、その数を返す。
 *
 * @param sourceId 道具を呼んだ部品の id（設定の id）
 * @param structuredContent 道具の結果の構造化データ。形は問わない
 */
export function extractEvidence(sourceId: string, structuredContent: unknown): ExtractedEvidence {
  const evidence: Evidence[] = [];
  const seenKeys = new Set<string>();
  const visited = new Set<object>();
  let discarded = 0;

  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isPlainObject(node)) return;

    if (hasEnvelope(node)) {
      const parsed = EvidenceSchema.safeParse({
        kind: node.kind,
        sourceId,
        recordId: node.source_id,
        label: node.label,
        location: node.location,
        value: node.value ?? null,
      });
      if (!parsed.success) {
        discarded += 1;
        return;
      }
      const key = identityKey(parsed.data);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        evidence.push(parsed.data);
      }
      return;
    }

    Object.values(node).forEach(visit);
  };

  visit(structuredContent);
  return { evidence, discarded };
}

/** 同じ根拠かどうかを決める鍵。`location` はキーの順に左右されないよう並べ替えて文字列にする。 */
function identityKey(item: Evidence): string {
  return JSON.stringify([item.sourceId, item.recordId, item.kind, canonical(item.location)]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}
