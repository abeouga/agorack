import { describe, expect, it } from "vitest";
import {
  type HistoryAction,
  type HistoryState,
  MAX_CONVERSATIONS,
  currentConversation,
  historyReducer,
  initialHistory,
  listedConversations,
} from "./historyReducer";
import { RELOADED_MESSAGE, loadHistory, saveHistory } from "./storage";

const ask = (id: string, question: string, at = 1): HistoryAction => ({
  type: "conversation.changed",
  id,
  action: { type: "turn.submitted", turnId: `${id}-${at}`, question, at },
});

const apply = (state: HistoryState, actions: HistoryAction[]) =>
  actions.reduce(historyReducer, state);

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe("会話の履歴", () => {
  it("質問を送った会話だけを履歴に出す", () => {
    const state = initialHistory("a", 0);
    expect(listedConversations(state)).toEqual([]);
    expect(listedConversations(apply(state, [ask("a", "毛色は？")]))).toHaveLength(1);
  });

  it("新しい会話を始めると先頭に足し、空の会話は残さない", () => {
    const state = apply(initialHistory("a", 0), [
      ask("a", "1つめ"),
      { type: "conversation.started", id: "b", at: 2 },
      { type: "conversation.started", id: "c", at: 3 },
    ]);
    // b は空のまま開いているので、c は作らない
    expect(state.currentId).toBe("b");
    expect(state.conversations.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("会話を開くと、開いていた空の会話を消す", () => {
    const state = apply(initialHistory("a", 0), [
      ask("a", "1つめ"),
      { type: "conversation.started", id: "b", at: 2 },
      { type: "conversation.opened", id: "a" },
    ]);
    expect(state.currentId).toBe("a");
    expect(state.conversations.map((item) => item.id)).toEqual(["a"]);
  });

  it("質問を送った会話を先頭に出す", () => {
    const state = apply(initialHistory("a", 0), [
      ask("a", "1つめ"),
      { type: "conversation.started", id: "b", at: 2 },
      ask("b", "2つめ", 3),
      { type: "conversation.opened", id: "a" },
      ask("a", "3つめ", 4),
    ]);
    expect(state.conversations.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("開いている会話を消すと、新しい会話を開く", () => {
    const state = apply(initialHistory("a", 0), [
      ask("a", "1つめ"),
      { type: "conversation.removed", id: "a", nextId: "n", at: 5 },
    ]);
    expect(state.currentId).toBe("n");
    expect(currentConversation(state).turns).toEqual([]);
    expect(listedConversations(state)).toEqual([]);
  });

  it(`残す会話は ${MAX_CONVERSATIONS} 件まで`, () => {
    let state = initialHistory("c0", 0);
    for (let index = 0; index < MAX_CONVERSATIONS + 5; index += 1) {
      state = apply(state, [
        ask(`c${index}`, `質問${index}`, index + 1),
        { type: "conversation.started", id: `c${index + 1}`, at: index + 1 },
      ]);
    }
    expect(listedConversations(state).length).toBe(MAX_CONVERSATIONS);
  });
});

describe("履歴の保存", () => {
  it("保存したものを読み込み直せる（再読み込みしても会話が残る）", () => {
    const storage = new MemoryStorage();
    const state = apply(initialHistory("a", 0), [
      ask("a", "毛色は？"),
      {
        type: "conversation.changed",
        id: "a",
        action: {
          type: "turn.event",
          turnId: "a-1",
          event: { type: "turn.completed", text: "黒です。", evidence: [], reason: "end_turn" },
        },
      },
    ]);
    saveHistory(storage, state);
    const loaded = loadHistory(storage, "new", 10);
    expect(loaded).toEqual(state);
  });

  it("受け取りの途中だったターンは、止まったものとして読み込む", () => {
    const storage = new MemoryStorage();
    const state = apply(initialHistory("a", 0), [
      ask("a", "毛色は？"),
      {
        type: "conversation.changed",
        id: "a",
        action: {
          type: "turn.event",
          turnId: "a-1",
          event: {
            type: "tool.called",
            callId: "c1",
            sourceId: "fuminosuke",
            tool: "x",
            input: {},
          },
        },
      },
    ]);
    saveHistory(storage, state);
    const turn = currentConversation(loadHistory(storage, "new", 10)).turns[0];
    expect(turn).toMatchObject({
      status: "failed",
      failure: { code: "stopped", message: RELOADED_MESSAGE },
    });
    expect(turn?.tools[0]?.status).toBe("cancelled");
  });

  it("開いていた会話が空なら、新しい会話を開いて読み込む", () => {
    const storage = new MemoryStorage();
    const state = apply(initialHistory("a", 0), [
      ask("a", "毛色は？"),
      { type: "conversation.started", id: "b", at: 2 },
    ]);
    saveHistory(storage, state);
    const loaded = loadHistory(storage, "new", 10);
    expect(loaded.currentId).toBe("new");
    expect(listedConversations(loaded).map((item) => item.id)).toEqual(["a"]);
  });

  it.each([
    ["何もない", null],
    ["JSON でない", "{"],
    ["形が違う", JSON.stringify({ version: 1, currentId: "a", conversations: [{ id: 1 }] })],
    ["版が違う", JSON.stringify({ version: 99, currentId: "a", conversations: [] })],
  ])("保存したものが%sときは、空から始める", (_name, raw) => {
    const storage = new MemoryStorage();
    if (raw !== null) storage.setItem("agorack.history", raw);
    expect(loadHistory(storage, "new", 10)).toEqual(initialHistory("new", 10));
  });

  it("保存領域が使えなくても動く", () => {
    const broken = {
      getItem: () => {
        throw new Error("使えません");
      },
      setItem: () => {
        throw new Error("使えません");
      },
    };
    expect(loadHistory(broken, "new", 10)).toEqual(initialHistory("new", 10));
    expect(() => saveHistory(broken, initialHistory("a", 0))).not.toThrow();
  });
});
