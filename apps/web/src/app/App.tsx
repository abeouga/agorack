import { type CSSProperties, useState } from "react";
import { ChatPanel } from "../features/chat/components/ChatPanel";
import { useChat } from "../features/chat/useChat";
import { EvidencePanel } from "../features/evidence/EvidencePanel";
import { readSplit, splitStorage, writeSplit } from "../features/evidence/split";
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

/**
 * 画面全体の枠：上部バーと、左（履歴）・中央（チャット）・右（根拠）の列。
 * 右の欄は、出している答えに根拠があるとき自動で開き、× で閉じるとチャットが広がる（設計 §7.3）。
 */
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
  const [split, setSplitState] = useState(() => readSplit(splitStorage()));
  const setSplit = (ratio: number) => {
    setSplitState(ratio);
    writeSplit(splitStorage(), ratio);
  };

  const conversation = currentConversation(history);
  const nameOf = (sourceId: string) => sourceName(sources, sourceId);
  const { selection } = evidence;
  // 右の欄に出すターン：選んだもの、なければ最後のもの
  const shownTurn =
    conversation.turns.find((turn) => turn.id === selection.turnId) ?? conversation.turns.at(-1);
  const shownSelection = shownTurn?.id === selection.turnId;
  const hovered = shownSelection ? selection.hovered : [];
  const selected = shownSelection ? selection.selected : [];
  const evidenceOpen = !selection.closed && (shownTurn?.evidence.length ?? 0) > 0;
  // チャットと右の欄の幅の分け方（layout.css の .workspace.with-evidence で使う）
  const splitStyle = {
    "--chat-share": `${split}fr`,
    "--evidence-share": `${1 - split}fr`,
  } as CSSProperties;
  const workspaceClass = [
    "workspace",
    sidebar ? "with-history" : "with-rail",
    evidenceOpen ? "with-evidence" : "",
  ].join(" ");

  return (
    <div className="app">
      <TopBar sources={sources} />
      <SourcesNotice state={sources} />
      <main className={workspaceClass.trim()} style={evidenceOpen ? splitStyle : undefined}>
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
          hoveredKeys={hovered}
          selectedKeys={selected}
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
        {evidenceOpen && shownTurn && (
          <EvidencePanel
            answer={shownTurn.text}
            evidence={shownTurn.evidence}
            hovered={hovered}
            selected={selected}
            sourceName={nameOf}
            embedOriginOf={(sourceId) => embedOriginOf(sources, sourceId)}
            split={split}
            onResize={setSplit}
            onSelect={(key) => evidence.select(shownTurn.id, [key])}
            onClose={evidence.close}
          />
        )}
      </main>
    </div>
  );
}
