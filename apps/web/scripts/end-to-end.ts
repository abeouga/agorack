/**
 * 通しの確認：動いている本物の画面（npm run dev）に質問を送り、答え・道具・根拠を記録してスクショを撮る。
 *
 *   npm run dev                                  # 画面とサーバー（手元の文之助につなぐ）
 *   npm run end-to-end -w @agorack/web           # 4問すべて
 *   npm run end-to-end -w @agorack/web -- 1 3    # 1問目と3問目だけ（Claude を呼ぶ回数を減らすため）
 *
 * 質問ごとに新しい会話で送る。Claude の API を使うので、回すたびに呼び出しが増える。
 * 出力は apps/web/screenshots/（Git に入れない）：e2e-<番号>.png と e2e-<番号>.json（頭は AGORACK_E2E_PREFIX で替えられる）。
 * ブラウザーは手元の Microsoft Edge（Playwright の channel: "msedge"）を使う。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Locator, type Page, chromium } from "playwright";

const URL_BASE = process.env.AGORACK_WEB_URL ?? "http://127.0.0.1:5174";
const outDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
/** 出力の名前の頭（部品を止めた状態などで撮り分けるとき：AGORACK_E2E_PREFIX=e2e-offline） */
const prefix = process.env.AGORACK_E2E_PREFIX ?? "e2e";
/** Claude の答えを待つ時間（道具を何度か呼ぶので長めにする） */
const ANSWER_TIMEOUT = 240_000;

export const questions = [
  "こよみの毛色は？",
  "こよみの子牛の価格の合計は？",
  "こよみの子牛でいちばん高い価格は？",
  "毛色が黒の牛は？",
] as const;

const picked = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= questions.length);
const targets = picked.length > 0 ? picked : questions.map((_, index) => index + 1);

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ja-JP",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(URL_BASE);
  await page.locator(".source-chip").first().waitFor({ timeout: 30_000 });

  for (const number of targets) {
    const question = questions[number - 1] ?? "";
    await page.locator(".history-new").click();
    const started = Date.now();
    await page.getByLabel("質問").fill(question);
    await page.keyboard.press("Enter");
    await page.locator(".chat-msg.bot").last().waitFor({ timeout: 10_000 });
    await page
      .locator(".chat-msg.bot.pending")
      .waitFor({ state: "detached", timeout: ANSWER_TIMEOUT });
    const seconds = Math.round((Date.now() - started) / 1000);

    // 右の欄の表示が落ち着くまで待つ。部品の埋め込み用の画面は、準備ができるか、代わりの表示に戻るまで待つ
    await page
      .locator(
        ".embed-frame.is-ready, .embed-fallback-notice, .document-box.is-focus, .evidence-fallback, .evidence-empty",
      )
      .first()
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.mouse.move(0, 0);

    const bot = page.locator(".chat-msg.bot").last();
    const linkedRows = await page.locator("tr.has-source").count();
    const record: Record<string, unknown> = {
      number,
      question,
      seconds,
      answer: (await textOf(bot.locator(".chat-answer"))) ?? "",
      failure: await textOf(bot.locator(".chat-failed")),
      tools: await bot.locator(".chat-tool").allTextContents(),
      evidenceCount: await page.locator(".evidence-item").count(),
      linkedRows,
      embed: await embedState(page),
      boxes: await page.locator(".document-box").count(),
      focusBox: (await page.locator(".document-box.is-focus").count()) > 0,
      focus: await textOf(page.locator(".document-focus")),
      evidence: await page.locator(".evidence-item").allTextContents(),
    };
    await page.screenshot({ path: `${outDir}${prefix}-${number}.png` });

    // 答えの表に根拠とつながる行が2つ以上あれば、別の行（AGORACK_E2E_ROW 行目、既定は5つめ）を押して撮る。
    // 埋め込み用の画面なら、iframe を作り直していない（読み直していない）ことも確かめる
    if (linkedRows >= 2) {
      const index = Math.min(Number(process.env.AGORACK_E2E_ROW ?? 5), linkedRows) - 1;
      const before = await page
        .locator("iframe.embed-frame")
        .elementHandle()
        .catch(() => null);
      await page.locator("tr.has-source").nth(index).click();
      await page.waitForTimeout(1500);
      await page.mouse.move(0, 0);
      record.selectedRow = index + 1;
      record.selectedEvidence = await textOf(page.locator(".evidence-item.is-selected"));
      record.sameFrameAfterSelect = before
        ? await page.evaluate(
            (frame) => frame === document.querySelector("iframe.embed-frame"),
            before,
          )
        : null;
      await page.screenshot({ path: `${outDir}${prefix}-${number}-row.png` });
    }
    await writeFile(
      `${outDir}${prefix}-${number}.json`,
      `${JSON.stringify(record, null, 2)}
`,
    );
    console.log(
      `${number}. ${question}（${seconds}秒）根拠 ${String(record.evidenceCount)} 件・埋め込み ${String(record.embed)}`,
    );
  }
} finally {
  await browser.close();
}

/** 右の欄の部品の埋め込み用の画面の状態 */
async function embedState(page: Page): Promise<string> {
  if ((await page.locator(".embed-fallback-notice").count()) > 0) return "fallback";
  if ((await page.locator(".embed-frame.is-ready").count()) > 0) return "ready";
  if ((await page.locator(".embed-frame").count()) > 0) return "loading";
  return "none";
}

/** 要素があれば文字を返し、なければ待たずに null を返す */
async function textOf(locator: Locator): Promise<string | null> {
  return (await locator.count()) > 0 ? locator.first().textContent() : null;
}
