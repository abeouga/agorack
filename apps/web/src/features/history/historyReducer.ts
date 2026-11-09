import {
  type Conversation,
  type ConversationAction,
  conversationReducer,
  emptyConversation,
} from "../chat/state/conversation";

/**
 * 会話の履歴（ブラウザーに保存する会話の一覧と、開いている会話）。
 * 1つの会話の中の変化は conversationReducer に任せる。
 */

export type HistoryState = {
  /** 新しい順。質問のない会話（開いたばかりの新しい会話）も含む */
  conversations: Conversation[];
  currentId: string;
};

export type HistoryAction =
  | { type: "conversation.started"; id: string; at: number }
  | { type: "conversation.opened"; id: string }
  | { type: "conversation.removed"; id: string; nextId: string; at: number }
  | { type: "conversation.changed"; id: string; action: ConversationAction };

/** 保存しておく会話の数の上限。超えたら古いものから消す */
export const MAX_CONVERSATIONS = 50;

export function initialHistory(id: string, at: number): HistoryState {
  return { conversations: [emptyConversation(id, at)], currentId: id };
}

export function currentConversation(state: HistoryState): Conversation {
  const found = state.conversations.find((item) => item.id === state.currentId);
  // currentId は常に一覧の中を指すように保つ
  if (!found) throw new Error(`開いている会話が見つかりません：${state.currentId}`);
  return found;
}

/** 履歴に出す会話（質問を1つ以上送ったもの） */
export function listedConversations(state: HistoryState): Conversation[] {
  return state.conversations.filter((item) => item.turns.length > 0);
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "conversation.started": {
      // 開いている会話がまだ空なら、それを使い続ける
      if (currentConversation(state).turns.length === 0) return state;
      return {
        conversations: [emptyConversation(action.id, action.at), ...dropEmpty(state.conversations)],
        currentId: action.id,
      };
    }
    case "conversation.opened": {
      if (!state.conversations.some((item) => item.id === action.id)) return state;
      return { conversations: dropEmpty(state.conversations, action.id), currentId: action.id };
    }
    case "conversation.removed": {
      const conversations = state.conversations.filter((item) => item.id !== action.id);
      if (state.currentId !== action.id) return { ...state, conversations };
      return {
        conversations: [emptyConversation(action.nextId, action.at), ...dropEmpty(conversations)],
        currentId: action.nextId,
      };
    }
    case "conversation.changed": {
      const target = state.conversations.find((item) => item.id === action.id);
      if (!target) return state;
      const next = conversationReducer(target, action.action);
      if (next === target) return state;
      const others = state.conversations.filter((item) => item.id !== action.id);
      // 質問を送った会話を先頭に出す（新しい順）
      const conversations =
        action.action.type === "turn.submitted"
          ? [next, ...others]
          : state.conversations.map((item) => (item.id === action.id ? next : item));
      return { ...state, conversations: conversations.slice(0, MAX_CONVERSATIONS) };
    }
  }
}

/** 空の会話を除く（keepId の会話は残す） */
function dropEmpty(conversations: Conversation[], keepId?: string): Conversation[] {
  return conversations.filter((item) => item.turns.length > 0 || item.id === keepId);
}
