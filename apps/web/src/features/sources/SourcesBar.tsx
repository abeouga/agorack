import type { SourceInfo } from "@agorack/contracts";
import type { SourcesState } from "./useSources";

const STATUS_LABEL: Record<SourceInfo["status"], string> = {
  connected: "接続中",
  failed: "接続できません",
  disabled: "停止中",
};

function detailOf(source: SourceInfo): string {
  if (source.status === "connected") return `${source.description}（道具 ${source.toolCount} 個）`;
  if (source.status === "failed") return `つなげませんでした：${source.error ?? "理由は不明です"}`;
  return "設定で止めています";
}

/** 上部バーの部品の状態 */
export function SourcesBar({ state }: { state: SourcesState }) {
  if (state.kind === "loading") {
    return <p className="sources-bar sources-note">部品の状態を確かめています…</p>;
  }
  if (state.kind === "unavailable") {
    return (
      <p className="sources-bar sources-note is-danger" role="status">
        <span className="source-dot failed" aria-hidden="true" />
        {state.message}
      </p>
    );
  }
  return (
    <ul className="sources-bar" aria-label="部品の状態">
      {state.sources.map((source) => (
        <li key={source.id} className={`source-chip ${source.status}`} title={detailOf(source)}>
          <span className={`source-dot ${source.status}`} aria-hidden="true" />
          <span className="source-name">{source.name}</span>
          <span className="source-status">
            {STATUS_LABEL[source.status]}
            {source.status === "connected" && `・道具 ${source.toolCount}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
