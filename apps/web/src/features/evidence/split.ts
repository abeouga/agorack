/**
 * チャットと右の欄の幅の分け方。値は「チャットの割合」（チャット＋右の欄の幅に対する割合）。
 * 文之助のチャットの書類の欄と同じく、25〜75%、最初は 50%、←/→ キーで 5% ずつ動かす。
 */
export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.75;
export const SPLIT_DEFAULT = 0.5;
export const SPLIT_STEP = 0.05;

const SPLIT_KEY = "agorack.evidenceSplit";

export function clampSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
}

/** 覚えている割合。覚えていない・読めない・範囲の外のときは最初の値 */
export function readSplit(storage: Pick<Storage, "getItem"> | undefined): number {
  try {
    const stored = storage?.getItem(SPLIT_KEY);
    if (stored === null || stored === undefined || stored.trim() === "") return SPLIT_DEFAULT;
    const value = Number(stored);
    return Number.isFinite(value) && value >= SPLIT_MIN && value <= SPLIT_MAX
      ? value
      : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

/** 割合を覚える。覚えられなくても（保存の領域が使えないなど）幅を変えることはできる */
export function writeSplit(storage: Pick<Storage, "setItem"> | undefined, ratio: number): void {
  try {
    storage?.setItem(SPLIT_KEY, String(Math.round(clampSplit(ratio) * 1000) / 1000));
  } catch {
    // 覚えられないだけで、今の画面では幅を変えられる
  }
}

/** 保存の領域。使えない画面（読むだけで例外になるなど）では undefined */
export function splitStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
