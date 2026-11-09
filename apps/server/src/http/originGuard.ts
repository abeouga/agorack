import type { MiddlewareHandler } from "hono";

/** ループバックの名前（URL の hostname の形） */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * 許していない相手からの要求を 403 で断る（設計 §9）。
 *
 * - `Origin` があり、許した画面の住所でなければ断る（他のサイトのページからの要求）。
 *   `Origin` がない要求（curl・同じ住所からの読み込み）は通す。
 * - 宛先の名前（Host）がループバックでなければ断る。悪いサイトが自分の名前を 127.0.0.1 に
 *   向け直す手口（DNS rebinding）では `Origin` が付かない読み込みもあるため。
 *
 * 断った応答は、許していないページからは CORS で読めないので、契約のエラーの形にはしない。
 */
export function originGuard(allowedOrigins: readonly string[]): MiddlewareHandler {
  const allowed = new Set(allowedOrigins);
  return async (c, next) => {
    const hostname = new URL(c.req.url).hostname;
    if (!LOOPBACK_HOSTNAMES.has(hostname)) {
      return c.text("宛先の名前が手元の住所ではないため、要求を受け付けません", 403);
    }
    const origin = c.req.header("Origin");
    if (origin !== undefined && !allowed.has(origin)) {
      return c.text("許していない画面の住所（Origin）からの要求は受け付けません", 403);
    }
    await next();
  };
}
