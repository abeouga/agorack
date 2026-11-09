import { type SourceInfo, SourcesResponseSchema, apiPaths } from "@agorack/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiError, requestJson } from "../../shared/http";

/**
 * 部品の状態（GET /api/sources）。サーバーにつながらないときは、しばらく待って聞き直す。
 * ターンが終わるたびにも聞き直す（サーバーはターンの始めに切れた部品をつなぎ直し、
 * ターンの途中で切れることもあるため）。
 */

export type SourcesState =
  | { kind: "loading" }
  | { kind: "loaded"; sources: SourceInfo[] }
  | { kind: "unavailable"; message: string };

const RETRY_MS = 15_000;

export async function fetchSources(): Promise<SourceInfo[]> {
  const parsed = SourcesResponseSchema.safeParse(await requestJson(apiPaths.sources()));
  if (!parsed.success) throw new ApiError("BAD_RESPONSE", "部品の状態を読めませんでした。");
  return parsed.data.sources;
}

export function useSources(turnRunning = false): SourcesState {
  const [state, setState] = useState<SourcesState>({ kind: "loading" });
  const checkRef = useRef<() => void>(() => {});
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const check = () => {
      fetchSources()
        .then((sources) => {
          if (!stopped) setState({ kind: "loaded", sources });
        })
        .catch((error: unknown) => {
          if (stopped) return;
          setState({
            kind: "unavailable",
            message: error instanceof ApiError ? error.message : "部品の状態を読めませんでした。",
          });
          timer = window.setTimeout(check, RETRY_MS);
        });
    };
    checkRef.current = check;
    check();
    // 画面に戻ってきたら最新の状態にする
    const back = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  // ターンが終わったら聞き直す
  const wasRunning = useRef(turnRunning);
  useEffect(() => {
    if (wasRunning.current && !turnRunning) checkRef.current();
    wasRunning.current = turnRunning;
  }, [turnRunning]);

  return state;
}

/** 部品の id から名前を引く（読めていなければ id のまま） */
export function sourceName(state: SourcesState, sourceId: string): string {
  if (state.kind !== "loaded") return sourceId;
  return state.sources.find((source) => source.id === sourceId)?.name ?? sourceId;
}
