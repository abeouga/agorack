import { SPLIT_MAX, SPLIT_MIN, SPLIT_STEP, clampSplit } from "./split";

/** ドラッグしている間、body に付ける印（カーソルと文字の選択、iframe がポインターを取らないようにする） */
const RESIZING_CLASS = "split-resizing";

/**
 * チャットと右の欄の境目のつまみ（文之助のチャットの ask-splitter と同じ動き）。
 * ドラッグか ←/→ キーで、チャットの割合（チャット＋右の欄の幅に対する割合）を変える。
 * 右の欄（.evidence-panel）の左の端に置き、すぐ前の兄弟の要素（チャットの欄）の左の端から測る。
 */
export function Splitter({
  value,
  onResize,
}: {
  /** 今のチャットの割合 */
  value: number;
  onResize: (ratio: number) => void;
}) {
  const ratioAt = (handle: HTMLElement, x: number) => {
    const panel = handle.closest<HTMLElement>(".evidence-panel");
    const chat = panel?.previousElementSibling;
    if (!panel || !chat) return null;
    const left = chat.getBoundingClientRect().left;
    const right = panel.getBoundingClientRect().right;
    return clampSplit((x - left) / Math.max(right - left, 1));
  };
  const current = (handle: HTMLElement) => {
    const panel = handle.closest<HTMLElement>(".evidence-panel");
    return panel ? ratioAt(handle, panel.getBoundingClientRect().left) : null;
  };
  return (
    <div
      className="evidence-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="チャットと根拠の幅を変える"
      aria-valuemin={Math.round(SPLIT_MIN * 100)}
      aria-valuemax={Math.round(SPLIT_MAX * 100)}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        handle.classList.add("dragging");
        document.body.classList.add(RESIZING_CLASS);
        const move = (next: PointerEvent) => {
          const ratio = ratioAt(handle, next.clientX);
          if (ratio !== null) onResize(ratio);
        };
        const end = () => {
          handle.classList.remove("dragging");
          document.body.classList.remove(RESIZING_CLASS);
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", end);
          handle.removeEventListener("pointercancel", end);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const ratio = current(event.currentTarget);
        if (ratio === null) return;
        onResize(clampSplit(ratio + (event.key === "ArrowLeft" ? -SPLIT_STEP : SPLIT_STEP)));
      }}
    />
  );
}
