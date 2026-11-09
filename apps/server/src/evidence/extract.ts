import { EmbedUrlSchema, EvidenceSchema, type Evidence } from "@agorack/contracts";

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
 * 入れ子のオブジェクト・配列の奥まで探し、根拠の外枠を持つ要素を、出てきた順に渡す。
 * 根拠の中（`location` など）はそれ以上探さない。
 */
function forEachEnvelope(content: unknown, visitor: (envelope: PlainObject) => void): void {
  const visited = new Set<object>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isPlainObject(node)) return;
    if (hasEnvelope(node)) {
      visitor(node);
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(content);
}

/**
 * 道具の結果の構造化データ（`structuredContent`）から根拠を取り出し、共通の形にそろえる。
 *
 * - 入れ子のオブジェクト・配列の奥まで探し、外枠を持つ要素を根拠として取り出す。
 *   根拠の中（`location` など）はそれ以上探さない。
 * - 部品の `source_id`（記録の ID）は `recordId` に名前を変え、`sourceId` には呼んだ部品の id を付ける。
 * - 部品の `embed_url` は `embedUrl` にする。ない・http か https の絶対URLでないときは null。
 *   部品の設定で許した住所かどうかは、ここでは見ない（restrictEmbedUrls で先に外す）。
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
  let discarded = 0;

  forEachEnvelope(structuredContent, (node) => {
    const parsed = EvidenceSchema.safeParse({
      kind: node.kind,
      sourceId,
      recordId: node.source_id,
      label: node.label,
      location: node.location,
      value: node.value ?? null,
      embedUrl: embedUrlOf(node.embed_url),
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
  });

  return { evidence, discarded };
}

/** 埋め込み用の画面の住所として使える値（http か https の絶対URL）だけを残す。ほかは null */
function embedUrlOf(value: unknown): string | null {
  return EmbedUrlSchema.safeParse(value).success ? (value as string) : null;
}

/**
 * 根拠の `embed_url` のうち、部品の設定で埋め込みを許した住所（embed.origin）のもの以外を null にする（設計 §7.4）。
 * 元の値は変えず、写しを返す。許す住所がない部品（null）は、全部を null にする。
 *
 * 部品の設定を知っている側（sources）が、道具の結果を受け取ったときに使う。
 */
export function restrictEmbedUrls(
  structuredContent: unknown,
  allowedOrigin: string | null,
): unknown {
  if (typeof structuredContent !== "object" || structuredContent === null) return structuredContent;
  const copy: unknown = structuredClone(structuredContent);
  forEachEnvelope(copy, (node) => {
    if (!("embed_url" in node)) return;
    const url = embedUrlOf(node.embed_url);
    node.embed_url = url !== null && originOf(url) === allowedOrigin ? url : null;
  });
  return copy;
}

function originOf(url: string): string | null {
  return URL.canParse(url) ? new URL(url).origin : null;
}

/**
 * 何回かの道具の結果から取り出した根拠を1つの並びにし、同じ根拠は最初に出たもの1つにまとめる。
 * 同じかどうかの決まりは extractEvidence と同じ（sourceId・recordId・kind・location）。
 */
export function mergeEvidence(lists: readonly (readonly Evidence[])[]): Evidence[] {
  const seenKeys = new Set<string>();
  const merged: Evidence[] = [];
  for (const item of lists.flat()) {
    const key = identityKey(item);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(item);
    }
  }
  return merged;
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
