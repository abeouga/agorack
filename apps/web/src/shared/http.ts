import { type ApiErrorCode, ApiErrorResponseSchema } from "@agorack/contracts";

/**
 * サーバーへの要求の共通の部分。失敗はサーバーのエラーの形（packages/contracts）を読んで ApiError にする。
 */

/** サーバーのエラーのコードに、画面の側の失敗（つながらない・応答の形が違う）を足したもの */
export type ClientErrorCode = ApiErrorCode | "NETWORK" | "BAD_RESPONSE";

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const NETWORK_MESSAGE =
  "サーバーにつながりません。サーバーが起動しているか確かめてください。";

/** 要求を送り、成功（2xx）の応答だけを返す。中断（AbortError）はそのまま投げる */
export async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("NETWORK", NETWORK_MESSAGE);
  }
  if (!response.ok) throw await errorOf(response);
  return response;
}

export async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await request(path, init);
  try {
    return await response.json();
  } catch {
    throw new ApiError("BAD_RESPONSE", "サーバーの応答を読めませんでした。", response.status);
  }
}

async function errorOf(response: Response): Promise<ApiError> {
  try {
    const parsed = ApiErrorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      return new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
    }
  } catch {
    // 本文が JSON でない（プロキシの失敗など）
  }
  // サーバーは失敗も JSON で返す。JSON でない 5xx は、開発用の中継（Vite）がサーバーにつなげなかったとき
  if (response.status >= 500) {
    return new ApiError("NETWORK", NETWORK_MESSAGE, response.status);
  }
  return new ApiError(
    "BAD_RESPONSE",
    `サーバーがエラーを返しました（${response.status}）。`,
    response.status,
  );
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
