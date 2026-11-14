/**
 * 手元で動かすときの、画面とサーバーの住所の約束（設計 §7.4・§9）。
 * 画面（Vite）はこの住所で開き、サーバーはこの住所からの要求だけを受け付ける。
 * 画面の番号は、文之助の画面が 5173 を使うので 5174 に固定する。
 */

/** 画面を開く名前（ループバックだけ） */
export const WEB_DEV_HOST = "127.0.0.1";
/** 画面を開く番号 */
export const WEB_DEV_PORT = 5174;
/** サーバーが受け付ける画面の住所（origin）。部品の画面と同じく 127.0.0.1 と localhost の両方を許す */
export const WEB_DEV_ORIGINS: readonly string[] = [
  `http://127.0.0.1:${WEB_DEV_PORT}`,
  `http://localhost:${WEB_DEV_PORT}`,
];

/** サーバーが待ち受ける既定の名前と番号（apps/server/.env の SERVER_HOST・SERVER_PORT で替えられる） */
export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 8787;
