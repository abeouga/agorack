import { useState } from "react";

/**
 * 右の欄に出す根拠の選び方。
 * - どのターンの根拠を出すか（決めていなければ最後のターン）
 * - 表の行のホバーで強調している根拠と、行を押して選んだ根拠
 * - 右の欄を × で閉じたか（設計 §7.3。根拠があれば自動で開き、閉じたあとは根拠を選ぶと開き直す）
 */
export type EvidenceSelection = {
  turnId: string | null;
  hovered: string[];
  selected: string[];
  closed: boolean;
};

const NONE: EvidenceSelection = { turnId: null, hovered: [], selected: [], closed: false };

export function useEvidenceSelection() {
  const [selection, setSelection] = useState<EvidenceSelection>(NONE);
  return {
    selection,
    /** 最後のターンを出す（質問を送ったとき・会話を替えたとき）。右の欄は根拠が届けばまた開く */
    reset: () => setSelection(NONE),
    showTurn: (turnId: string) =>
      setSelection({ turnId, hovered: [], selected: [], closed: false }),
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
        // 同じものをもう一度押したら選ぶのをやめる。閉じていたときは、選んで開き直す
        selected:
          !current.closed && current.turnId === turnId && sameKeys(current.selected, keys)
            ? []
            : keys,
        closed: false,
      })),
    /** 右の欄を閉じる（× ・Esc キー）。どれを選んでいたかは残す */
    close: () => setSelection((current) => ({ ...current, hovered: [], closed: true })),
  };
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}
