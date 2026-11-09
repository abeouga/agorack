import { useEffect, useReducer } from "react";
import { historyReducer } from "./historyReducer";
import { loadHistory, saveHistory } from "./storage";

/** 保存の間隔。答えが流れている間に、断片のたびに書き込まないため */
const SAVE_DELAY_MS = 400;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 会話の履歴の状態。ブラウザーから読み、変わるたびに（少し待って）保存する */
export function useHistory() {
  const [state, dispatch] = useReducer(historyReducer, undefined, () =>
    loadHistory(browserStorage(), crypto.randomUUID(), Date.now()),
  );
  useEffect(() => {
    const save = () => saveHistory(browserStorage(), state);
    const timer = window.setTimeout(save, SAVE_DELAY_MS);
    // 待っている間に閉じられても、最後の状態を残す
    window.addEventListener("pagehide", save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [state]);
  return [state, dispatch] as const;
}
