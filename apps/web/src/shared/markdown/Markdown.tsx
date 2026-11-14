import { Fragment, type ReactNode, useEffect, useRef } from "react";
import { type Block, parse, plainText } from "./parse";

/**
 * 回答の Markdown の表示（見出し #〜###・箇条書き・段落と改行・**太字**・*強調*・`コード`・\ の打ち消し・表）。
 * 表示は文之助のチャットにそろえる。React の要素だけを作り HTML は解かないので、答えの文章から要素を差し込めない。
 * 「_」は強調にしない（「検証_個体A」のような書類名をそのまま出すため）。
 */

/** 表の行と、行に対応するもの（根拠）をつなぐ。欄は印を除いた文字で渡す */
export type TableRowBinding = {
  linked: (cells: string[]) => boolean;
  active: (cells: string[]) => boolean;
  onHover: (cells: string[] | null) => void;
  onSelect: (cells: string[]) => void;
};

export function Markdown({
  text,
  className,
  rows,
}: {
  text: string;
  className?: string;
  rows?: TableRowBinding;
}) {
  return <div className={className}>{blocks(parse(text), rows)}</div>;
}

function blocks(parsed: Block[], rows: TableRowBinding | undefined): ReactNode[] {
  return parsed.map((block, index) => {
    switch (block.kind) {
      case "heading": {
        const Tag = (["h3", "h4", "h5"] as const)[block.level - 1] ?? "h5";
        return <Tag key={index}>{inline(block.text)}</Tag>;
      }
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </Tag>
        );
      }
      case "table":
        return <MarkdownTable key={index} block={block} rows={rows} />;
      case "paragraph":
        return (
          <p key={index}>
            {block.lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
    }
  });
}

/** 答えの表。根拠のある行は、ホバーで右の欄の根拠を強調し、押すと選ぶ */
function MarkdownTable({
  block,
  rows,
}: {
  block: Extract<Block, { kind: "table" }>;
  rows: TableRowBinding | undefined;
}) {
  // 表が画面から消えたら、ホバーの強調を残さない
  const hover = useRef(rows?.onHover);
  useEffect(() => {
    hover.current = rows?.onHover;
  });
  useEffect(() => () => hover.current?.(null), []);
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th key={index} style={{ textAlign: block.align[index] ?? undefined }}>
                {inline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody onMouseLeave={() => rows?.onHover(null)}>
          {block.rows.map((row, rowIndex) => {
            const cells = row.map(plainText);
            const linked = rows?.linked(cells) ?? false;
            const active = linked && (rows?.active(cells) ?? false);
            return (
              <tr
                key={rowIndex}
                className={linked ? `has-source${active ? " active" : ""}` : undefined}
                title={linked ? "根拠を見る" : undefined}
                onMouseEnter={() => rows?.onHover(linked ? cells : null)}
                onClick={linked ? () => rows?.onSelect(cells) : undefined}
              >
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                    {cell ? inline(cell) : <span className="md-empty">—</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 行の中の印。内側から：打ち消しとコードはそのまま、次に太字、次に強調 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let i = 0;
  const flush = () => {
    if (plain) {
      out.push(plain);
      plain = "";
    }
  };
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push(<code key={out.length}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith("**", i)) {
      const end = closing(text, "**", i + 2);
      if (end > i + 2) {
        flush();
        out.push(<strong key={out.length}>{inline(text.slice(i + 2, end))}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (char === "*" && text[i + 1] !== "*") {
      const end = closing(text, "*", i + 1);
      if (end > i + 1) {
        flush();
        out.push(<em key={out.length}>{inline(text.slice(i + 1, end))}</em>);
        i = end + 1;
        continue;
      }
    }
    plain += char;
    i += 1;
  }
  flush();
  return out;
}

/** from 以降で、打ち消されていない次の mark の位置。なければ -1 */
function closing(text: string, mark: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text.startsWith(mark, i) && (mark !== "*" || text[i + 1] !== "*")) return i;
    if (mark === "*" && text.startsWith("**", i)) i += 1;
  }
  return -1;
}
