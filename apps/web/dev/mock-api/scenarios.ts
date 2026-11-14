import type { Evidence, SourceInfo, TurnEvent } from "@agorack/contracts";
import { MOCK_EMBED_ORIGIN } from "./embed-origin";
import {
  KOYOMI_PRICE_TOTAL,
  koyomiFields,
  koyomiFieldsSilent,
  koyomiPrices,
  missingImage,
  unknownKind,
} from "./evidence";

/**
 * 偽のサーバーが流す、決まったイベントの並び。
 * 質問の言葉で並びを選ぶので、画面から根拠付きの答え・道具の失敗・停止・turn.failed・
 * 知らない kind の根拠・ページ画像の読めない根拠を試せる。
 */

/** 1つのイベントと、その前に待つ時間（ミリ秒） */
export type Step = { wait: number; event: TurnEvent };

export type Scenario = {
  /** 質問がこの言葉を含むときに使う */
  keywords: string[];
  /** 一覧の説明 */
  description: string;
  steps: (turnId: string) => Step[];
};

export const mockSources: SourceInfo[] = [
  {
    id: "fuminosuke",
    name: "文之助",
    description: "帳票の読み取りで人が確定した値",
    status: "connected",
    error: null,
    toolCount: 6,
    // 文之助の埋め込み用の画面の代わりに、偽の埋め込み用の画面（別の住所）を許す
    embedOrigin: MOCK_EMBED_ORIGIN,
  },
  {
    id: "kabulogger",
    name: "カブロガー",
    description: "走行の記録（偽のサーバーの見本）",
    status: "connected",
    error: null,
    toolCount: 2,
    embedOrigin: null,
  },
];

/** 根拠付きで答える並び：道具を1回呼び、根拠を返し、答えを流して終える */
function answerScenario(options: {
  keywords: string[];
  description: string;
  call: { sourceId: string; tool: string; input: Record<string, unknown> };
  evidence: Evidence[];
  summary: string;
  answer: string;
}): Scenario {
  return {
    keywords: options.keywords,
    description: options.description,
    steps: (turnId) => [
      { wait: 150, event: { type: "turn.started", turnId } },
      { wait: 300, event: { type: "tool.called", callId: "call-1", ...options.call } },
      {
        wait: 1600,
        event: {
          type: "tool.completed",
          callId: "call-1",
          ok: true,
          evidence: options.evidence,
          summary: options.summary,
        },
      },
      ...deltas(options.answer),
      {
        wait: 100,
        event: {
          type: "turn.completed",
          text: options.answer,
          evidence: options.evidence,
          reason: "end_turn",
        },
      },
    ],
  };
}

const priceRows = koyomiPrices.map((item) => {
  const row = /(\d+)行目/.exec(item.label)?.[1] ?? "";
  return `| ${row}行目 | ${String(item.value)} |`;
});

/** 根拠付きの答え（表あり）：文之助の aggregate（1つの書類の売却子牛の価格の合計） */
const evidenceScenario = answerScenario({
  keywords: [],
  description: "根拠付きの答え（表あり。書類の枠が出る）",
  call: {
    sourceId: "fuminosuke",
    tool: "aggregate",
    input: {
      template: "繁殖台帳1021",
      document: "こよみ",
      field: "売却子牛一覧 価格",
      operation: "sum",
    },
  },
  evidence: koyomiPrices,
  summary: "合計を出しました（7件、空欄3件）",
  answer: [
    `こよみ（繁殖台帳1021）の売却子牛の価格の合計は **${KOYOMI_PRICE_TOTAL}** です（7件。空欄の3件は除いています）。`,
    "",
    "| 行 | 価格 |",
    "|---|---:|",
    ...priceRows,
    "",
    "値は文之助で確定した帳票から取り出しています。違いそうなときは、文之助の確認画面で確かめてください。",
  ].join("\n"),
});

const notFoundAnswer =
  "「ゆうき」という名前の書類は、文之助で見つかりませんでした。名前の書き方を変えて、もう一度聞いてください。";

const slowAnswer = "体重の合計を出しました。読めなかった値はありません。";

/** 文章を小さな断片に分けて text.delta にする */
function deltas(text: string, wait = 35, size = 4): Step[] {
  const steps: Step[] = [];
  for (let at = 0; at < text.length; at += size) {
    steps.push({ wait, event: { type: "text.delta", text: text.slice(at, at + size) } });
  }
  return steps;
}

