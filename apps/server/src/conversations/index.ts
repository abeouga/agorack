// 会話の保持と、1ターンの実行の窓口（設計 §4.1）
export {
  InMemoryConversations,
  type ConversationDeps,
  type ConversationService,
  type StartTurnResult,
} from "./conversations.js";
