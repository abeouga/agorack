import { SourcesBar } from "../features/sources/SourcesBar";
import type { SourcesState } from "../features/sources/useSources";

/** 上部バー：名前と、部品の状態 */
export function TopBar({ sources }: { sources: SourcesState }) {
  return (
    <header className="top-bar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          A
        </span>
        <span className="brand-name">Agorack</span>
        <span className="brand-sub">根拠付きで答えるチャット</span>
      </div>
      <SourcesBar state={sources} />
    </header>
  );
}