export const scenarios: Scenario[] = [
  answerScenario({
    keywords: ["埋め込めない"],
    description: "埋め込み用の画面が応えない根拠（時間切れで、ページ画像に枠の表示に戻る）",
    call: { sourceId: "fuminosuke", tool: "get_document", input: { document: "こよみ" } },
    evidence: koyomiFieldsSilent,
    summary: "書類を1件読みました",
    answer: "こよみ（繁殖台帳1021）の毛色は **褐** です。",
  }),
  answerScenario({
    keywords: ["毛色", "父", "母"],
    description: "書類の欄の根拠（get_document）",
    call: { sourceId: "fuminosuke", tool: "get_document", input: { document: "こよみ" } },
    evidence: koyomiFields,
    summary: "書類を1件読みました",
    answer: [
      "こよみ（繁殖台帳1021）の欄は次のとおりです。",
      "",
      "| 欄 | 値 |",
      "|---|---|",
      ...koyomiFields.map((item) => {
        const label = item.label.replace(/^.*」の/, "");
        return `| ${label} | ${String(item.value)} |`;
      }),
    ].join("\n"),
  }),
  answerScenario({
    keywords: ["画像"],
    description: "ページ画像が読めない根拠（ラベルと値の表示に戻る）",
    call: { sourceId: "fuminosuke", tool: "get_document", input: { document: "はなこ" } },
    evidence: [missingImage],
    summary: "書類を1件読みました",
    answer: "はなこ（繁殖台帳1021）の毛色は **黒** です。",
  }),
  answerScenario({
    keywords: ["走行"],
    description: "画面が表示を知らない kind の根拠（ラベルと値だけ）",
    call: { sourceId: "kabulogger", tool: "get_ride", input: { date: "2026-11-03" } },
    evidence: unknownKind,
    summary: "走行を1件見つけました",
    answer: [
      "11月3日の朝の走行は次のとおりです。",
      "",
      "| 項目 | 値 |",
      "|---|---|",
      "| 距離 | 12.4 km |",
      "| 平均速度 | 39 km/h |",
    ].join("\n"),
  }),
  {
    keywords: ["失敗", "見つから"],
    description: "道具の失敗（書類が見つからない）",
    steps: (turnId) => [
      { wait: 150, event: { type: "turn.started", turnId } },
      {
        wait: 300,
        event: {
          type: "tool.called",
          callId: "call-1",
          sourceId: "fuminosuke",
          tool: "get_document",
          input: { name: "ゆうき" },
        },
      },
      {
        wait: 1200,
        event: {
          type: "tool.completed",
          callId: "call-1",
          ok: false,
          evidence: [],
          summary: "書類が見つかりません（名前：ゆうき）",
        },
      },
      ...deltas(notFoundAnswer),
      {
        wait: 100,
        event: { type: "turn.completed", text: notFoundAnswer, evidence: [], reason: "end_turn" },
      },
    ],
  },
  {
    keywords: ["障害", "エラー"],
    description: "turn.failed（Claude の呼び出しの失敗）",
    steps: (turnId) => [
      { wait: 150, event: { type: "turn.started", turnId } },
      ...deltas("確認して"),
      {
        wait: 600,
        event: {
          type: "turn.failed",
          code: "model_error",
          message: "Claude の呼び出しに失敗しました。しばらくしてから、もう一度送ってください。",
        },
      },
    ],
  },
  {
    keywords: ["ゆっくり", "止め"],
    description: "時間のかかる答え（停止を試す）",
    steps: (turnId) => [
      { wait: 150, event: { type: "turn.started", turnId } },
      {
        wait: 300,
        event: {
          type: "tool.called",
          callId: "call-1",
          sourceId: "fuminosuke",
          tool: "aggregate",
          input: { field: "体重", op: "sum" },
        },
      },
      {
        wait: 30_000,
        event: {
          type: "tool.completed",
          callId: "call-1",
          ok: true,
          evidence: [],
          summary: "合計を出しました",
        },
      },
      ...deltas(slowAnswer, 400),
      {
        wait: 100,
        event: { type: "turn.completed", text: slowAnswer, evidence: [], reason: "end_turn" },
      },
    ],
  },
];

/** 質問に合う並びを選ぶ。どれにも合わなければ根拠付きの答え */
export function pickScenario(question: string): Scenario {
  return (
    scenarios.find((scenario) => scenario.keywords.some((word) => question.includes(word))) ??
    evidenceScenario
  );
}
