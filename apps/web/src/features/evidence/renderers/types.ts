import type { Evidence } from "@agorack/contracts";
import type { ComponentType } from "react";

/**
 * 根拠の表示（埋め込み・kind ごと）に渡すもの。表示を足すときは、この形の部品を作って renderers/index.ts に登録する。
 */
export type EvidenceViewProps = {
  /** 出す根拠（選んだもの・ホバーしているもの、なければ最初のもの） */
  evidence: Evidence;
  /** 同じ答えの根拠の全部（同じページの枠を一緒に描くときなどに使う） */
  siblings: readonly Evidence[];
  /** 強調している根拠のキー（表の行・一覧のホバー） */
  highlighted: ReadonlySet<string>;
  /** 部品の名前（例：文之助） */
  sourceName: string;
  /** その部品の埋め込み用の画面を許す住所（GET /api/sources の embedOrigin）。埋め込まない部品は null */
  embedOrigin: string | null;
  /** 部品の画面を埋め込めず、この表示に切り替えたときの知らせ。表示の中に小さく出す */
  notice?: string;
  /** 表示の中で根拠を選んだ（書類の枠を押したなど） */
  onPick: (key: string) => void;
};

export type EvidenceRenderer = ComponentType<EvidenceViewProps>;
