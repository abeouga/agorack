import { useState } from "react";
import { ChatPanel } from "../features/chat/components/ChatPanel";
import { useChat } from "../features/chat/useChat";
import { EvidencePanel } from "../features/evidence/EvidencePanel";
import { useEvidenceSelection } from "../features/evidence/useEvidenceSelection";
import { HistorySidebar } from "../features/history/HistorySidebar";
import { currentConversation, listedConversations } from "../features/history/historyReducer";
import { useHistory } from "../features/history/useHistory";
import { SourcesNotice } from "../features/sources/SourcesNotice";
import { embedOriginOf, sourceName, useSources } from "../features/sources/useSources";
import { TopBar } from "./TopBar";

const SIDEBAR_KEY = "agorack.sidebar";

function storedSidebar(): boolean {
  try {
    const value = window.localStorage.getItem(SIDEBAR_KEY);
    return value === null ? window.innerWidth > 1280 : value === "open";
  } catch {
    return window.innerWidth > 1280;
  }
}

/** 画面全体の枠：上部バーと、左（履歴）・中央（チャット）・右（根拠）の3列 */
export function App() {
  const [history, dispatch] = useHistory();
  const chat = useChat(history, dispatch);
  const sources = useSources(chat.busy);
  const evidence = useEvidenceSelection();
  const [sidebar, setSidebarState] = useState(storedSidebar);
  const setSidebar = (open: boolean) => {
    setSidebarState(open);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
    } catch {
      // 開け閉めを覚えておけなくても使える
    }
  };

  const conversation = currentConversation(history);
  const nameOf = (sourceId: string) => sourceName(sources, sourceId);
  const { selection } = evidence;
  // 右の欄に出すターン：選んだもの、なければ最後のもの
  const shownTurn =
    conversation.turns.find((turn) => turn.id === selection.turnId) ?? conversation.turns.at(-1);

  return (
    <div className="app">
      <TopBar sources={sources} />
      <SourcesNotice state={sources} />
      <main className={sidebar ? "workspace with-history" : "workspace with-rail"}>
        <HistorySidebar
          open={sidebar}
          conversations={listedConversations(history)}
          currentId={history.currentId}
          busy={chat.busy}
          onOpenChange={setSidebar}
          onNew={() => {
            dispatch({ type: "conversation.started", id: crypto.randomUUID(), at: Date.now() });
            evidence.reset();
          }}
          onSelect={(id) => {
            dispatch({ type: "conversation.opened", id });
            evidence.reset();
          }}
          onRemove={(id) => {
            chat.remove(id);
            if (id === history.currentId) evidence.reset();
          }}
        />
        <ChatPanel
          conversation={conversation}
          busy={chat.busy}
          shownTurnId={shownTurn?.id ?? null}
          selectedKeys={new Set(selection.selected)}
          sourceName={nameOf}
          onSend={(question) => {
            evidence.reset();
            void chat.send(question);
          }}
          onStop={() => void chat.stop()}
          onShowEvidence={evidence.showTurn}
          onHoverEvidence={evidence.hover}
          onSelectEvidence={evidence.select}
        />
        <EvidencePanel
          question={shownTurn?.question ?? null}
          answer={shownTurn?.text ?? ""}
          evidence={shownTurn?.evidence ?? []}
          pending={shownTurn?.status === "pending"}
          hovered={shownTurn?.id === selection.turnId ? selection.hovered : []}
          selected={shownTurn?.id === selection.turnId ? selection.selected : []}
          sourceName={nameOf}
          embedOriginOf={(sourceId) => embedOriginOf(sources, sourceId)}
          onHover={(key) => shownTurn && evidence.hover(shownTurn.id, key ? [key] : [])}
          onSelect={(key) => shownTurn && evidence.select(shownTurn.id, [key])}
        />
      </main>
    </div>
  );
}
