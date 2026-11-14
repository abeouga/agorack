/**
 * 通しの確認：動いている本物の画面（npm run dev）に質問を送り、答え・道具・根拠を記録してスクショを撮る。
 *
 *   npm run dev                                  # 画面とサーバー（手元の文之助につなぐ）
 *   npm run end-to-end -w @agorack/web           # 4問すべて
 *   npm run end-to-end -w @agorack/web -- 1 3    # 1問目と3問目だけ（Claude を呼ぶ回数を減らすため）
 *
 * 質問ごとに新しい会話で送る。Claude の API を使うので、回すたびに呼び出しが増える。
 * 答えの下の根拠の一覧を開いて撮る。表の行を押したあと（-row.png）と、根拠が2つ以上の書類にまたがるときに
 * 一覧で2つめの書類に切り替えたあと（-doc.png）も撮る。
 * 出力は apps/web/screenshots/（Git に入れない）：e2e-<番号>.png と e2e-<番号>.json（頭は AGORACK_E2E_PREFIX で替えられる）。
 * ブラウザーは手元の Microsoft Edge（Playwright の channel: "msedge"）を使う。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WEB_DEV_HOST, WEB_DEV_PORT } from "@agorack/contracts/dev";
import { type Locator, type Page, chromium } from "playwright";

/** 開く画面の住所（既定は開発用の画面。AGORACK_WEB_URL で替えられる） */
const URL_BASE = process.env.AGORACK_WEB_URL ?? `http://${WEB_DEV_HOST}:${WEB_DEV_PORT}`;
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

    // 右の欄の表示が落ち着くまで待つ。部品の埋め込み用の画面は、準備ができるか、代わりの表示に戻るまで待つ。
    // 根拠のない答えでは右の欄を開かないので、待たない
    if ((await page.locator(".evidence-panel").count()) > 0) {
      await page
        .locator(".embed-frame.is-ready, .document-box.is-focus, .evidence-fallback")
        .first()
        .waitFor({ timeout: 30_000 });
    }
    await page.waitForTimeout(1500);

    // 答えの下の根拠の一覧を開く
    const bot = page.locator(".chat-msg.bot").last();
    const evidenceButton = bot.locator(".chat-evidence-button");
    if ((await evidenceButton.count()) > 0) {
      await evidenceButton.click();
      await bot.locator(".chat-evidence").waitFor({ timeout: 5_000 });
    }
    await page.mouse.move(0, 0);

    const linkedRows = await bot.locator("tr.has-source").count();
    const record: Record<string, unknown> = {
      number,
      question,
      seconds,
      answer: (await textOf(bot.locator(".chat-answer"))) ?? "",
      failure: await textOf(bot.locator(".chat-failed")),
      tools: await bot.locator(".chat-tool").allTextContents(),
      evidenceCount: Number(/根拠 (\d+)件/.exec((await textOf(evidenceButton)) ?? "")?.[1] ?? 0),
      documents: await bot.locator(".chat-evidence-record-title").allTextContents(),
      activeRow: await textOf(bot.locator("tr.has-source.active")),
      linkedRows,
      embed: await embedState(page),
      boxes: await page.locator(".document-box").count(),
      focusBox: (await page.locator(".document-box.is-focus").count()) > 0,
      documentTitle: await textOf(page.locator(".document-title")),
      notice: await textOf(page.locator(".document-notice, .evidence-fallback-notice")),
      evidence: await bot.locator(".chat-evidence-item").allTextContents(),
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
      await bot.locator("tr.has-source").nth(index).click();
      await page.waitForTimeout(1500);
      await page.mouse.move(0, 0);
      record.selectedRow = index + 1;
      record.selectedEvidence = await textOf(bot.locator(".chat-evidence-item.is-selected"));
      record.sameFrameAfterSelect = before
        ? await page.evaluate(
            (frame) => frame === document.querySelector("iframe.embed-frame"),
            before,
          )
        : null;
      await page.screenshot({ path: `${outDir}${prefix}-${number}-row.png` });
    }

    // 根拠が2つ以上の書類にまたがるなら、答えの下の一覧で2つめの書類に切り替えて撮る
    const records = bot.locator(".chat-evidence-record");
    if ((await records.count()) >= 2) {
      await records.nth(1).click();
      await page.waitForTimeout(1500);
      await page.mouse.move(0, 0);
      record.switchedDocument = await textOf(
        bot.locator(".chat-evidence-record.active .chat-evidence-record-title"),
      );
      record.evidenceAfterSwitch = await bot.locator(".chat-evidence-item").allTextContents();
      record.embedAfterSwitch = await page
        .locator("iframe.embed-frame")
        .getAttribute("src")
        .catch(() => null);
      await page.screenshot({ path: `${outDir}${prefix}-${number}-doc.png` });
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
  // 埋め込めなかった知らせは、kind ごとの表示の中（書類なら道具の行の下）に出る
  const notice = await textOf(page.locator(".document-notice, .evidence-fallback-notice"));
  if (notice?.includes("埋め込めませんでした")) return "fallback";
  if ((await page.locator(".embed-frame.is-ready").count()) > 0) return "ready";
  if ((await page.locator(".embed-frame").count()) > 0) return "loading";
  return "none";
}

/** 要素があれば文字を返し、なければ待たずに null を返す */
async function textOf(locator: Locator): Promise<string | null> {
  return (await locator.count()) > 0 ? locator.first().textContent() : null;
}
