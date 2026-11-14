import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  WEB_DEV_HOST,
  WEB_DEV_PORT,
} from "@agorack/contracts/dev";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mockApi } from "./dev/mock-api/plugin.ts";

/**
 * サーバー（apps/server）の住所。サーバーと同じ決め方にする（設計 §9）：
 * 実際の環境変数、apps/server/.env、既定の値の順に SERVER_HOST・SERVER_PORT を読み、空の値は書いていないものとして扱う。
 * 値の検証はサーバーが起動するときに行う。
 */
function serverOrigin(): string {
  const envFile = fileURLToPath(new URL("../server/.env", import.meta.url));
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const read = (key: string) => (process.env[key] ?? fromFile[key])?.trim() || undefined;
  const host = read("SERVER_HOST") ?? DEFAULT_SERVER_HOST;
  const port = read("SERVER_PORT") ?? String(DEFAULT_SERVER_PORT);
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

/** 画面の住所。サーバーが受け付ける住所と同じ値を、画面と共通の契約から読む（設計 §7.4・§9） */
const HOST = WEB_DEV_HOST;
const PORT = WEB_DEV_PORT;

export default defineConfig(({ mode }) => {
  // `vite --mode mock` のときだけ、決まったイベントを流す偽のサーバーを使う
  const mock = mode === "mock";
  return {
    plugins: [react(), ...(mock ? [mockApi()] : [])],
    server: {
      host: HOST,
      port: PORT,
      strictPort: true,
      proxy: mock ? undefined : { "/api": { target: serverOrigin() } },
    },
    preview: { host: HOST, port: PORT, strictPort: true },
  };
});
