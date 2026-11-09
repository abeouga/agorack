/**
 * 偽のサーバーにつないだ画面のスクリーンショットを撮る。
 *
 *   npm run screenshots -w @agorack/web
 *
 * ブラウザーはダウンロードせず、手元の Microsoft Edge（Playwright の channel: "msedge"）を使う。
 * 出力先は apps/web/screenshots/（Git に入れない）。
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
  const shoot = async (name: string) => {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${outDir}${name}.png` });
    console.log(`撮りました：screenshots/${name}.png`);
  };

  // ① 最初の画面（部品の状態が出るまで待つ）
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByText("接続中").waitFor({ timeout: TIMEOUT });
  await shoot("01-initial");

  // ② 答えが流れている途中（道具の進み具合が出ている）
  await ask(page, "毛色が黒の牛は？");
  await page.getByText("文之助で書類を探しています").waitFor({ timeout: TIMEOUT });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${outDir}02-streaming.png` });
  console.log("撮りました：screenshots/02-streaming.png");

  // ③ 根拠付きの答え（表の行にホバーして、右の欄の根拠を強調）
  await waitAnswered(page);
  await page.locator("tr.has-source").nth(1).hover();
  await page.locator(".evidence-item.is-highlighted").waitFor({ timeout: TIMEOUT });
  await page.screenshot({ path: `${outDir}03-evidence.png` });
  console.log("撮りました：screenshots/03-evidence.png");

  // ④ 失敗と停止：道具の失敗・turn.failed・停止を1つの会話に並べる
  await page.locator(".history-new").click();
  await ask(page, "ゆうきの書類が見つからないときは？");
  await waitAnswered(page);
  await ask(page, "障害が起きたら？");
  await waitAnswered(page);
  await ask(page, "ゆっくり合計を出して");
  await page.getByText("文之助で値を集計しています").waitFor({ timeout: TIMEOUT });
  await page.getByRole("button", { name: "回答を止める" }).click();
  await page.getByText("回答を止めました。").waitFor({ timeout: TIMEOUT });
  await waitAnswered(page);
  await shoot("04-failures");

  // ⑤ 読み込み直しても履歴が残る（最初の会話を開き直す）
  await page.reload();
  await page.getByText("接続中").waitFor({ timeout: TIMEOUT });
  await page.locator(".history-item", { hasText: "毛色が黒の牛は？" }).click();
  await page.locator("tr.has-source").first().waitFor({ timeout: TIMEOUT });
  await shoot("05-reloaded");
} finally {
  await browser.close();
  await server.close();
}

async function ask(page: Page, question: string) {
  await page.getByLabel("質問").fill(question);
  await page.keyboard.press("Enter");
}

/** 最後の答えが終わる（受け取り中の印が消える）まで待つ */
async function waitAnswered(page: Page) {
  await page.locator(".chat-msg.bot.pending").waitFor({ state: "detached", timeout: TIMEOUT });
}
