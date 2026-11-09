import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mockApi } from "./dev/mock-api/plugin.ts";

/** サーバー（apps/server）の住所。127.0.0.1 だけで待ち受ける（設計 §9） */
const SERVER_ORIGIN = "http://127.0.0.1:8787";

/** 画面の住所。文之助の画面が 5173 を使うので 5174 に固定する（設計 §7.4・§9） */
const HOST = "127.0.0.1";
const PORT = 5174;

export default defineConfig(({ mode }) => {
  // `vite --mode mock` のときだけ、決まったイベントを流す偽のサーバーを使う
  const mock = mode === "mock";
  return {
    plugins: [react(), ...(mock ? [mockApi()] : [])],
    server: {
      host: HOST,
      port: PORT,
      strictPort: true,
      proxy: mock ? undefined : { "/api": { target: SERVER_ORIGIN } },
    },
    preview: { host: HOST, port: PORT, strictPort: true },
  };
});
