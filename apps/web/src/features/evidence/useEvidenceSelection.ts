import { useState } from "react";

/**
 * 右の欄に出す根拠の選び方。
 * - どのターンの根拠を出すか（決めていなければ最後のターン）
 * - 表の行のホバーで強調している根拠と、行を押して選んだ根拠
 */
export type EvidenceSelection = {
  turnId: string | null;
  hovered: string[];
  selected: string[];
};

const NONE: EvidenceSelection = { turnId: null, hovered: [], selected: [] };

export function useEvidenceSelection() {
  const [selection, setSelection] = useState<EvidenceSelection>(NONE);
  return {
    selection,
    /** 最後のターンを出す（質問を送ったとき・会話を替えたとき） */
    reset: () => setSelection(NONE),
    showTurn: (turnId: string) => setSelection({ turnId, hovered: [], selected: [] }),
    hover: (turnId: string, keys: string[]) =>
      setSelection((current) =>
        keys.length === 0 && current.hovered.length === 0
          ? current
          : { ...current, turnId: keys.length > 0 ? turnId : current.turnId, hovered: keys },
      ),
    select: (turnId: string, keys: string[]) =>
      setSelection((current) => ({
        turnId,
        hovered: current.hovered,
        // 同じものをもう一度押したら選ぶのをやめる
        selected: current.turnId === turnId && sameKeys(current.selected, keys) ? [] : keys,
      })),
  };
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}
