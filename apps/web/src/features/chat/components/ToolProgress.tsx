import { FiAlertTriangle, FiCheck, FiMinusCircle } from "react-icons/fi";
import { Spinner } from "../../../shared/Spinner";
import { progressText } from "../progress";
import type { ToolCall } from "../state/conversation";

/** 道具の呼び出しの進み具合（どの部品で何をしているか） */
export function ToolProgress({
  tools,
  sourceName,
}: {
  tools: ToolCall[];
  sourceName: (sourceId: string) => string;
}) {
  if (tools.length === 0) return null;
  return (
    <ul className="chat-tools" aria-label="部品の呼び出し">
      {tools.map((call) => (
        <li
          key={call.callId}
          className={`chat-tool ${call.status}`}
          role={call.status === "running" ? "status" : undefined}
        >
          {call.status === "running" && <Spinner />}
          {call.status === "succeeded" && <FiCheck aria-hidden="true" />}
          {call.status === "failed" && <FiAlertTriangle aria-hidden="true" />}
          {call.status === "cancelled" && <FiMinusCircle aria-hidden="true" />}
          <span>{progressText(call, sourceName(call.sourceId))}</span>
        </li>
      ))}
    </ul>
  );
}
