import { FiClock, FiMessageSquare, FiPlus, FiSidebar, FiTrash2 } from "react-icons/fi";
import type { Conversation } from "../chat/state/conversation";

/**
 * 左の欄：会話の履歴（見た目と動きは文之助のチャットにそろえる）。
 * 閉じているときはアイコンだけの細い列（レール）にし、開くと日付ごとに会話を並べる。
 */
export function HistorySidebar({
  open,
  conversations,
  currentId,
  busy,
  onOpenChange,
  onNew,
  onSelect,
  onRemove,
}: {
  open: boolean;
  /** 新しい順 */
  conversations: Conversation[];
  currentId: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const groups = groupByDay(conversations, new Date());
  return (
    <div className={open ? "history-side open" : "history-side"}>
      <nav className="history-rail" aria-label="会話の履歴" inert={open}>
        <button
          type="button"
          className="icon-button"
          aria-label="履歴を開く"
          title="履歴を開く"
          onClick={() => onOpenChange(true)}
        >
          <FiSidebar aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button history-rail-new"
          disabled={busy}
          aria-label="新しい会話"
          title="新しい会話"
          onClick={onNew}
        >
          <FiPlus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="履歴を見る"
          title="履歴を見る"
          onClick={() => onOpenChange(true)}
        >
          <FiClock aria-hidden="true" />
        </button>
      </nav>
      <nav className="history" aria-label="会話の履歴" inert={!open}>
        <button
          type="button"
          className="icon-button history-close"
          aria-label="履歴を閉じる"
          title="履歴を閉じる"
          onClick={() => onOpenChange(false)}
        >
          <FiSidebar aria-hidden="true" />
        </button>
        <button type="button" className="history-new" disabled={busy} onClick={onNew}>
          <FiPlus aria-hidden="true" />
          新しい会話
        </button>
        <div className="history-scroll">
          {groups.map((group) => (
            <section key={group.name} className="history-group">
              <h2>{group.name}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id} className={item.id === currentId ? "active" : undefined}>
                    <button
                      type="button"
                      className="history-item"
                      disabled={busy && item.id !== currentId}
                      aria-current={item.id === currentId ? "true" : undefined}
                      title={item.title}
                      onClick={() => onSelect(item.id)}
                    >
                      <FiMessageSquare aria-hidden="true" />
                      <span>{item.title}</span>
                    </button>
                    <button
                      type="button"
                      className="history-remove"
                      disabled={busy && item.id === currentId}
                      aria-label={`「${item.title}」を履歴から削除`}
                      title="履歴から削除"
                      onClick={() => onRemove(item.id)}
                    >
                      <FiTrash2 aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </nav>
    </div>
  );
}

const DAY = 24 * 60 * 60 * 1000;

export function historyGroup(updatedAt: number, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (updatedAt >= today) return "今日";
  if (updatedAt >= today - DAY) return "昨日";
  if (updatedAt >= today - 7 * DAY) return "過去7日間";
  if (updatedAt >= today - 30 * DAY) return "過去30日間";
  return "それ以前";
}

function groupByDay(conversations: Conversation[], now: Date) {
  const groups: { name: string; items: Conversation[] }[] = [];
  for (const item of conversations) {
    const name = historyGroup(item.updatedAt, now);
    const group = groups.find((entry) => entry.name === name);
    if (group) group.items.push(item);
    else groups.push({ name, items: [item] });
  }
  return groups;
}
