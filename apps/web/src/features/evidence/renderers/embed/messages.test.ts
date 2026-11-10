import { describe, expect, it } from "vitest";
import { readEmbedMessage } from "./messages";

const frame = { name: "埋め込んだ画面" };
const ORIGIN = "http://127.0.0.1:5180";
const expected = { source: frame, origin: ORIGIN };

describe("埋め込み用の画面からのメッセージ", () => {
  it("この iframe から、許した住所で、形の合うものだけを使う", () => {
    expect(
      readEmbedMessage({ source: frame, origin: ORIGIN, data: { type: "embed:ready" } }, expected),
    ).toEqual({
      type: "embed:ready",
    });
    expect(
      readEmbedMessage(
        {
          source: frame,
          origin: ORIGIN,
          data: { type: "embed:error", code: "DOCUMENT_NOT_FOUND" },
        },
        expected,
      ),
    ).toEqual({ type: "embed:error", code: "DOCUMENT_NOT_FOUND" });
    expect(
      readEmbedMessage({ source: frame, origin: ORIGIN, data: { type: "embed:close" } }, expected),
    ).toEqual({ type: "embed:close" });
  });

  it.each([
    [
      "ほかの住所から",
      { source: frame, origin: "http://127.0.0.1:5181", data: { type: "embed:ready" } },
    ],
    [
      "localhost から（127.0.0.1 と別の住所）",
      { source: frame, origin: "http://localhost:5180", data: { type: "embed:ready" } },
    ],
    ["ほかの窓から", { source: { name: "別の窓" }, origin: ORIGIN, data: { type: "embed:ready" } }],
    ["知らない type", { source: frame, origin: ORIGIN, data: { type: "embed:hello" } }],
    ["code のない embed:error", { source: frame, origin: ORIGIN, data: { type: "embed:error" } }],
    ["文字だけ", { source: frame, origin: ORIGIN, data: "embed:ready" }],
  ])("%s届いたものは使わない", (_name, event) => {
    expect(readEmbedMessage(event, expected)).toBeNull();
  });

  it("iframe がまだない（contentWindow がない）ときは使わない", () => {
    expect(
      readEmbedMessage(
        { source: undefined, origin: ORIGIN, data: { type: "embed:ready" } },
        {
          source: undefined,
          origin: ORIGIN,
        },
      ),
    ).toBeNull();
  });
});
