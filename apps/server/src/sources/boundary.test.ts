import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("..", import.meta.url));
const sourcesDir = fileURLToPath(new URL(".", import.meta.url));

function typeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return typeScriptFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("MCP の SDK の置き場所", () => {
  it("MCP の SDK を import するのは sources/ の中だけ", () => {
    const outside = typeScriptFiles(srcDir)
      .filter((path) => !path.startsWith(sourcesDir))
      .filter((path) => /from\s+["']@modelcontextprotocol\//.test(readFileSync(path, "utf8")))
      .map((path) => relative(srcDir, path));

    expect(outside).toEqual([]);
  });
});
