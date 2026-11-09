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
import { type Locator, chromium } from "playwright";

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

    // 右の欄の表示が落ち着くまで待つ（書類の画像の読み込み・枠を見えるところへ動かす）
    await page
      .locator(".document-box.is-focus, .evidence-fallback, .evidence-empty")
      .first()
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.mouse.move(0, 0);

    // 答えの表に根拠とつながる行があれば、最後の行にホバーして右の欄の強調を撮る
    const linkedRows = await page.locator("tr.has-source").count();
    if (linkedRows > 0) {
      await page.locator("tr.has-source").last().hover();
      await page.waitForTimeout(1000);
    }

    const bot = page.locator(".chat-msg.bot").last();
    const record = {
      number,
      question,
      seconds,
      answer: (await textOf(bot.locator(".chat-answer"))) ?? "",
      failure: await textOf(bot.locator(".chat-failed")),
      tools: await bot.locator(".chat-tool").allTextContents(),
      evidenceCount: await page.locator(".evidence-item").count(),
      linkedRows,
      boxes: await page.locator(".document-box").count(),
      focusBox: (await page.locator(".document-box.is-focus").count()) > 0,
      focus: await textOf(page.locator(".document-focus")),
      evidence: await page.locator(".evidence-item").allTextContents(),
    };
    await writeFile(`${outDir}${prefix}-${number}.json`, `${JSON.stringify(record, null, 2)}\n`);
    await page.screenshot({ path: `${outDir}${prefix}-${number}.png` });
    console.log(
      `${number}. ${question}（${seconds}秒）根拠 ${record.evidenceCount} 件・枠 ${record.boxes} 個`,
    );
  }
} finally {
  await browser.close();
}

/** 要素があれば文字を返し、なければ待たずに null を返す */
async function textOf(locator: Locator): Promise<string | null> {
  return (await locator.count()) > 0 ? locator.first().textContent() : null;
}
