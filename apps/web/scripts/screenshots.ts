/**
 * 偽のサーバーにつないだ画面のスクリーンショットを撮る。
 *
 *   npm run screenshots -w @agorack/web
 *
 * ブラウザーはダウンロードせず、手元の Microsoft Edge（Playwright の channel: "msedge"）を使う。
 * 出力先は apps/web/screenshots/（Git に入れない）。
 * 書類のページ画像は手元の文之助（127.0.0.1:8010）から読む。止まっていると evidence-01・02 は撮れない。
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Page, chromium } from "playwright";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
/** 開発用の画面（5174）と重ならない番号で開く */
const PORT = 5199;
const TIMEOUT = 15_000;

const server = await createServer({
  root: webRoot,
  mode: "mock",
  logLevel: "warn",
  server: { port: PORT, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({ channel: "msedge" });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "ja-JP",
    // 出入りの動きを止め、撮るたびに同じ絵にする
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await mkdir(outDir, { recursive: true });
  const shoot = async (name: string, { moveAway = true } = {}) => {
    if (moveAway) await page.mouse.move(0, 0);
    await page.screenshot({ path: `${outDir}${name}.png` });
    console.log(`撮りました：screenshots/${name}.png`);
  };

  // ---- チャット（#9） ----

  // 最初の画面（部品の状態が出るまで待つ）
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByText("接続中").first().waitFor({ timeout: TIMEOUT });
  await shoot("chat-01-initial");

  // 答えが流れている途中（道具の進み具合が出ている）
  await ask(page, "こよみの売却子牛の価格の合計は？");
  await page.getByText("文之助で値を集計しています").waitFor({ timeout: TIMEOUT });
  await shoot("chat-02-streaming");

  // 根拠付きの答え（表の行にホバーして、右の欄の根拠を強調）
  await waitAnswered(page);
  await waitPageImage(page);
  await page.locator("tr.has-source").nth(1).hover();
  await page.locator(".evidence-item.is-highlighted").waitFor({ timeout: TIMEOUT });
  await shoot("chat-03-evidence", { moveAway: false });

  // ---- 右の欄（#10） ----

  // ① 書類のページに枠が出ている（拡大して、選んだ欄の枠を見えるところへ）
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "拡大" }).click();
  await page.getByRole("button", { name: "拡大" }).click();
  await settle(page);
  await shoot("evidence-01-document");

  // ② 表の別の行を選ぶと枠が替わる（6行目を押す）
  await page.locator("tr.has-source").nth(4).click();
  await page.locator(".evidence-item.is-selected").waitFor({ timeout: TIMEOUT });
  await settle(page);
  await shoot("evidence-02-row-selected");

  // ③ 知らない kind の根拠（ラベルと値だけ）
  await newConversation(page);
  await ask(page, "11月3日の朝の走行は？");
  await waitAnswered(page);
  await page.locator(".evidence-fallback").waitFor({ timeout: TIMEOUT });
  await shoot("evidence-03-unknown-kind");

  // ④ ページ画像が読めないとき（ラベルと値の表示に戻る）
  await newConversation(page);
  await ask(page, "はなこの書類の画像は？");
  await waitAnswered(page);
  await page.locator(".evidence-fallback-notice").waitFor({ timeout: TIMEOUT });
  await shoot("evidence-04-image-failed");

  // ---- 失敗・停止と、読み込み直し（#9） ----

  await newConversation(page);
  await ask(page, "ゆうきの書類が見つからないときは？");
  await waitAnswered(page);
  await ask(page, "障害が起きたら？");
  await waitAnswered(page);
  await ask(page, "ゆっくり合計を出して");
  await page.getByText("文之助で値を集計しています").waitFor({ timeout: TIMEOUT });
  await page.getByRole("button", { name: "回答を止める" }).click();
  await page.getByText("回答を止めました。").waitFor({ timeout: TIMEOUT });
  await waitAnswered(page);
  await shoot("chat-04-failures");

  // 読み込み直しても履歴が残る（最初の会話を開き直す）
  await page.reload();
  await page.getByText("接続中").first().waitFor({ timeout: TIMEOUT });
  await page.locator(".history-item", { hasText: "こよみの売却子牛の価格の合計は？" }).click();
  await page.locator("tr.has-source").first().waitFor({ timeout: TIMEOUT });
  await waitPageImage(page);
  await shoot("chat-05-reloaded");
} finally {
  await browser.close();
  await server.close();
}

async function ask(page: Page, question: string) {
  await page.getByLabel("質問").fill(question);
  await page.keyboard.press("Enter");
}

async function newConversation(page: Page) {
  await page.locator(".history-new").click();
}

/** 最後の答えが終わる（受け取り中の印が消える）まで待つ */
async function waitAnswered(page: Page) {
  await page.locator(".chat-msg.bot.pending").waitFor({ state: "detached", timeout: TIMEOUT });
}

/** 書類のページ画像が読み込まれ、枠が描かれるまで待つ */
async function waitPageImage(page: Page) {
  await page.locator(".document-box.is-focus").waitFor({ timeout: TIMEOUT });
}

/** 枠を見えるところへ動かす滑らかなスクロールが終わるのを待つ */
async function settle(page: Page) {
  await page.waitForTimeout(800);
}
