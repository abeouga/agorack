/**
 * 回答の Markdown を塊（見出し・箇条書き・段落・表）に分ける。
 * 分け方は文之助のチャットの Markdown の表示にそろえ、表（GFM の | 区切り）も扱う。
 * HTML は解かない（答えの文章から要素を差し込めないようにする）。
 */

export type TableAlign = "left" | "center" | "right" | null;

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "table"; header: string[]; align: TableAlign[]; rows: string[][] };

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** 表の1行を欄に分ける。前後の | は省いてよく、\| は欄の中の | として残す */
export function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === "\\" && body[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

const isTableLine = (line: string | undefined) => line !== undefined && line.includes("|");

export function parse(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const result: Block[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const last = result[result.length - 1];
    const next = lines[index + 1];
    if (isTableLine(line) && next !== undefined && SEPARATOR.test(next) && next.includes("-")) {
      const header = splitRow(line);
      const align = splitRow(next).map(alignOf);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableLine(lines[index]) && lines[index]?.trim()) {
        const cells = splitRow(lines[index] ?? "");
        // 欄の数を見出しにそろえる
        rows.push(header.map((_, at) => cells[at] ?? ""));
        index += 1;
      }
      index -= 1;
      result.push({ kind: "table", header, align, rows });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*・]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      result.push({ kind: "paragraph", lines: [] });
    } else if (heading) {
      result.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
    } else if (bullet || numbered) {
      const ordered = !bullet;
      const item = (bullet ?? numbered)?.[1] ?? "";
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else result.push({ kind: "list", ordered, items: [item] });
    } else if (last?.kind === "paragraph") {
      last.lines.push(line);
    } else {
      result.push({ kind: "paragraph", lines: [line] });
    }
  }
  return result.filter((block) => block.kind !== "paragraph" || block.lines.length > 0);
}

/** 印を除いた文字（表の欄を根拠と照らすときに使う） */
export function plainText(text: string): string {
  return text
    .replace(/\\(.)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
