import { FiAlertTriangle } from "react-icons/fi";
import type { SourcesState } from "./useSources";

/**
 * つながっていない部品の知らせ（上部バーの下）。
 * 上部バーの印だけでは理由が見えないので、どの部品に、なぜつながらないかを文で出す。
 */
export function SourcesNotice({ state }: { state: SourcesState }) {
  if (state.kind !== "loaded") return null;
  const failed = state.sources.filter((source) => source.status === "failed");
  if (failed.length === 0) return null;
  return (
    <div className="sources-notice" role="status">
      <FiAlertTriangle aria-hidden="true" />
      <div>
        <strong>{failed.map((source) => source.name).join("・")}につながっていません。</strong>
        <span>この部品の値を使う質問には答えられません。</span>
        <ul>
          {failed.map((source) => (
            <li key={source.id}>
              {source.name}：{source.error ?? "理由はわかりません"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
