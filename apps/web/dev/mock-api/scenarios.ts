import type { Evidence, SourceInfo, TurnEvent } from "@agorack/contracts";

/**
 * 偽のサーバーが流す、決まったイベントの並び。
 * 質問の言葉で並びを選ぶので、画面から根拠付きの答え・道具の失敗・停止・turn.failed を試せる。
 */

/** 1つのイベントと、その前に待つ時間（ミリ秒） */
export type Step = { wait: number; event: TurnEvent };

export type Scenario = {
  /** 質問がこの言葉を含むときに使う */
  keywords: string[];
  /** 画面の見本の説明（README と偽のサーバーの一覧に出す） */
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
  },
  {
    id: "kabulogger",
    name: "カブロガー",
    description: "走行の記録",
    status: "disabled",
    error: null,
    toolCount: 0,
  },
];

const coat = (no: number, name: string, value: string): Evidence => ({
  kind: "document",
  sourceId: "fuminosuke",
  recordId: `job-${no}`,
  label: `繁殖台帳${no}「${name}」の毛色`,
  location: { field_id: "coat", page_id: "p1", box: { x: 120, y: 340, width: 180, height: 40 } },
  value,
});

const blackCoats = [
  coat(1021, "はじめ", "黒"),
  coat(1034, "こよみ", "黒"),
  coat(1052, "さくら", "黒"),
];

const evidenceAnswer = [
  "毛色が**黒**の牛は、次の3頭です。",
  "",
  "| 書類 | 名前 | 毛色 |",
  "|---|---|---|",
  "| 繁殖台帳1021 | はじめ | 黒 |",
  "| 繁殖台帳1034 | こよみ | 黒 |",
  "| 繁殖台帳1052 | さくら | 黒 |",
  "",
  "値は文之助で確定した帳票から取り出しています。違いそうなときは、文之助の確認画面で確かめてください。",
].join("\n");

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

const evidenceScenario: Scenario = {
  keywords: [],
  description: "根拠付きの答え（表あり）",
  steps: (turnId) => [
    { wait: 150, event: { type: "turn.started", turnId } },
    {
      wait: 300,
      event: {
        type: "tool.called",
        callId: "call-1",
        sourceId: "fuminosuke",
        tool: "search_documents",
        input: { field: "毛色", value: "黒" },
      },
    },
    {
      wait: 1600,
      event: {
        type: "tool.completed",
        callId: "call-1",
        ok: true,
        evidence: blackCoats,
        summary: "書類を3件見つけました",
      },
    },
    ...deltas(evidenceAnswer),
    {
      wait: 100,
      event: {
        type: "turn.completed",
        text: evidenceAnswer,
        evidence: blackCoats,
        reason: "end_turn",
      },
    },
  ],
};

export const scenarios: Scenario[] = [
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
