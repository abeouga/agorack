/**
 * 偽の埋め込み用の画面の住所（Agorack の画面・偽のサーバーと別の origin にする）。
 * Vite の設定（plugin.ts）からも読むので、ほかを import しない。
 */
export const MOCK_EMBED_PORT = 5191;
export const MOCK_EMBED_ORIGIN = `http://127.0.0.1:${MOCK_EMBED_PORT}`;
